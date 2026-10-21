import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { schemaTestTarget } from './schema-test-target.js';

process.env.DATABASE_URL = schemaTestTarget(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
);

let app: INestApplication;
let prisma: PrismaService;
let dataCommitteeId: number;
let prCommitteeId: number;
let dataLeaderId: number;
let dataCoLeaderId: number;
let dataMemberId: number;
let prLeaderId: number;
let actingMemberId: number | undefined;
const personByMember = new Map<number, number>();

async function createMember(committeeId: number, role: string) {
  const person = await prisma.person.create({
    data: {
      fullName: `Event Manager ${randomUUID()}`,
      emailPersonal: `${randomUUID()}@test.local`,
    },
  });
  const member = await prisma.member.create({
    data: { personId: person.personId },
  });
  await prisma.memberCommittee.create({
    data: { memberId: member.memberId, committeeId, role },
  });
  personByMember.set(member.memberId, person.personId);
  return { memberId: member.memberId, personId: person.personId };
}

function asMember(memberId?: number) {
  actingMemberId = memberId;
  return request(app.getHttpServer());
}

function eventBody() {
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    name: `Managed event ${randomUUID().slice(0, 8)}`,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    capacity: 25,
    registrationDeadline: startsAt.toISOString(),
  };
}

async function createEvent(
  memberId: number,
  committeeId: number,
  status: 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'CANCELLED',
) {
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return prisma.event.create({
    data: {
      name: `Dashboard event ${randomUUID().slice(0, 8)}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
      registrationDeadline: startsAt,
      capacity: 25,
      status,
      createdByMemberId: memberId,
      committeeId,
    },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.use(
    (
      req: { user?: { personId: number; memberId: number } },
      _res: unknown,
      next: () => void,
    ) => {
      if (actingMemberId !== undefined) {
        req.user = {
          personId: personByMember.get(actingMemberId)!,
          memberId: actingMemberId,
        };
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
  dataCommitteeId = (
    await prisma.committee.findUniqueOrThrow({
      where: { committeeCode: 'DATA' },
    })
  ).committeeId;
  prCommitteeId = (
    await prisma.committee.findUniqueOrThrow({
      where: { committeeCode: 'PR' },
    })
  ).committeeId;

  const dataLeader = await createMember(dataCommitteeId, 'Leader');
  dataLeaderId = dataLeader.memberId;
  dataCoLeaderId = (await createMember(dataCommitteeId, 'Co-Leader')).memberId;
  dataMemberId = (await createMember(dataCommitteeId, 'Member')).memberId;
  prLeaderId = (await createMember(prCommitteeId, 'Leader')).memberId;

  await prisma.committeePermission.createMany({
    data: [
      {
        committeeId: prCommitteeId,
        committeeRole: 'Leader',
        code: 'events.create',
        appliesTo: 'own',
      },
    ],
    skipDuplicates: true,
  });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  actingMemberId = undefined;
});

describe('DATA event management authorization', () => {
  it('requires authentication and denies regular and other-committee members', async () => {
    await asMember().post('/events').send(eventBody()).expect(401);
    await asMember(dataMemberId).post('/events').send(eventBody()).expect(403);
    await asMember(prLeaderId).post('/events').send(eventBody()).expect(403);
  });

  it('creates events and questions using the authenticated creator and DATA committee', async () => {
    const invalid = await asMember(dataLeaderId)
      .post('/events')
      .send({ ...eventBody(), createdByMemberId: prLeaderId })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const response = await asMember(dataLeaderId)
      .post('/events')
      .send({
        ...eventBody(),
        questions: [
          {
            questionText: 'Why do you want to attend?',
            questionType: 'TEXT',
            isRequired: true,
          },
          {
            questionText: 'Choose a topic',
            questionType: 'SELECT',
            options: ['Data', 'AI'],
          },
        ],
      })
      .expect(201);
    expect(response.body.data).toMatchObject({
      createdByMemberId: dataLeaderId,
      committeeId: dataCommitteeId,
      status: 'DRAFT',
      questions: [
        { position: 0, questionType: 'TEXT', isRequired: true },
        { position: 1, questionType: 'SELECT', options: ['Data', 'AI'] },
      ],
    });
    expect(
      await prisma.event.findUniqueOrThrow({
        where: { eventId: response.body.data.eventId },
        select: { createdByMemberId: true },
      }),
    ).toEqual({ createdByMemberId: dataLeaderId });

    const coLeaderEvent = await asMember(dataCoLeaderId)
      .post('/events')
      .send(eventBody())
      .expect(201);
    expect(coLeaderEvent.body.data.createdByMemberId).toBe(dataCoLeaderId);
  });
});

describe('PATCH and DELETE /events/:eventId', () => {
  it('allows the creator, denies a different DATA leader, and returns 404 for a missing event', async () => {
    const created = await asMember(dataLeaderId)
      .post('/events')
      .send({
        ...eventBody(),
        questions: [
          { questionText: 'First question', questionType: 'TEXT' },
          { questionText: 'Second question', questionType: 'TEXT' },
        ],
      })
      .expect(201);
    const eventId = created.body.data.eventId as number;
    const [firstQuestion, secondQuestion] = created.body.data.questions as {
      questionId: number;
    }[];

    await asMember(dataCoLeaderId)
      .patch(`/events/${eventId}`)
      .send({ name: 'Changed by another leader' })
      .expect(403);

    const updated = await asMember(dataLeaderId)
      .patch(`/events/${eventId}`)
      .send({
        name: 'Updated by creator',
        status: 'PUBLISHED',
        questions: [
          {
            questionId: secondQuestion.questionId,
            questionText: 'Second question updated',
            questionType: 'TEXT',
          },
          {
            questionId: firstQuestion.questionId,
            questionText: 'First question updated',
            questionType: 'TEXT',
            isRequired: true,
          },
          { questionText: 'New question', questionType: 'TEXT' },
        ],
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      eventId,
      name: 'Updated by creator',
      status: 'PUBLISHED',
      questions: [
        { position: 0, questionText: 'Second question updated' },
        {
          position: 1,
          questionText: 'First question updated',
          isRequired: true,
        },
        { position: 2, questionText: 'New question' },
      ],
    });

    await asMember(dataLeaderId)
      .patch('/events/2147483647')
      .send({})
      .expect(404);
    await asMember(dataCoLeaderId).delete(`/events/${eventId}`).expect(403);
    await asMember(dataLeaderId).delete(`/events/${eventId}`).expect(200);
    expect(await prisma.event.findUnique({ where: { eventId } })).toBeNull();
  });
});

describe('GET /dashboard/events', () => {
  it('includes every status for the member committee and excludes unrelated committees', async () => {
    const ownDraft = await createEvent(dataLeaderId, dataCommitteeId, 'DRAFT');
    const committeePublished = await createEvent(
      dataMemberId,
      dataCommitteeId,
      'PUBLISHED',
    );
    const committeeCompleted = await createEvent(
      dataLeaderId,
      dataCommitteeId,
      'COMPLETED',
    );
    const committeeCancelled = await createEvent(
      dataLeaderId,
      dataCommitteeId,
      'CANCELLED',
    );
    const otherCommittee = await createEvent(
      prLeaderId,
      prCommitteeId,
      'PUBLISHED',
    );

    const response = await asMember(dataLeaderId)
      .get('/dashboard/events')
      .expect(200);
    const events = response.body.data as { eventId: number; status: string }[];
    const byId = new Map(events.map((event) => [event.eventId, event]));
    expect(byId.get(ownDraft.eventId)?.status).toBe('DRAFT');
    expect(byId.get(committeePublished.eventId)?.status).toBe('PUBLISHED');
    expect(byId.get(committeeCompleted.eventId)?.status).toBe('COMPLETED');
    expect(byId.get(committeeCancelled.eventId)?.status).toBe('CANCELLED');
    expect(byId.has(otherCommittee.eventId)).toBe(false);
  });
});
