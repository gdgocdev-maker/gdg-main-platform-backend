import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { RegistrationStatus } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RegistrationReviewService } from '../src/registrations/registration-review.service.js';
import { schemaTestTarget } from './schema-test-target.js';

// Runs against a separate local database, never the development one:
// TEST_DATABASE_URL=postgresql://.../gdg_schema_test_registrations?schema=public
process.env.DATABASE_URL = schemaTestTarget(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
  { allowSupabaseTestProject: true },
);

let app: INestApplication;
let prisma: PrismaService;
let review: RegistrationReviewService;
let prCommitteeId: number;
let prMemberId: number;
let outsiderMemberId: number;
// Lets each HTTP request choose which member it is authenticated as.
let actingMemberId: number | undefined;
const personOfMember = new Map<number, number>();

async function createMember(committeeId?: number) {
  const person = await prisma.person.create({
    data: {
      fullName: 'Staff Member',
      emailPersonal: `${randomUUID()}@test.local`,
    },
  });
  const member = await prisma.member.create({
    data: { personId: person.personId },
  });
  personOfMember.set(member.memberId, person.personId);
  if (committeeId) {
    await prisma.memberCommittee.create({
      data: { memberId: member.memberId, committeeId, role: 'Leader' },
    });
  }
  return member.memberId;
}

async function createEvent(capacity: number) {
  const startsAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  return prisma.event.create({
    data: {
      name: `Event ${randomUUID().slice(0, 8)}`,
      capacity,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3600 * 1000),
      registrationDeadline: startsAt,
      status: 'PUBLISHED',
      createdByMemberId: prMemberId,
      committeeId: prCommitteeId,
    },
  });
}

async function register(eventId: number, count: number, namePrefix = 'Guest') {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const person = await prisma.person.create({
      data: {
        fullName: `${namePrefix} ${i + 1}`,
        emailPersonal: `${randomUUID()}@test.local`,
      },
    });
    const registration = await prisma.eventRegistration.create({
      data: { eventId, personId: person.personId },
    });
    ids.push(registration.registrationId);
  }
  return ids;
}

async function statusOf(registrationId: number) {
  return prisma.eventRegistration.findUniqueOrThrow({
    where: { registrationId },
    select: {
      status: true,
      waitlistPosition: true,
      confirmationDeadline: true,
    },
  });
}

function asMember(memberId: number) {
  actingMemberId = memberId;
  return request(app.getHttpServer());
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  // Stand-in for the auth layer, which will set request.user.
  app.use(
    (
      req: { user?: { personId: number; memberId: number } },
      _res: unknown,
      next: () => void,
    ) => {
      if (actingMemberId) {
        req.user = {
          personId: personOfMember.get(actingMemberId)!,
          memberId: actingMemberId,
        };
      }
      next();
    },
  );
  await app.init();
  // Tests drive expiry themselves; stop the real timer.
  app
    .get(SchedulerRegistry)
    .getCronJob('registration-confirmation-expiry')
    .stop();

  prisma = app.get(PrismaService);
  review = app.get(RegistrationReviewService);
  prCommitteeId = (
    await prisma.committee.findUniqueOrThrow({ where: { committeeCode: 'PR' } })
  ).committeeId;
  prMemberId = await createMember(prCommitteeId);
  outsiderMemberId = await createMember();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  actingMemberId = undefined;
});

describe('GET /events/:eventId/registrations', () => {
  it('pages through 200 registrants with a summary', async () => {
    const event = await createEvent(30);
    const ids = await register(event.eventId, 200);
    await review.review(ids[0], 'ACCEPT', prMemberId);
    await review.setWaitlist(event.eventId, [ids[1], ids[2]], prMemberId);

    const first = await asMember(prMemberId)
      .get(`/events/${event.eventId}/registrations?page=1&pageSize=50`)
      .expect(200);
    expect(first.body.data.items).toHaveLength(50);
    expect(first.body.data.pagination).toEqual({
      page: 1,
      pageSize: 50,
      total: 200,
      totalPages: 4,
    });
    expect(first.body.data.summary).toEqual({
      accepted: 1,
      capacity: 30,
      confirmed: 0,
      awaitingConfirmation: 1,
      waitlisted: 2,
      pending: 197,
      checkedIn: 0,
      notCheckedIn: 0,
    });

    const last = await asMember(prMemberId)
      .get(`/events/${event.eventId}/registrations?page=4&pageSize=50`)
      .expect(200);
    expect(last.body.data.items).toHaveLength(50);
    const seen = new Set(
      [...first.body.data.items, ...last.body.data.items].map(
        (item: { registrationId: number }) => item.registrationId,
      ),
    );
    expect(seen.size).toBe(100);
  });

  it('searches by name and filters by status', async () => {
    const event = await createEvent(30);
    await register(event.eventId, 3, 'Common');
    const [sara] = await register(event.eventId, 1, 'Sara Unique');
    await review.review(sara, 'REJECT', prMemberId);

    const byName = await asMember(prMemberId)
      .get(`/events/${event.eventId}/registrations?search=sara%20unique`)
      .expect(200);
    expect(
      byName.body.data.items.map(
        (i: { registrationId: number }) => i.registrationId,
      ),
    ).toEqual([sara]);

    const rejected = await asMember(prMemberId)
      .get(`/events/${event.eventId}/registrations?status=REJECTED`)
      .expect(200);
    expect(rejected.body.data.pagination.total).toBe(1);
  });
});

describe('PATCH /registrations/:registrationId', () => {
  it('accepts into AWAITING_CONFIRMATION with a deadline and rejects the 31st', async () => {
    const event = await createEvent(30);
    const ids = await register(event.eventId, 31);
    for (const id of ids.slice(0, 30)) {
      await review.review(id, 'ACCEPT', prMemberId);
    }

    const accepted = await statusOf(ids[0]);
    expect(accepted.status).toBe(RegistrationStatus.AWAITING_CONFIRMATION);
    const hoursLeft =
      (accepted.confirmationDeadline!.getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);

    const response = await asMember(prMemberId)
      .patch(`/registrations/${ids[30]}`)
      .send({ status: 'ACCEPTED' })
      .expect(409);
    expect(response.body.error.code).toBe('CAPACITY_REACHED');
    expect((await statusOf(ids[30])).status).toBe(RegistrationStatus.PENDING);
  });

  it('lets only one of many simultaneous accepts take the last seat', async () => {
    const event = await createEvent(2);
    const [first, ...contenders] = await register(event.eventId, 21);
    await review.review(first, 'ACCEPT', prMemberId);

    // Twenty reviewers press Accept at the same moment for one remaining seat.
    const results = await Promise.allSettled(
      contenders.map((id) => review.review(id, 'ACCEPT', prMemberId)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const failure of results.filter((r) => r.status === 'rejected')) {
      expect((failure as PromiseRejectedResult).reason.errorCode).toBe(
        'CAPACITY_REACHED',
      );
    }
    expect(
      await prisma.eventRegistration.count({
        where: {
          eventId: event.eventId,
          status: RegistrationStatus.AWAITING_CONFIRMATION,
        },
      }),
    ).toBe(2);
  });

  it('refuses to accept once the event has started', async () => {
    const event = await createEvent(30);
    const [id] = await register(event.eventId, 1);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: {
        registrationDeadline: new Date(Date.now() - 2 * 3_600_000),
        startsAt: new Date(Date.now() - 3_600_000),
      },
    });

    const response = await asMember(prMemberId)
      .patch(`/registrations/${id}`)
      .send({ status: 'ACCEPTED' })
      .expect(409);
    expect(response.body.error.code).toBe('EVENT_STARTED');
  });

  it('answers 403 to members outside PR and 401 without a member', async () => {
    const event = await createEvent(30);
    const [id] = await register(event.eventId, 1);

    const forbidden = await asMember(outsiderMemberId)
      .patch(`/registrations/${id}`)
      .send({ status: 'ACCEPTED' })
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    await asMember(outsiderMemberId)
      .get(`/events/${event.eventId}/registrations`)
      .expect(403);
    await asMember(outsiderMemberId)
      .put(`/events/${event.eventId}/waitlist`)
      .send({ registrationIds: [id] })
      .expect(403);

    actingMemberId = undefined;
    await request(app.getHttpServer())
      .patch(`/registrations/${id}`)
      .send({ status: 'ACCEPTED' })
      .expect(401);
    expect((await statusOf(id)).status).toBe(RegistrationStatus.PENDING);
  });
});

describe('PUT /events/:eventId/waitlist', () => {
  it('saves the order, moves people, and drops removed ones back to PENDING', async () => {
    const event = await createEvent(30);
    const [a, b, c, d] = await register(event.eventId, 4);

    await asMember(prMemberId)
      .put(`/events/${event.eventId}/waitlist`)
      .send({ registrationIds: [a, b, c] })
      .expect(200);
    // Reorder (swap), drop b, and add d in one request.
    await asMember(prMemberId)
      .put(`/events/${event.eventId}/waitlist`)
      .send({ registrationIds: [c, a, d] })
      .expect(200);

    expect((await statusOf(c)).waitlistPosition).toBe(1);
    expect((await statusOf(a)).waitlistPosition).toBe(2);
    expect((await statusOf(d)).waitlistPosition).toBe(3);
    expect(await statusOf(b)).toMatchObject({
      status: RegistrationStatus.PENDING,
      waitlistPosition: null,
    });
  });
});

describe('promotion from the waitlist', () => {
  async function fullEventWithWaitlist() {
    const event = await createEvent(2);
    const [held1, held2, w1, w2, w3] = await register(event.eventId, 5);
    await review.review(held1, 'ACCEPT', prMemberId);
    await review.review(held2, 'ACCEPT', prMemberId);
    await review.setWaitlist(event.eventId, [w1, w2, w3], prMemberId);
    return { event, held1, held2, w1, w2, w3 };
  }

  // Moves an acceptance 25 hours into the past so its deadline has passed.
  async function makeOverdue(registrationIds: number[]) {
    await prisma.eventRegistration.updateMany({
      where: { registrationId: { in: registrationIds } },
      data: {
        approvedAt: new Date(Date.now() - 25 * 3_600_000),
        confirmationDeadline: new Date(Date.now() - 3_600_000),
      },
    });
  }

  it('gives a declined seat to waitlist #1 and renumbers the rest', async () => {
    const { event, held1, w1, w2, w3 } = await fullEventWithWaitlist();
    // The member's decline flow (another task) frees the seat, then promotes.
    await prisma.eventRegistration.update({
      where: { registrationId: held1 },
      data: { status: RegistrationStatus.DECLINED },
    });

    expect(await review.promoteNextFromWaitlist(event.eventId)).toBe(w1);
    expect((await statusOf(w1)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
    expect((await statusOf(w2)).waitlistPosition).toBe(1);
    expect((await statusOf(w3)).waitlistPosition).toBe(2);
  });

  it('does nothing when no seat is free', async () => {
    const { event, w1 } = await fullEventWithWaitlist();
    expect(await review.promoteNextFromWaitlist(event.eventId)).toBeNull();
    expect((await statusOf(w1)).waitlistPosition).toBe(1);
  });

  it('cancels an overdue confirmation without a blacklist entry and promotes waitlist #1', async () => {
    const { held1, w1, w2 } = await fullEventWithWaitlist();
    await makeOverdue([held1]);

    const outcome = await review.cancelOverdueConfirmationOffers();

    expect((await statusOf(held1)).status).toBe(RegistrationStatus.CANCELLED);
    expect(
      await prisma.registrationBlacklistEntry.count({
        where: { registrationId: held1 },
      }),
    ).toBe(0);
    expect(outcome.promoted).toContain(w1);
    expect((await statusOf(w1)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
    expect((await statusOf(w2)).waitlistPosition).toBe(1);
  });

  it('never promotes the same person twice when the job overlaps', async () => {
    const { event, held1, held2, w1, w2, w3 } = await fullEventWithWaitlist();
    await makeOverdue([held1, held2]);

    const [one, two] = await Promise.all([
      review.cancelOverdueConfirmationOffers(),
      review.cancelOverdueConfirmationOffers(),
    ]);

    // held1 and held2 are cancelled once; w1 and w2 fill the two seats once each.
    const promotedHere = [...one.promoted, ...two.promoted].filter((id) =>
      [w1, w2, w3].includes(id),
    );
    expect(promotedHere.sort()).toEqual([w1, w2].sort());
    expect(
      await prisma.eventRegistration.count({
        where: {
          eventId: event.eventId,
          status: RegistrationStatus.AWAITING_CONFIRMATION,
        },
      }),
    ).toBe(2);
    expect(await statusOf(w3)).toMatchObject({
      status: RegistrationStatus.WAITLISTED,
      waitlistPosition: 1,
    });
  });
});
