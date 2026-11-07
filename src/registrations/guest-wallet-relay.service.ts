import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { AttendanceTokenService } from '../event-registrations/attendance-token.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistrationEmailDeliveryService } from './registration-email-delivery.service.js';
import { guestWalletRelayScope } from './guest-wallet-scope.js';

type Scope = NonNullable<ReturnType<typeof guestWalletRelayScope>>;

function visibleText(value: string, limit: number) {
  return Array.from(value.replace(/[\x00-\x1f\x7f]/gu, ' ').trim())
    .slice(0, limit)
    .join('');
}

@Injectable()
export class GuestWalletRelayService {
  private readonly logger = new Logger(GuestWalletRelayService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AttendanceTokenService)
    private readonly tokens: AttendanceTokenService,
    @Inject(RegistrationEmailDeliveryService)
    private readonly delivery: RegistrationEmailDeliveryService,
  ) {}

  @Cron('30 * * * * *', { waitForCompletion: true })
  async runScheduled() {
    if (process.env.NODE_ENV !== 'test') await this.sync();
  }

  async sync() {
    const scope = guestWalletRelayScope(this.config);
    if (!scope) return;
    try {
      let after = 0;
      for (;;) {
        const items = await this.prisma.eventRegistration.findMany({
          where: {
            registrationId: { gt: after },
            OR: [
              {
                attendanceMethod: 'GUEST_QR',
                status: 'CONFIRMED',
                person: { isActive: true },
                event: { status: 'PUBLISHED', endsAt: { gt: new Date() } },
              },
              {
                walletProjection: {
                  is: { OR: [{ active: true }, { pending: true }] },
                },
              },
            ],
            event: {
              committee: { committeeCode: { in: scope.committeeCodes } },
            },
          },
          orderBy: { registrationId: 'asc' },
          select: { registrationId: true },
          take: 50,
        });
        for (const { registrationId } of items) {
          try {
            await this.send(registrationId, scope);
          } catch {
            this.logger.warn('Guest pass request will retry');
          }
          after = registrationId;
        }
        if (items.length < 50) return;
      }
    } catch {
      this.logger.warn('Guest pass queue will retry');
    }
  }

  private async stage(registrationId: number, scope: Scope) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT registration_id FROM event_registrations WHERE registration_id = ${registrationId} FOR UPDATE`;
      const row = await tx.eventRegistration.findUnique({
        where: { registrationId },
        select: {
          attendanceMethod: true,
          status: true,
          attendanceTokenEncrypted: true,
          walletProjection: true,
          person: {
            select: {
              isActive: true,
              fullName: true,
            },
          },
          event: {
            select: {
              status: true,
              name: true,
              startsAt: true,
              endsAt: true,
              committee: { select: { committeeCode: true } },
            },
          },
          emailDeliveries: {
            where: { kind: 'CONFIRMED' },
            orderBy: { id: 'desc' },
            take: 1,
            select: { id: true, state: true },
          },
        },
      });
      if (
        !row ||
        !scope.committeeCodes.includes(row.event.committee.committeeCode)
      )
        return null;
      const { event, person, walletProjection } = row;
      const expired = event.endsAt <= new Date();
      const eligible =
        row.attendanceMethod === 'GUEST_QR' &&
        row.status === 'CONFIRMED' &&
        event.status === 'PUBLISHED' &&
        person.isActive &&
        !!row.attendanceTokenEncrypted;
      const active = eligible && !expired;
      if (!active && !walletProjection) return null;
      const email = row.emailDeliveries[0];
      const deliveryId = active && email?.state === 'PENDING' ? email.id : undefined;
      const body = active
        ? {
            active: true,
            emailByGdg: true,
            name: visibleText(person.fullName, 100),
            title: visibleText(event.name, 160),
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt.toISOString(),
            barcode: this.tokens.reveal(row.attendanceTokenEncrypted!),
          }
        : { active: false, expired: eligible && expired };
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(body))
        .digest('hex');
      const projection =
        walletProjection?.fingerprint === fingerprint
          ? walletProjection
          : await tx.walletGuestProjection.upsert({
              where: { registrationId },
              create: {
                registrationId,
                revision: 1,
                fingerprint,
                active,
                pending: true,
              },
              update: {
                revision: { increment: 1 },
                fingerprint,
                active,
                pending: true,
              },
            });
      return {
        body,
        projection,
        committee: event.committee.committeeCode,
        deliveryId,
      };
    });
  }

  private async send(registrationId: number, scope: Scope) {
    const request = await this.stage(registrationId, scope);
    if (!request || (!request.projection.pending && !request.deliveryId)) return;
    const { projection, committee, deliveryId, body } = request;
    const url = new URL(
      `/integrations/v1/guest-tickets/${committee}/${registrationId}`,
      scope.origin,
    );
    const response = await fetch(url, {
      method: projection.pending ? 'PUT' : 'GET',
      headers: {
        Authorization: `Bearer ${scope.token}`,
        'Content-Type': 'application/json',
      },
      body: projection.pending
        ? JSON.stringify({ ...body, revision: projection.revision })
        : undefined,
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Guest pass request rejected');
    const result = await response.json();
    if (result.revision !== projection.revision) return;
    const committed = await this.prisma.walletGuestProjection.updateMany({
      where: { registrationId, revision: projection.revision },
      data: { pending: false },
    });
    if (!committed.count || !deliveryId || result.walletState !== 'PUBLISHED') return;
    // An earlier owner-side send can still have a live lease during rollout.
    if (result.deliveryId === deliveryId) {
      const state = result.emailState;
      if (state === 'PENDING' || state === 'SENDING') return;
      if (state === 'SENT' || state === 'FAILED' || state === 'SKIPPED') {
        await this.prisma.registrationEmailDelivery.updateMany({
          where: { id: deliveryId, state: 'PENDING' },
          data: { state },
        });
        return;
      }
    }
    if (typeof result.walletUrl !== 'string') throw new Error('Guest card URL unavailable');
    const walletUrl = new URL(result.walletUrl);
    if (walletUrl.origin !== scope.publicOrigin || walletUrl.username || walletUrl.password ||
        walletUrl.search || walletUrl.hash || !/^\/m\/[A-Za-z0-9_-]{32,256}\/id\.pkpass$/.test(walletUrl.pathname)) {
      throw new Error('Unexpected guest card URL');
    }
    await this.delivery.deliver(deliveryId, walletUrl.toString());
  }
}
