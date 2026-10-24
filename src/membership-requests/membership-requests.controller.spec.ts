import { type INestApplication, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthRequiredGuard } from '../auth/current-user.js';
import { AuthService } from '../auth/auth.service.js';
import { MembershipRequestsController } from './membership-requests.controller.js';
import { MembershipRequestService } from './membership-request.service.js';
import { VerifiedSupabaseEmailGuard } from './verified-supabase-email.guard.js';

let app: INestApplication;
let actor: { personId: number; memberId: number | null } | undefined;
const list = vi.fn();
const create = vi.fn();
const decide = vi.fn();
const isEmailVerified = vi.fn();

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [MembershipRequestsController],
    providers: [
      AuthRequiredGuard,
      VerifiedSupabaseEmailGuard,
      { provide: AuthService, useValue: { isEmailVerified } },
      { provide: MembershipRequestService, useValue: { list, create, decide } },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.use((req: { user?: typeof actor }, _res: unknown, next: () => void) => {
    if (actor) req.user = actor;
    next();
  });
  await app.init();
});

afterAll(async () => app.close());

beforeEach(() => {
  actor = undefined;
  list.mockReset();
  create.mockReset();
  decide.mockReset();
  isEmailVerified.mockReset().mockResolvedValue(true);
});

describe('membership request access', () => {
  it('returns 401 for unauthenticated list and decision requests', async () => {
    await request(app.getHttpServer())
      .get('/membership-requests?committeeCode=DATA')
      .expect(401);
    await request(app.getHttpServer())
      .patch('/membership-requests/4/committees/DATA')
      .send({ decision: 'APPROVED' })
      .expect(401);
    expect(list).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('returns 403 when the authenticated user lacks committee permission', async () => {
    actor = { personId: 12, memberId: 22 };
    list.mockRejectedValue(new ForbiddenException());

    await request(app.getHttpServer())
      .get('/membership-requests?committeeCode=DATA')
      .expect(403);
    expect(list).toHaveBeenCalledWith('DATA', 22);
  });

  it('allows an authorized committee leader to list and decide requests', async () => {
    actor = { personId: 12, memberId: 22 };
    list.mockResolvedValue([{ id: 4, status: 'PENDING' }]);
    decide.mockResolvedValue({ id: 4, committeeDecision: { status: 'APPROVED' } });

    await request(app.getHttpServer())
      .get('/membership-requests?committeeCode=DATA')
      .expect(200)
      .expect(({ body }) => expect(body.data).toEqual([{ id: 4, status: 'PENDING' }]));
    await request(app.getHttpServer())
      .patch('/membership-requests/4/committees/DATA')
      .send({ decision: 'APPROVED' })
      .expect(200);
    expect(list).toHaveBeenCalledWith('DATA', 22);
    expect(decide).toHaveBeenCalledWith(4, 'DATA', 'APPROVED', actor);
  });

  it('requires Supabase to confirm the applicant email before creation', async () => {
    actor = { personId: 12, memberId: null };
    isEmailVerified.mockResolvedValue(false);

    await request(app.getHttpServer())
      .post('/membership-requests')
      .set('Authorization', 'Bearer verified-by-auth-guard')
      .send({})
      .expect(403);
    expect(isEmailVerified).toHaveBeenCalledWith('verified-by-auth-guard');
    expect(create).not.toHaveBeenCalled();
  });

  it('allows a verified applicant to submit their own request', async () => {
    actor = { personId: 12, memberId: null };
    create.mockResolvedValue({ id: 4, status: 'PENDING' });
    const body = { applicationData: {}, committees: [] };

    await request(app.getHttpServer())
      .post('/membership-requests')
      .set('Authorization', 'Bearer verified-by-auth-guard')
      .send(body)
      .expect(201);
    expect(create).toHaveBeenCalledWith(actor, body);
  });
});
