import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureHttp } from '../src/configure-http.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ResendAuthEmailService } from '../src/auth/email/resend-auth-email.service.js';

// This suite requires an explicitly selected isolated local database, never a hosted URL.
describe('Better Auth through Nest HTTP', () => {
  let app: NestExpressApplication;
  const sent: Array<{ to: string; kind: string; url: string }> = [];
  const email = `nest-${randomUUID()}@example.test`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || process.env.NODE_ENV === 'production') throw new Error('Auth e2e requires an isolated local database');
    process.env.BETTER_AUTH_SECRET = 'local-nest-e2e-only-secret-at-least-32-characters';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ResendAuthEmailService).useValue({ send: async (message: typeof sent[number]) => { sent.push(message); } }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    if (!app) return;
    const db = app.get(PrismaService);
    const person = await db.person.findFirst({ where: { emailPersonal: email } });
    if (person) {
      await db.nonMemberRegistration.deleteMany({ where: { personId: person.personId } });
      await db.pendingSignup.deleteMany({ where: { personId: person.personId } });
      await db.personEmailIdentity.deleteMany({ where: { personId: person.personId } });
      await db.person.delete({ where: { personId: person.personId } });
    }
    await db.signupVerification.deleteMany({ where: { emailPersonal: email } });
    await db.authUser.deleteMany({ where: { email } });
    await app.close();
  });
  it('stages signup, requires verification, serves authenticated profile and revokes logout', async () => {
    const http = request(app.getHttpServer());
    await http.get('/me').expect(401);
    await http.post('/account/signup').set('Origin', 'http://localhost:3000').send({
      fullName: 'Synthetic Nest signup', email, password: 'local-e2e-password', locale: 'en', registrationType: 'NON_MEMBER',
      applicationData: { phoneNumber: '0500000000', university: 'University of Jeddah', college: 'Computing', major: 'CS', level: '1', gender: 'female' },
    }).expect(201);
    await http.post('/api/auth/sign-in/email').set('Origin', 'http://localhost:3000').send({ email, password: 'local-e2e-password' }).expect(403);
    const link = new URL(sent.find(message => message.kind === 'verification')!.url);
    await http.get(link.pathname + link.search).expect(302);
    const login = await http.post('/api/auth/sign-in/email').set('Origin', 'http://localhost:3000').send({ email, password: 'local-e2e-password' }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).map(value => value.split(';')[0]).join('; ');
    const profile = await http.get('/me').set('Cookie', cookie).expect(200);
    expect(profile.body.data.email).toBe(email);
    expect(profile.body.data.roles).toEqual([]);
    expect(profile.body.data.memberId).toBeNull();
    await http.patch('/me/bio').set('Cookie', cookie).set('Origin', 'https://attacker.invalid').send({ bio: 'denied' }).expect(403);
    await http.post('/api/auth/sign-out').set('Cookie', cookie).set('Origin', 'http://localhost:3000').send({}).expect(200);
    await http.get('/me').set('Cookie', cookie).expect(401);
  });
});
