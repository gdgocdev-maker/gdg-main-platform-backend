import { Inject, Injectable } from '@nestjs/common';
import {
  BlacklistReason,
  EventStatus,
  RegistrationStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CommitteeAccessService,
  REGISTRATIONS_REVIEW,
} from './committee-access.service.js';
import {
  countHeldSeats,
  eventStarted,
  inEventTransaction,
  type LockedEvent,
  lockEvent,
  parkWaitlist,
  renumberWaitlist,
  seatOffer,
  type Tx,
} from './event-seats.js';
import {
  capacityReached,
  invalidStatusTransition,
  registrationForbidden,
  registrationNotFound,
} from './registration-errors.js';

export type ReviewDecision = 'ACCEPT' | 'REJECT';

const REVIEWABLE_STATUSES: RegistrationStatus[] = [
  RegistrationStatus.PENDING,
  RegistrationStatus.WAITLISTED,
];
const NO_SHOW_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RegistrationReviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
  ) {}

  async review(
    registrationId: number,
    decision: ReviewDecision,
    actorMemberId: number,
  ) {
    await this.assertCanReview(actorMemberId);

    return inEventTransaction(
      this.prisma,
      async (tx) => {
        const found = await tx.eventRegistration.findUnique({
          where: { registrationId },
          select: { eventId: true },
        });
        if (!found) throw registrationNotFound();

        // Every change that affects seats or the waitlist locks the event row
        // first, so concurrent reviewers of one event run one after another.
        const event = await lockEvent(tx, found.eventId);
        const current = await tx.eventRegistration.findUniqueOrThrow({
          where: { registrationId },
          select: { status: true },
        });
        if (!REVIEWABLE_STATUSES.includes(current.status)) {
          throw invalidStatusTransition();
        }

        let updated;
        if (decision === 'ACCEPT') {
          const offer = seatOffer(event);
          if (!offer) throw eventStarted();
          if ((await countHeldSeats(tx, event.eventId)) >= event.capacity) {
            throw capacityReached();
          }
          updated = await tx.eventRegistration.update({
            where: { registrationId },
            data: { ...offer, reviewedByMemberId: actorMemberId },
          });
        } else {
          updated = await tx.eventRegistration.update({
            where: { registrationId },
            data: {
              status: RegistrationStatus.REJECTED,
              waitlistPosition: null,
              reviewedByMemberId: actorMemberId,
            },
          });
        }

        if (current.status === RegistrationStatus.WAITLISTED) {
          await renumberWaitlist(tx, event.eventId);
        }

        await tx.registrationEmailDelivery.create({
          data: { registrationId, kind: decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED' },
        });
        return {
          registrationId: updated.registrationId,
          eventId: updated.eventId,
          status: updated.status,
          approvedAt: updated.approvedAt,
          confirmationDeadline: updated.confirmationDeadline,
        };
      },
    );

  }

  // Replaces the event's waitlist with registrationIds in the given order.
  // Waitlisted people left out of the list return to PENDING.
  async setWaitlist(
    eventId: number,
    registrationIds: number[],
    actorMemberId: number,
  ) {
    await this.assertCanReview(actorMemberId);

    return inEventTransaction(this.prisma, async (tx) => {
      await lockEvent(tx, eventId);

      const listed = await tx.eventRegistration.findMany({
        where: { registrationId: { in: registrationIds }, eventId },
        select: { registrationId: true, status: true },
      });
      if (listed.length !== registrationIds.length) {
        throw registrationNotFound();
      }
      if (listed.some((row) => !REVIEWABLE_STATUSES.includes(row.status))) {
        throw invalidStatusTransition();
      }

      await tx.eventRegistration.updateMany({
        where: {
          eventId,
          status: RegistrationStatus.WAITLISTED,
          registrationId: { notIn: registrationIds },
        },
        data: { status: RegistrationStatus.PENDING, waitlistPosition: null },
      });
      await parkWaitlist(tx, eventId);

      for (const [index, registrationId] of registrationIds.entries()) {
        const wasPending =
          listed.find((row) => row.registrationId === registrationId)
            ?.status === RegistrationStatus.PENDING;
        await tx.eventRegistration.update({
          where: { registrationId },
          data: {
            status: RegistrationStatus.WAITLISTED,
            waitlistPosition: index + 1,
            ...(wasPending ? { reviewedByMemberId: actorMemberId } : {}),
          },
        });
      }

      return registrationIds.map((registrationId, index) => ({
        registrationId,
        waitlistPosition: index + 1,
      }));
    });
  }

  // Gives the first waitlisted person a free seat, if there is one.
  // Returns the promoted registration id, or null when nothing changed.
  async promoteNextFromWaitlist(eventId: number): Promise<number | null> {
    return inEventTransaction(this.prisma, async (tx) => {
      const event = await lockEvent(tx, eventId);
      return this.promoteWithin(tx, event);
    });
  }

  // Scheduled-job entry point: expires overdue confirmations and refills
  // each freed seat from the waitlist. Safe to run concurrently: a row only
  // expires if it is still awaiting confirmation once the event is locked.
  async cancelOverdueConfirmationOffers(now = new Date()) {
    const overdue = await this.prisma.eventRegistration.findMany({
      where: {
        status: RegistrationStatus.AWAITING_CONFIRMATION,
        confirmationDeadline: { lt: now },
      },
      select: { registrationId: true, eventId: true },
      orderBy: { confirmationDeadline: 'asc' },
    });

    let cancelled = 0;
    const promoted: number[] = [];
    for (const { registrationId, eventId } of overdue) {
      const outcome = await inEventTransaction(this.prisma, async (tx) => {
        const event = await lockEvent(tx, eventId);
        const { count } = await tx.eventRegistration.updateMany({
          where: {
            registrationId,
            status: RegistrationStatus.AWAITING_CONFIRMATION,
            confirmationDeadline: { lt: now },
          },
          data: { status: RegistrationStatus.CANCELLED, cancelledAt: now },
        });
        if (count === 0) return null;
        // A missed confirmation cancels the offer, releases its seat and is not a blacklist incident.
        return { promotedId: await this.promoteWithin(tx, event) };
      });
      if (!outcome) continue;
      cancelled += 1;
      if (outcome.promotedId !== null) promoted.push(outcome.promotedId);
    }
    return { cancelled, promoted };
  }

  // A confirmed attendee becomes a no-show only after the event has ended
  // and a full day has passed without a recorded check-in.
  async markOverdueNoShows(now = new Date()) {
    const cutoff = new Date(now.getTime() - NO_SHOW_GRACE_PERIOD_MS);
    const candidates = await this.prisma.eventRegistration.findMany({
      where: {
        status: RegistrationStatus.CONFIRMED,
        checkedInAt: null,
        event: {
          is: {
            endsAt: { lte: cutoff },
            status: { not: EventStatus.CANCELLED },
          },
        },
      },
      orderBy: [{ eventId: 'asc' }, { registrationId: 'asc' }],
      take: 500,
      select: { registrationId: true, eventId: true },
    });

    let marked = 0;
    for (const { registrationId, eventId } of candidates) {
      const changed = await inEventTransaction(this.prisma, async (tx) => {
        const event = await lockEvent(tx, eventId);
        if (event.endsAt.getTime() > cutoff.getTime()) return false;
        const currentEvent = await tx.event.findUnique({
          where: { eventId },
          select: { status: true },
        });
        if (!currentEvent || currentEvent.status === EventStatus.CANCELLED) {
          return false;
        }

        const result = await tx.eventRegistration.updateMany({
          where: {
            registrationId,
            status: RegistrationStatus.CONFIRMED,
            checkedInAt: null,
          },
          data: { status: RegistrationStatus.NO_CHECK_IN },
        });
        if (result.count === 0) return false;

        await tx.registrationBlacklistEntry.createMany({
          data: {
            registrationId,
            reason: BlacklistReason.NO_CHECK_IN,
          },
          skipDuplicates: true,
        });
        return true;
      });
      if (changed) marked += 1;
    }
    return { marked };
  }

  private async promoteWithin(
    tx: Tx,
    event: LockedEvent,
  ): Promise<number | null> {
    const offer = seatOffer(event);
    if (!offer) return null;
    if ((await countHeldSeats(tx, event.eventId)) >= event.capacity) {
      return null;
    }
    const next = await tx.eventRegistration.findFirst({
      where: { eventId: event.eventId, status: RegistrationStatus.WAITLISTED },
      orderBy: { waitlistPosition: 'asc' },
      select: { registrationId: true },
    });
    if (!next) return null;

    await tx.eventRegistration.update({
      where: { registrationId: next.registrationId },
      data: offer,
    });
    await renumberWaitlist(tx, event.eventId);
    await tx.registrationEmailDelivery.create({ data: { registrationId: next.registrationId, kind: 'PROMOTED' } });
    return next.registrationId;
  }

  private async assertCanReview(memberId: number) {
    if (
      !(await this.access.hasCommitteePermission(
        memberId,
        REGISTRATIONS_REVIEW,
      ))
    ) {
      throw registrationForbidden();
    }
  }

}
