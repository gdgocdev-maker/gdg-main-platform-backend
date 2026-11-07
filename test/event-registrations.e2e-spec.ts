import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { RegistrationStatus } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { GuestWalletRelayService } from '../src/registrations/guest-wallet-relay.service.js';
import { RegistrationEmailDeliveryService } from '../src/registrations/registration-email-delivery.service.js';
import { RegistrationEmailService } from '../src/registrations/registration-email.service.js';
import { RegistrationReviewService } from '../src/registrations/registration-review.service.js';
import { WalletProjectionService } from '../src/registrations/wallet-projection.service.js';
import { schemaTestTarget } from './schema-test-target.js';

// Runs against a separate local database, never the development one:
// TEST_DATABASE_URL=postgresql://.../gdg_schema_test_registrations?schema=public
process.env.DATABASE_URL = schemaTestTarget(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
  { allowSupabaseTestProject: true },
);
process.env.ATTENDANCE_TOKEN_KEY ??= randomBytes(32).toString('base64');

const HOUR = 3_600_000;
let app: INestApplication;
let prisma: PrismaService;
let review: RegistrationReviewService;
let prMemberId: number;
let creatorMemberId: number;
let committeeId: number;
// Stand-in for the auth layer: the person each HTTP request acts as.
let actingPersonId: number | undefined;
let actingMemberId: number | undefined;
let prPersonId: number;

async function createPerson() {
  const person = await prisma.person.create({
    data: { fullName: 'Guest', emailPersonal: `${randomUUID()}@test.local` },
  });
  return person.personId;
}

async function createEvent(
  options: {
    capacity?: number;
    status?: 'PUBLISHED' | 'DRAFT';
    deadlineInHours?: number;
    questions?: {
      questionText: string;
      questionType: 'TEXT' | 'SELECT' | 'RADIO' | 'CHECKBOX';
      isRequired?: boolean;
      options?: string[];
    }[];
  } = {},
) {
  const startsAt = new Date(Date.now() + 7 * 24 * HOUR);
  return prisma.event.create({
    data: {
      name: `Event ${randomUUID().slice(0, 8)}`,
      capacity: options.capacity ?? 30,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * HOUR),
      registrationDeadline: new Date(
        Date.now() + (options.deadlineInHours ?? 24) * HOUR,
      ),
      status: options.status ?? 'PUBLISHED',
      createdByMemberId: creatorMemberId,
      committeeId,
      questions: {
        create: (options.questions ?? []).map((question, position) => ({
          ...question,
          position,
        })),
      },
    },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
}

function as(personId: number | undefined) {
  actingPersonId = personId;
  actingMemberId = undefined;
  return request(app.getHttpServer());
}

async function registerVia(eventId: number, personId: number, answers = []) {
  const response = await as(personId)
    .post(`/events/${eventId}/registrations`)
    .send({ answers, discoverySource: 'GOOGLE' })
    .expect(201);
  return response.body.data.registrationId as number;
}

const statusOf = (registrationId: number) =>
  prisma.eventRegistration.findUniqueOrThrow({ where: { registrationId } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.use(
    (
      req: { user?: { personId: number; memberId?: number } },
      _res: unknown,
      next: () => void,
    ) => {
      if (actingPersonId) {
        req.user = { personId: actingPersonId, memberId: actingMemberId };
      }
      next();
    },
  );
  await app.init();
  app
    .get(SchedulerRegistry)
    .getCronJob('registration-confirmation-expiry')
    .stop();

  prisma = app.get(PrismaService);
  review = app.get(RegistrationReviewService);
  committeeId = (
    await prisma.committee.findUniqueOrThrow({ where: { committeeCode: 'PR' } })
  ).committeeId;
  const staff = await prisma.member.create({
    data: { personId: await createPerson() },
  });
  await prisma.memberCommittee.create({
    data: { memberId: staff.memberId, committeeId, role: 'Leader' },
  });
  prMemberId = staff.memberId;
  prPersonId = staff.personId;
  creatorMemberId = staff.memberId;
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  actingPersonId = undefined;
  actingMemberId = undefined;
});

describe('browsing events', () => {
  it('lists published events only, and shows my registration in details', async () => {
    const published = await createEvent({
      questions: [{ questionText: 'Why?', questionType: 'TEXT' }],
    });
    const draft = await createEvent({ status: 'DRAFT' });

    const list = await as(undefined).get('/events').expect(200);
    const ids = list.body.data.map((e: { eventId: number }) => e.eventId);
    expect(ids).toContain(published.eventId);
    expect(ids).not.toContain(draft.eventId);
    await as(undefined).get(`/events/${draft.eventId}`).expect(404);

    const person = await createPerson();
    const registrationId = await registerVia(published.eventId, person);
    const details = await as(person)
      .get(`/events/${published.eventId}`)
      .expect(200);
    expect(details.body.data).toMatchObject({
      registrationOpen: true,
      questions: [{ questionText: 'Why?', questionType: 'TEXT' }],
      myRegistration: { registrationId, status: 'PENDING' },
    });
  });
});

describe('POST /events/:eventId/registrations', () => {
  it('accepts more registrations than the capacity, all as PENDING', async () => {
    const event = await createEvent({ capacity: 2 });
    for (let i = 0; i < 5; i += 1) {
      await registerVia(event.eventId, await createPerson());
    }
    expect(
      await prisma.eventRegistration.count({
        where: { eventId: event.eventId, status: RegistrationStatus.PENDING },
      }),
    ).toBe(5);
  });

  it('rejects a duplicate registration, even when sent twice at once', async () => {
    const event = await createEvent();
    const person = await createPerson();

    const [first, second] = await Promise.all([
      as(person)
        .post(`/events/${event.eventId}/registrations`)
        .send({ discoverySource: 'GOOGLE' }),
      as(person)
        .post(`/events/${event.eventId}/registrations`)
        .send({ discoverySource: 'GOOGLE' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const again = await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({ discoverySource: 'GOOGLE' })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_REGISTERED');
  });

  it('checks answers and stores checkbox choices as a JSON list', async () => {
    const event = await createEvent({
      questions: [
        { questionText: 'Why?', questionType: 'TEXT', isRequired: true },
        {
          questionText: 'Topics',
          questionType: 'CHECKBOX',
          options: ['AI', 'Web', 'Cloud'],
        },
      ],
    });
    const [why, topics] = event.questions;
    const person = await createPerson();

    const missing = await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({
        discoverySource: 'GOOGLE',
        answers: [{ questionId: topics.questionId, answer: ['AI'] }],
      })
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({
        discoverySource: 'GOOGLE',
        answers: [
          { questionId: why.questionId, answer: 'Learning' },
          { questionId: topics.questionId, answer: ['Mobile'] },
        ],
      })
      .expect(400);

    const response = await as(person)
      .post(`/events/${event.eventId}/registrations`)
      .send({
        discoverySource: 'GOOGLE',
        answers: [
          { questionId: why.questionId, answer: 'Learning' },
          { questionId: topics.questionId, answer: ['AI', 'Cloud'] },
        ],
      })
      .expect(201);
    const answers = await prisma.registrationAnswer.findMany({
      where: { registrationId: response.body.data.registrationId },
      orderBy: { questionId: 'asc' },
    });
    expect(answers.map((a) => a.answerText)).toEqual([
      'Learning',
      '["AI","Cloud"]',
    ]);
  });

  it('refuses after the registration deadline and without sign-in', async () => {
    const closed = await createEvent({ deadlineInHours: -1 });
    const response = await as(await createPerson())
      .post(`/events/${closed.eventId}/registrations`)
      .send({ discoverySource: 'GOOGLE' })
      .expect(409);
    expect(response.body.error.code).toBe('REGISTRATION_CLOSED');

    const open = await createEvent();
    await as(undefined)
      .post(`/events/${open.eventId}/registrations`)
      .send({ discoverySource: 'GOOGLE' })
      .expect(401);
  });
});

describe('confirming and declining a seat', () => {
  async function offeredSeat(capacity = 30) {
    const event = await createEvent({ capacity });
    const person = await createPerson();
    const registrationId = await registerVia(event.eventId, person);
    await review.review(registrationId, 'ACCEPT', prMemberId);
    return { event, person, registrationId };
  }

  it('confirms within the deadline and issues the same QR token in my registrations', async () => {
    const { person, registrationId } = await offeredSeat();

    const confirmed = await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);
    const token = confirmed.body.data.attendanceToken;
    expect(token).toEqual(expect.any(String));
    expect(confirmed.body.data.attendanceQrCodeDataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.CONFIRMED,
    );

    const mine = await as(person).get('/my/registrations').expect(200);
    expect(mine.body.data[0]).toMatchObject({
      registrationId,
      status: 'CONFIRMED',
      attendanceQrCodeDataUrl: confirmed.body.data.attendanceQrCodeDataUrl,
      canConfirm: false,
    });
  });

  it('refuses to confirm after the 24 hours have passed', async () => {
    const { person, registrationId } = await offeredSeat();
    await prisma.eventRegistration.update({
      where: { registrationId },
      data: {
        approvedAt: new Date(Date.now() - 25 * HOUR),
        confirmationDeadline: new Date(Date.now() - HOUR),
      },
    });

    const response = await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(409);
    expect(response.body.error.code).toBe('CONFIRMATION_EXPIRED');
    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
  });

  it("answers 403 when someone confirms or declines another person's registration", async () => {
    const { registrationId } = await offeredSeat();
    const stranger = await createPerson();

    await as(stranger)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(403);
    await as(stranger)
      .post(`/registrations/${registrationId}/decline`)
      .expect(403);
    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
  });

  it('declining an offered seat promotes waitlist #1', async () => {
    const { event, person, registrationId } = await offeredSeat(1);
    const w1 = await registerVia(event.eventId, await createPerson());
    const w2 = await registerVia(event.eventId, await createPerson());
    await review.setWaitlist(event.eventId, [w1, w2], prMemberId);

    await as(person)
      .post(`/registrations/${registrationId}/decline`)
      .expect(200);

    expect((await statusOf(registrationId)).status).toBe(
      RegistrationStatus.DECLINED,
    );
    expect((await statusOf(w1)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
    expect(await statusOf(w2)).toMatchObject({
      status: RegistrationStatus.WAITLISTED,
      waitlistPosition: 1,
    });
  });

  it('cancelling a confirmed seat frees it for waitlist #1', async () => {
    const { event, person, registrationId } = await offeredSeat(1);
    const w1 = await registerVia(event.eventId, await createPerson());
    await review.setWaitlist(event.eventId, [w1], prMemberId);
    await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);

    const response = await as(person)
      .post(`/registrations/${registrationId}/decline`)
      .expect(200);

    expect(response.body.data.status).toBe('CANCELLED');
    expect((await statusOf(w1)).status).toBe(
      RegistrationStatus.AWAITING_CONFIRMATION,
    );
  });

  it('cancelling within two hours of the start is late and leaves a notice', async () => {
    const { event, person, registrationId } = await offeredSeat();
    await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);
    const startsAt = new Date(Date.now() + HOUR);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { registrationDeadline: startsAt, startsAt },
    });

    const response = await as(person)
      .post(`/registrations/${registrationId}/decline`)
      .expect(200);

    expect(response.body.data.status).toBe('LATE_CANCELLATION');
    expect(
      await prisma.registrationBlacklistEntry.count({
        where: { registrationId, reason: 'LATE_CANCELLATION' },
      }),
    ).toBe(1);
  });

  it('leaving the waitlist renumbers it without giving away a seat', async () => {
    const { event } = await offeredSeat(1);
    const leaver = await createPerson();
    const w1 = await registerVia(event.eventId, leaver);
    const w2 = await registerVia(event.eventId, await createPerson());
    await review.setWaitlist(event.eventId, [w1, w2], prMemberId);

    await as(leaver).post(`/registrations/${w1}/decline`).expect(200);

    expect(await statusOf(w1)).toMatchObject({
      status: RegistrationStatus.DECLINED,
      waitlistPosition: null,
    });
    expect(await statusOf(w2)).toMatchObject({
      status: RegistrationStatus.WAITLISTED,
      waitlistPosition: 1,
    });
  });
});

describe('POST /events/:eventId/check-in', () => {
  // PR staff scanning at the door.
  function asPrStaff() {
    const agent = as(prPersonId);
    actingMemberId = prMemberId;
    return agent;
  }

  // A confirmed guest of an event that starts in 30 minutes (scanning open).
  async function confirmedGuest() {
    const event = await createEvent();
    const person = await createPerson();
    const registrationId = await registerVia(event.eventId, person);
    await review.review(registrationId, 'ACCEPT', prMemberId);
    const confirmed = await as(person)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);
    const startsAt = new Date(Date.now() + 30 * 60_000);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { registrationDeadline: startsAt, startsAt },
    });
    return {
      event,
      registrationId,
      token: confirmed.body.data.attendanceToken as string,
    };
  }

  it('allows only the owner worker to retrieve scoped guest tickets and lease delivery for the current schedule', async () => {
    const { event, registrationId, token } = await confirmedGuest();
    const config = app.get(ConfigService);
    const workerToken = randomBytes(32).toString('base64url');
    const workerHeaders = { Authorization: `Bearer ${workerToken}` };
    const base = '/wallet-worker/v1/guest-tickets';
    const path = `${base}/${registrationId}`;
    const registration = await statusOf(registrationId);
    await prisma.person.update({
      where: { personId: registration.personId },
      data: { emailPersonalVerifiedAt: new Date() },
    });
    config.set('WALLET_GUEST_WORKER_TOKEN', workerToken);
    config.set('WALLET_GUEST_COMMITTEES', 'PM');
    try {
      await as(undefined).get(path).expect(401);
      await as(undefined).get(path).set(workerHeaders).expect(404);
      config.set('WALLET_GUEST_COMMITTEES', 'PR');
      const list = await as(undefined)
        .get(`${base}?after=${registrationId - 1}`)
        .set(workerHeaders)
        .expect(200);
      expect(list.body.items).toContain(registrationId);
      const first = await as(undefined)
        .get(path)
        .set(workerHeaders)
        .expect('Cache-Control', 'no-store')
        .expect(200);
      expect(first.body).toMatchObject({ active: true, barcode: token });
      expect(first.body).not.toHaveProperty('email');
      const updatedEnd = new Date(event.endsAt.getTime() + HOUR);
      await prisma.event.update({
        where: { eventId: event.eventId },
        data: { endsAt: updatedEnd },
      });
      await as(undefined)
        .post(`${path}/email/claim`)
        .set(workerHeaders)
        .send({ startsAt: first.body.startsAt, endsAt: first.body.endsAt })
        .expect(409);
      const currentSchedule = {
        startsAt: first.body.startsAt,
        endsAt: updatedEnd.toISOString(),
      };
      const claims = await Promise.all(
        [0, 1].map(() =>
          as(undefined)
            .post(`${path}/email/claim`)
            .set(workerHeaders)
            .send(currentSchedule)
            .expect(200),
        ),
      );
      const leases = claims.flatMap(({ body }) =>
        body.email ? [body.email] : [],
      );
      expect(leases).toHaveLength(1);
      expect(leases[0].recipient).toMatch(/@test.local$/);
      await as(undefined)
        .post(`${path}/email/result`)
        .set(workerHeaders)
        .send({ lease: new Date().toISOString(), state: 'SENT' })
        .expect(409);
      await as(undefined)
        .post(`${path}/email/result`)
        .set(workerHeaders)
        .send({ lease: leases[0].lease, state: 'SENT' })
        .expect(204);
      const next = await as(undefined)
        .post(`${path}/email/claim`)
        .set(workerHeaders)
        .send(currentSchedule)
        .expect(200);
      expect(next.body.email).toBeNull();
      await prisma.event.update({
        where: { eventId: event.eventId },
        data: { status: 'CANCELLED' },
      });
      const cancelled = await as(undefined)
        .get(path)
        .set(workerHeaders)
        .expect(200);
      expect(cancelled.body).toEqual({ active: false, expired: false });
    } finally {
      config.set('WALLET_GUEST_WORKER_TOKEN', '');
      config.set('WALLET_GUEST_COMMITTEES', '');
    }
  });

  it('requests a guest pass from Wallet and sends the ready link from GDG', async () => {
    const { event, registrationId, token } = await confirmedGuest();
    const config = app.get(ConfigService);
    const relay = app.get(GuestWalletRelayService);
    const emailDelivery = app.get(RegistrationEmailDeliveryService);
    const committeeCode =
      'WTEST_' + randomBytes(4).toString('hex').toUpperCase();
    const committee = await prisma.committee.create({
      data: { committeeCode, committeeName: committeeCode },
    });
    const registration = await statusOf(registrationId);
    await prisma.person.update({
      where: { personId: registration.personId },
      data: { emailPersonalVerifiedAt: new Date() },
    });
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { committeeId: committee.committeeId },
    });
    const auth = randomBytes(32).toString('base64url');
    config.set('WALLET_GUEST_RELAY_TOKEN', auth);
    config.set('WALLET_GUEST_RELAY_ORIGIN', 'http://127.0.0.1:9870');
    config.set('WALLET_GUEST_COMMITTEES', committeeCode);
    let state: 'PENDING' | 'PUBLISHED' = 'PENDING';
    let revision = 0;
    const walletUrl = `http://127.0.0.1:9870/m/${randomBytes(32).toString('base64url')}/id.pkpass`;
    const sendMock = vi
      .spyOn(app.get(RegistrationEmailService), 'send')
      .mockRejectedValueOnce(new Error('Simulated GDG SMTP failure'))
      .mockResolvedValue(undefined);
    const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        expect(String(input)).toBe(
          `http://127.0.0.1:9870/integrations/v1/guest-tickets/${committeeCode}/${registrationId}`,
        );
        expect(new Headers(init?.headers).get('Authorization')).toBe(
          `Bearer ${auth}`,
        );
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method: init?.method ?? 'GET', body });
        if (body) {
          revision = body.revision;
          state = 'PENDING';
        }
        return Response.json({
          revision,
          deliveryId: null,
          emailState: 'NONE',
          walletState: state,
          ...(state === 'PUBLISHED' ? { walletUrl } : {}),
        });
      });
    try {
      await relay.sync();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        method: 'PUT',
        body: { active: true, revision: 1, barcode: token, emailByGdg: true },
      });
      expect(calls[0].body).not.toHaveProperty('email');
      expect(sendMock).not.toHaveBeenCalled();
      const firstDelivery = await prisma.registrationEmailDelivery.findFirstOrThrow({
        where: { registrationId, kind: 'CONFIRMED' },
      });
      expect(
        (
          await prisma.walletGuestProjection.findUniqueOrThrow({
            where: { registrationId },
          })
        ).pending,
      ).toBe(false);
      state = 'PUBLISHED';
      await relay.sync();
      expect(calls.at(-1)?.method).toBe('GET');
      expect(
        (
          await prisma.registrationEmailDelivery.findUniqueOrThrow({
            where: { id: firstDelivery.id },
          })
        ).state,
      ).toBe('FAILED');
      await emailDelivery.retry(registrationId, prMemberId);
      const latestDelivery = await prisma.registrationEmailDelivery.findFirstOrThrow({
        where: { registrationId, kind: 'CONFIRMED', state: 'PENDING' },
      });
      expect(latestDelivery.id).toBeGreaterThan(firstDelivery.id);
      await relay.sync();
      expect(calls.at(-1)?.method).toBe('GET');
      expect(sendMock).toHaveBeenLastCalledWith(expect.objectContaining({
        to: expect.stringMatching(/@test.local$/),
        walletUrl,
        attendanceQrCodeDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      }));
      expect(
        (
          await prisma.registrationEmailDelivery.findUniqueOrThrow({
            where: { id: latestDelivery.id },
          })
        ).state,
      ).toBe('SENT');
      const endsAt = new Date(event.endsAt.getTime() + HOUR);
      await prisma.event.update({
        where: { eventId: event.eventId },
        data: { endsAt },
      });
      await relay.sync();
      expect(calls.at(-1)).toMatchObject({
        method: 'PUT',
        body: {
          active: true,
          revision: 2,
          endsAt: endsAt.toISOString(),
          emailByGdg: true,
        },
      });
      await prisma.event.update({
        where: { eventId: event.eventId },
        data: { status: 'CANCELLED' },
      });
      await relay.sync();
      expect(calls.at(-1)).toEqual({
        method: 'PUT',
        body: { active: false, expired: false, revision: 3 },
      });
      const count = calls.length;
      await relay.sync();
      expect(calls).toHaveLength(count);
      expect(sendMock).toHaveBeenCalledTimes(2);
    } finally {
      sendMock.mockRestore();
      fetchMock.mockRestore();
      config.set('WALLET_GUEST_RELAY_TOKEN', '');
      config.set('WALLET_GUEST_RELAY_ORIGIN', '');
      config.set('WALLET_GUEST_COMMITTEES', '');
    }
  });

  it('checks in once, then answers Already Checked In', async () => {
    const { event, registrationId, token } = await confirmedGuest();

    const first = await asPrStaff()
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(200);
    expect(first.body.data).toMatchObject({ registrationId, name: 'Guest' });
    expect((await statusOf(registrationId)).checkedInAt).not.toBeNull();

    const again = await asPrStaff()
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');

    const list = await asPrStaff()
      .get(`/events/${event.eventId}/registrations`)
      .expect(200);
    expect(list.body.data.summary).toMatchObject({
      confirmed: 1,
      checkedIn: 1,
      notCheckedIn: 0,
    });
  });

  it('confirms a member without a workshop QR and checks two linked card codes in only once', async () => {
    const event = await createEvent();
    const personId = await createPerson();
    const member = await prisma.member.create({ data: { personId } });
    const codes = [`GDG-UJ:MEMBER:${randomUUID()}`, `gdg:${randomUUID()}`];
    for (const token of codes) {
      await prisma.walletMembershipLink.create({
        data: {
          walletPublicId: randomUUID(),
          memberId: member.memberId,
          barcodeAliases: {
            create: {
              barcodeHash: createHash('sha256').update(token).digest('hex'),
            },
          },
        },
      });
    }
    const registrationId = await registerVia(event.eventId, personId);
    await review.review(registrationId, 'ACCEPT', prMemberId);
    const confirmed = await as(personId)
      .post(`/registrations/${registrationId}/confirm`)
      .expect(200);
    expect(confirmed.body.data).toMatchObject({
      attendanceMethod: 'MEMBER_CARD',
      attendanceQrCodeDataUrl: null,
    });
    expect(confirmed.body.data).not.toHaveProperty('attendanceToken');
    expect((await statusOf(registrationId)).attendanceTokenHash).toBeNull();

    const startsAt = new Date(Date.now() + 30 * 60_000);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { registrationDeadline: startsAt, startsAt },
    });
    const path = `/events/${event.eventId}/check-in`;
    const results = await Promise.all(
      codes.map((token) => asPrStaff().post(path).send({ token })),
    );
    expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(results.find(({ status }) => status === 409)?.body.error.code).toBe(
      'ALREADY_CHECKED_IN',
    );
  });

  it('requeues only the failed email without creating a second decision or attendance QR', async () => {
    const { registrationId } = await confirmedGuest();
    const original = await statusOf(registrationId);
    const delivery = await prisma.registrationEmailDelivery.findFirstOrThrow({
      where: { registrationId, kind: 'CONFIRMED' },
    });
    expect(delivery.state).toBe('PENDING');
    await prisma.registrationEmailDelivery.update({
      where: { id: delivery.id },
      data: { state: 'FAILED' },
    });
    const route = `/registrations/${registrationId}/email/retry`;
    await as(await createPerson())
      .post(route)
      .expect(403);
    const attempts = await Promise.all([
      asPrStaff().post(route),
      asPrStaff().post(route),
    ]);
    expect(attempts.map(({ status }) => status).sort()).toEqual([202, 409]);
    expect(
      (
        await prisma.registrationEmailDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).state,
    ).toBe('PENDING');
    expect(
      await prisma.registrationEmailDelivery.count({
        where: { registrationId, kind: 'CONFIRMED' },
      }),
    ).toBe(1);
    expect(await statusOf(registrationId)).toEqual(original);
  });

  it('projects an accepted event to opted-in Wallet links with the scoped version and clears it after cancellation', async () => {
    const event = await createEvent();
    const personId = await createPerson();
    const member = await prisma.member.create({ data: { personId } });
    const walletPublicId = randomUUID();
    const otherId = randomUUID();
    await prisma.walletMembershipLink.createMany({
      data: [
        { walletPublicId, memberId: member.memberId, syncNextEvent: true },
        { walletPublicId: otherId, memberId: member.memberId },
      ],
    });
    const registrationId = await registerVia(event.eventId, personId);
    await review.review(registrationId, 'ACCEPT', prMemberId);

    const worker = new WalletProjectionService(
      prisma,
      new ConfigService({
        WALLET_PROJECTION_URL: 'http://127.0.0.1:61999',
        WALLET_PROJECTION_TOKEN: 'synthetic-scope',
      }),
    );
    const members = [
      {
        membership_id: walletPublicId,
        version: 4,
        pending: false,
        next_event: '',
      },
      {
        membership_id: otherId,
        version: 1,
        pending: false,
        next_event: 'Owner only',
      },
    ];
    const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (init?.method === 'PATCH') {
          writes.push({ url, body: JSON.parse(String(init.body)) });
          expect(init.headers).toMatchObject({
            Authorization: 'Bearer synthetic-scope',
          });
          return Response.json({}, { status: 202 });
        }
        return Response.json({ members, next_cursor: null });
      });
    try {
      await worker.sync();
      await worker.sync();
      expect(writes).toHaveLength(2);
      expect(writes[0]).toEqual(writes[1]);
      expect(writes[0].url).toContain(walletPublicId);
      expect(writes[0].body).toMatchObject({
        expected_version: 4,
        changes: {
          next_event: {
            event_id: String(event.eventId),
            registration_id: String(registrationId),
            status: 'approved',
          },
        },
      });

      const movedStart = new Date(Date.now() + 12 * HOUR);
      const movedEnd = new Date(movedStart.getTime() + HOUR);
      await asPrStaff()
        .patch(`/committees/PR/events/${event.eventId}`)
        .send({
          startsAt: movedStart.toISOString(),
          endsAt: movedEnd.toISOString(),
          registrationDeadline: movedStart.toISOString(),
        })
        .expect(200);
      expect((await statusOf(registrationId)).confirmationDeadline).toEqual(
        movedStart,
      );
      members[0].version = 5;
      members[0].next_event = 'Old date (KSA)';
      await worker.sync();
      expect(writes.at(-1)?.body).toMatchObject({
        expected_version: 5,
        changes: {
          next_event: {
            starts_at: movedStart.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          },
        },
      });

      await as(personId)
        .post(`/registrations/${registrationId}/decline`)
        .expect(200);
      members[0].version = 6;
      members[0].next_event = 'Last event (KSA)';
      await worker.sync();
      expect(writes.at(-1)?.body).toMatchObject({
        expected_version: 6,
        changes: { next_event: null },
      });
    } finally {
      fetchStub.mockRestore();
    }
  });

  it('answers Invalid QR Code for an unknown token or another event', async () => {
    const { token } = await confirmedGuest();
    const other = await createEvent();

    for (const [eventId, sent] of [
      [other.eventId, token],
      [other.eventId, 'not-a-real-token'],
    ] as const) {
      const response = await asPrStaff()
        .post(`/events/${eventId}/check-in`)
        .send({ token: sent })
        .expect(400);
      expect(response.body.error.code).toBe('INVALID_QR_CODE');
    }
  });

  it('refuses outside the check-in window and for non-PR accounts', async () => {
    const { event, token } = await confirmedGuest();
    await as(await createPerson())
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(403);

    const later = new Date(Date.now() + 5 * HOUR);
    await prisma.event.update({
      where: { eventId: event.eventId },
      data: { startsAt: later, endsAt: new Date(later.getTime() + HOUR) },
    });
    const closed = await asPrStaff()
      .post(`/events/${event.eventId}/check-in`)
      .send({ token })
      .expect(409);
    expect(closed.body.error.code).toBe('CHECK_IN_CLOSED');
  });
});
