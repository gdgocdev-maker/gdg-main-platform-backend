// Run after build/migrate with an explicitly selected disposable loopback database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { AuthService } from '../dist/auth/auth.service.js';
import { createBetterAuth } from '../dist/auth/better-auth.factory.js';
import { assertLocalDatabase, importPlan, planImport } from '../scripts/import-supabase-auth.mjs';

test('Prisma auth: verify, sign in, reset, and imported bcrypt', async () => {
  assertLocalDatabase(process.env.DATABASE_URL ?? '');
  process.env.BETTER_AUTH_SECRET = 'local-test-only-secret-not-for-deployment-12345';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const deliveries = [];
  const testIp = `192.0.2.${1 + Math.floor(Math.random() * 250)}`;
  const auth = createBetterAuth(prisma, { send: async message => { deliveries.push(message); } });
  const call = async (path, body) => auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-gdg-client-ip': testIp, origin: 'http://localhost:3000' }, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  const email = `test-${randomUUID()}@example.test`;
  const importedId = randomUUID();
  const importedEmail = `import-${importedId}@example.test`;
  try {
    const service = new AuthService(prisma, { auth });
    const signup = await service.signup({ fullName: 'Local Test', email, password: 'strong-password-123', locale: 'ar', registrationType: 'NON_MEMBER', applicationData: { phoneNumber: '0500000000', university: 'University of Jeddah', college: 'Computing', major: 'CS', level: '1', gender: 'female' } });
    assert.equal(signup.emailVerificationRequired, true);
    assert.equal(await prisma.person.findFirst({ where: { emailPersonal: email } }), null);
    assert.equal((await call('/sign-in/email', { email, password: 'strong-password-123' })).status, 403);
    const verify = deliveries.find(message => message.to === email && message.kind === 'verification');
    assert.equal(verify.locale, 'ar');
    assert.equal((await auth.handler(new Request(verify.url))).status, 302);
    const login = await call('/sign-in/email', { email, password: 'strong-password-123' });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
    const identity = await prisma.authUser.findUniqueOrThrow({ where: { email } });
    await service.reconcileVerifiedIdentity(identity);
    await service.reconcileVerifiedIdentity(identity);
    const person = await prisma.person.findUniqueOrThrow({ where: { authUserId: identity.id }, include: { member: true, nonMemberRegistration: true } });
    assert.equal(person.member, null);
    assert.ok(person.nonMemberRegistration);
    assert.equal(await prisma.signupVerification.findUnique({ where: { authUserId: identity.id } }), null);
    assert.equal((await call('/request-password-reset', { email, redirectTo: 'http://localhost:3000/ar/reset-password' })).status, 200);
    const reset = deliveries.find(message => message.kind === 'reset');
    const resetRedirect = await auth.handler(new Request(reset.url));
    const token = new URL(resetRedirect.headers.get('location')).searchParams.get('token');
    assert.ok(token);
    assert.equal((await call('/reset-password', { token, newPassword: 'changed-password-123' })).status, 200);
    assert.equal((await call('/reset-password', { token, newPassword: 'other-password-123' })).status, 400);
    assert.equal((await call('/sign-in/email', { email, password: 'strong-password-123' })).status, 401);
    assert.equal((await call('/sign-in/email', { email, password: 'changed-password-123' })).status, 200);
    const plan = planImport({ users: [{ id: importedId, email: importedEmail, email_confirmed_at: new Date().toISOString(), encrypted_password: await bcrypt.hash('legacy-password-123', 10) }], identities: [{ user_id: importedId, provider: 'google', identity_data: { sub: `google-${importedId}` } }] });
    await importPlan(prisma, plan, false);
    assert.equal(await prisma.authUser.findUnique({ where: { id: importedId } }), null);
    await importPlan(prisma, plan, true);
    await importPlan(prisma, plan, true);
    assert.equal((await call('/sign-in/email', { email: importedEmail, password: 'legacy-password-123' })).status, 200);
    assert.equal((await call('/sign-in/email', { email: importedEmail, password: 'wrong-password' })).status, 429);
  } finally {
    const person = await prisma.person.findFirst({ where: { emailPersonal: email } });
    if (person) {
      await prisma.nonMemberRegistration.deleteMany({ where: { personId: person.personId } });
      await prisma.pendingSignup.deleteMany({ where: { personId: person.personId } });
      await prisma.personEmailIdentity.deleteMany({ where: { personId: person.personId } });
      await prisma.person.delete({ where: { personId: person.personId } });
    }
    await prisma.signupVerification.deleteMany({ where: { emailPersonal: email } });
    await prisma.authUser.deleteMany({ where: { email: { in: [email, importedEmail] } } });
    await prisma.$disconnect();
  }
});
