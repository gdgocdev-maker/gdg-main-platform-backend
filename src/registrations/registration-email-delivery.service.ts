import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AttendanceTokenService } from '../event-registrations/attendance-token.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRATIONS_REVIEW,
} from './committee-access.service.js';
import { RegistrationEmailService } from './registration-email.service.js';
import {
  registrationForbidden,
  registrationNotFound,
} from './registration-errors.js';
import {
  guestWalletRelayScope,
  guestWalletScope,
} from './guest-wallet-scope.js';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class RegistrationEmailDeliveryService {
  private readonly logger = new Logger(RegistrationEmailDeliveryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RegistrationEmailService)
    private readonly email: RegistrationEmailService,
    @Inject(AttendanceTokenService)
    private readonly tokens: AttendanceTokenService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async retry(registrationId: number, actorMemberId: number) {
    if (
      !(await this.access.hasCommitteePermission(
        actorMemberId,
        REGISTRATIONS_REVIEW,
      ))
    )
      throw registrationForbidden();
    const delivery = await this.prisma.registrationEmailDelivery.findFirst({
      where: { registrationId },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        kind: true,
        registration: {
          select: {
            attendanceMethod: true,
            event: {
              select: { committee: { select: { committeeCode: true } } },
            },
          },
        },
      },
    });
    if (!delivery) throw registrationNotFound();
    const relay = guestWalletRelayScope(this.config);
    const newAttempt =
      relay &&
      delivery.kind === 'CONFIRMED' &&
      delivery.registration.attendanceMethod === 'GUEST_QR' &&
      relay.committeeCodes.includes(
        delivery.registration.event.committee.committeeCode,
      );
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.registrationEmailDelivery.updateMany({
        where: { id: delivery.id, state: 'FAILED' },
        data: { state: newAttempt ? 'SKIPPED' : 'PENDING' },
      });
      if (!count)
        throw new ConflictException(
          'Only a failed registration email can be retried.',
        );
      if (newAttempt)
        await tx.registrationEmailDelivery.create({
          data: { registrationId, kind: delivery.kind },
        });
    });
    return { emailState: 'PENDING' as const };
  }

  @Cron('*/15 * * * * *', { waitForCompletion: true })
  async runScheduled() {
    if (process.env.NODE_ENV !== 'test') await this.processPending();
  }

  async processPending() {
    // An interrupted send has an uncertain SMTP outcome. Require an explicit retry.
    await this.prisma.registrationEmailDelivery.updateMany({
      where: { state: 'SENDING', leaseExpiresAt: { lt: new Date() } },
      data: { state: 'FAILED', leaseExpiresAt: null },
    });
    const scope =
      guestWalletRelayScope(this.config) ?? guestWalletScope(this.config);
    const walletDelivery:
      Prisma.RegistrationEmailDeliveryWhereInput | undefined = scope
      ? {
          kind: 'CONFIRMED',
          registration: {
            attendanceMethod: 'GUEST_QR',
            event: {
              committee: { committeeCode: { in: scope.committeeCodes } },
            },
          },
        }
      : undefined;
    if (walletDelivery) {
      await this.prisma.registrationEmailDelivery.updateMany({
        where: {
          state: 'PENDING',
          AND: [
            walletDelivery,
            {
              registration: {
                NOT: {
                  status: 'CONFIRMED',
                  person: { isActive: true },
                  event: { status: 'PUBLISHED', endsAt: { gt: new Date() } },
                },
              },
            },
          ],
        },
        data: { state: 'SKIPPED' },
      });
    }
    const jobs = await this.prisma.registrationEmailDelivery.findMany({
      where: {
        state: 'PENDING',
        ...(walletDelivery ? { NOT: walletDelivery } : {}),
      },
      orderBy: { id: 'asc' },
      take: 10,
      select: { id: true },
    });

    for (const { id } of jobs) await this.deliver(id);
  }

  async deliver(id: number, walletUrl?: string) {
    const leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
    const { count } = await this.prisma.registrationEmailDelivery.updateMany({
      where: { id, state: 'PENDING' },
      data: { state: 'SENDING', leaseExpiresAt },
    });
    if (!count) return;
    let state: 'SENT' | 'FAILED' | 'SKIPPED';
    try {
      state = (await this.sendCurrent(id, walletUrl)) ? 'SENT' : 'SKIPPED';
    } catch {
      this.logger.warn({
        event: 'registration_email_failed',
        deliveryId: id,
      });
      state = 'FAILED';
    }
    await this.prisma.registrationEmailDelivery.updateMany({
      where: { id, state: 'SENDING', leaseExpiresAt },
      data: { state, leaseExpiresAt: null },
    });
  }

  private async sendCurrent(id: number, walletUrl?: string) {
    const { kind, registration } =
      await this.prisma.registrationEmailDelivery.findUniqueOrThrow({
        where: { id },
        select: {
          kind: true,
          registration: {
            select: {
              registrationId: true,
              status: true,
              confirmationDeadline: true,
              attendanceMethod: true,
              attendanceTokenEncrypted: true,
              event: {
                select: {
                  name: true,
                  startsAt: true,
                  endsAt: true,
                  location: true,
                  status: true,
                },
              },
              person: {
                select: {
                  fullName: true,
                  emailPersonal: true,
                  emailPersonalVerifiedAt: true,
                  emailUniversity: true,
                  isActive: true,
                },
              },
            },
          },
        },
      });
    const { status, attendanceMethod, event, person } = registration;
    const offered =
      status === 'AWAITING_CONFIRMATION' &&
      !!registration.confirmationDeadline &&
      registration.confirmationDeadline > new Date();
    const confirmedMember =
      status === 'CONFIRMED' && attendanceMethod === 'MEMBER_CARD';
    if (!person.isActive || event.status === 'CANCELLED') return false;
    if (kind === 'REJECTED') {
      if (status !== 'REJECTED') return false;
    } else {
      if (event.endsAt <= new Date()) return false;
      if (
        kind === 'CONFIRMED'
          ? status !== 'CONFIRMED'
          : !offered && !confirmedMember
      )
        return false;
    }
    if (walletUrl && (kind !== 'CONFIRMED' || attendanceMethod !== 'GUEST_QR' || event.status !== 'PUBLISHED'))
      return false;
    const to = walletUrl
      ? person.emailPersonalVerifiedAt && person.emailPersonal
      : person.emailPersonal ?? person.emailUniversity;
    if (!to) throw new Error('Missing recipient');
    const attendanceQrCodeDataUrl =
      kind === 'CONFIRMED' && registration.attendanceTokenEncrypted
        ? await AttendanceTokenService.qrImage(
            this.tokens.reveal(registration.attendanceTokenEncrypted),
          )
        : undefined;
    await this.email.send({
      kind,
      registrationId: registration.registrationId,
      to,
      recipientName: person.fullName,
      eventName: event.name,
      eventStartsAt: event.startsAt,
      eventLocation: event.location,
      confirmationDeadline: offered
        ? (registration.confirmationDeadline ?? undefined)
        : undefined,
      attendanceQrCodeDataUrl,
      walletUrl,
    });
    return true;
  }
}
