import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, RegistrationStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { registrationBusy } from './registration-errors.js';

// Shared by PR review and member confirm/decline: every change to an event's
// seats or waitlist runs in a transaction that locks the event row first.

export type Tx = Prisma.TransactionClient;

export interface LockedEvent {
  eventId: number;
  name: string;
  capacity: number;
  confirmationWindowHours: number;
  startsAt: Date;
  endsAt: Date;
  published: boolean;
}

// Only accepted people who have not dropped out hold a seat.
export const SEAT_HOLDING_STATUSES: RegistrationStatus[] = [
  RegistrationStatus.AWAITING_CONFIRMATION,
  RegistrationStatus.CONFIRMED,
];

// Waitlist positions are unique per event, so renumbering parks rows above
// this offset first to avoid colliding with positions still in use.
const POSITION_PARKING_OFFSET = 1_000_000;
const HOUR_MS = 60 * 60 * 1000;
// Changes to one event queue behind its lock, so allow a longer wait than
// Prisma's 2-second default before giving up.
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 };
const TRANSACTION_TIMEOUT_CODE = 'P2028';
// Raised by the pg pool when every connection stays busy past its timeout.
const POOL_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

export function eventNotFound(): NotFoundException {
  return new NotFoundException('The event was not found.', {
    errorCode: 'EVENT_NOT_FOUND',
  });
}

export function eventStarted(): ConflictException {
  return new ConflictException('The event has already started.', {
    errorCode: 'EVENT_STARTED',
  });
}

export async function inEventTransaction<T>(
  prisma: PrismaService,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(work, TRANSACTION_OPTIONS);
  } catch (error) {
    if (
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === TRANSACTION_TIMEOUT_CODE) ||
      (error instanceof Error && error.message === POOL_TIMEOUT_MESSAGE)
    ) {
      throw registrationBusy();
    }
    throw error;
  }
}

export async function lockEvent(tx: Tx, eventId: number): Promise<LockedEvent> {
  const rows = await tx.$queryRaw<LockedEvent[]>`
    SELECT event_id AS "eventId", name, capacity,
           confirmation_window_hours AS "confirmationWindowHours",
           starts_at AS "startsAt",
           ends_at AS "endsAt",
           status = 'published' AS published
    FROM events
    WHERE event_id = ${eventId}
    FOR UPDATE`;
  if (!rows[0]) throw eventNotFound();
  return rows[0];
}

export function countHeldSeats(tx: Tx, eventId: number) {
  return tx.eventRegistration.count({
    where: { eventId, status: { in: SEAT_HOLDING_STATUSES } },
  });
}

// The fields for offering a seat, or null once the event has started.
// The deadline is the event's window from now, capped at the event start.
export function seatOffer(event: LockedEvent, now = new Date()) {
  if (event.startsAt.getTime() <= now.getTime()) return null;
  const windowEnd = now.getTime() + event.confirmationWindowHours * HOUR_MS;
  return {
    status: RegistrationStatus.AWAITING_CONFIRMATION,
    waitlistPosition: null,
    approvedAt: now,
    confirmationDeadline: new Date(
      Math.min(windowEnd, event.startsAt.getTime()),
    ),
  };
}

export async function parkWaitlist(tx: Tx, eventId: number) {
  await tx.$executeRaw`
    UPDATE event_registrations
    SET waitlist_position = waitlist_position + ${POSITION_PARKING_OFFSET}
    WHERE event_id = ${eventId} AND status = 'WAITLISTED'`;
}

// Closes gaps so the waitlist always reads 1..n in its existing order.
export async function renumberWaitlist(tx: Tx, eventId: number) {
  await parkWaitlist(tx, eventId);
  await tx.$executeRaw`
    UPDATE event_registrations AS r
    SET waitlist_position = ordered.position
    FROM (
      SELECT registration_id,
             ROW_NUMBER() OVER (ORDER BY waitlist_position)::int AS position
      FROM event_registrations
      WHERE event_id = ${eventId} AND status = 'WAITLISTED'
    ) AS ordered
    WHERE r.registration_id = ordered.registration_id`;
}
