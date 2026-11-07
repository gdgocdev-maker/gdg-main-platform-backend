import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

interface RemoteMembership {
  membership_id: string;
  version: number;
  pending: boolean;
  next_event?: string;
  points?: number;
}

const riyadhTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function seconds(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function eventLabel(title: string, date: Date) {
  const parts = Object.fromEntries(riyadhTime.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${title} | ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (KSA)`;
}

function requestId(id: string, version: number, changes: object) {
  const hash = createHash('sha256').update(JSON.stringify([id, version, changes])).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

@Injectable()
export class WalletProjectionService {
  private readonly logger = new Logger(WalletProjectionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Cron('15 * * * * *', { waitForCompletion: true })
  async runScheduled() {
    if (process.env.NODE_ENV !== 'test') await this.sync();
  }

  async sync() {
    const endpoint = this.config.get<string>('WALLET_PROJECTION_URL');
    const token = this.config.get<string>('WALLET_PROJECTION_TOKEN');
    if (!endpoint || !token) return;
    try {
      const url = new URL(endpoint);
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (
        (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:' && process.env.NODE_ENV !== 'production')) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash
      ) throw new Error('Invalid Wallet API origin');

      let after: string | null = '';
      let sent = 0;
      do {
        const listUrl = new URL('/integrations/v1/members', url);
        if (after) listUrl.searchParams.set('after', after);
        const response = await this.remote(listUrl, token);
        if (!response.ok) throw new Error(`Wallet list returned ${response.status}`);
        const page: { members: RemoteMembership[]; next_cursor: string | null } = await response.json();
        const ids = page.members.map((row) => row.membership_id)
          .filter((id) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id));
        const now = new Date();
        const links = await this.prisma.walletMembershipLink.findMany({
          where: {
            walletPublicId: { in: ids },
            revokedAt: null,
            member: { isActive: true, person: { isActive: true } },
            OR: [{ syncNextEvent: true }, { syncPoints: true }],
          },
          select: {
            walletPublicId: true, memberId: true, committeeId: true, syncNextEvent: true, syncPoints: true,
            member: { select: { person: { select: {
              registrations: {
                where: {
                  event: { status: 'PUBLISHED', endsAt: { gt: now } },
                  OR: [{ status: 'CONFIRMED' }, { status: 'AWAITING_CONFIRMATION', confirmationDeadline: { gt: now } }],
                },
                orderBy: [{ event: { startsAt: 'asc' } }, { eventId: 'asc' }],
                take: 1,
                select: { registrationId: true, event: { select: { eventId: true, name: true, startsAt: true, endsAt: true } } },
              },
            } } } },
          },
        });
        const byId = new Map(links.map((link) => [link.walletPublicId, link]));
        for (const remote of page.members) {
          const link = byId.get(remote.membership_id);
          if (!link || remote.pending || !Number.isSafeInteger(remote.version) || remote.version < 1) continue;
          const changes: Record<string, unknown> = {};
          if (link.syncNextEvent && typeof remote.next_event === 'string') {
            const first = link.member.person.registrations[0];
            const event = first?.event;
            const title = event && Array.from(event.name.replace(/[<>\p{C}]/gu, '').trim()).slice(0, 100).join('');
            const label = event && title ? eventLabel(title, event.startsAt) : '';
            if (label !== remote.next_event && (!event || title)) {
              changes.next_event = event ? {
                event_id: String(event.eventId), registration_id: String(first.registrationId),
                status: 'approved', title, starts_at: seconds(event.startsAt), ends_at: seconds(event.endsAt),
              } : null;
            }
          }
          if (link.syncPoints && link.committeeId !== null && typeof remote.points === 'number') {
            const total = await this.prisma.committeePointEntry.aggregate({
              where: { memberId: link.memberId, committeeId: link.committeeId },
              _sum: { pointsDelta: true },
            });
            const points = total._sum.pointsDelta ?? 0;
            if (points >= 0 && points <= 10_000_000 && points !== remote.points) changes.points = points;
          }
          if (!Object.keys(changes).length) continue;
          const updateUrl = new URL(`/integrations/v1/members/${link.walletPublicId}`, url);
          const result = await this.remote(updateUrl, token, {
            method: 'PATCH',
            body: JSON.stringify({ request_id: requestId(link.walletPublicId, remote.version, changes), expected_version: remote.version, changes }),
          });
          if (result.status === 429) return;
          if (!result.ok && result.status !== 409) {
            this.logger.warn({ event: 'wallet_projection_rejected', status: result.status });
          }
          if (++sent >= 20) return;
        }
        if (page.next_cursor !== null && page.next_cursor <= after) throw new Error('Wallet cursor did not advance');
        after = page.next_cursor;
      } while (after !== null);
    } catch (error) {
      this.logger.warn({ event: 'wallet_projection_failed', error: error instanceof Error ? error.name : 'UnknownError' });
    }
  }

  private remote(url: URL, token: string, init: RequestInit = {}) {
    return fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  }
}
