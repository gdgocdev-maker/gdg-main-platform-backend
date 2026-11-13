import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { createBetterAuth } from '../dist/auth/better-auth.factory.js';
import { AuthService } from '../dist/auth/auth.service.js';
import { assertLocalDatabase } from '../scripts/import-supabase-auth.mjs';

const cookies = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
async function fixture() {
  assertLocalDatabase(process.env.DATABASE_URL ?? '');
  Object.assign(process.env, { BETTER_AUTH_SECRET: 'local-security-test-secret-not-for-production-12345', FRONTEND_URL: 'http://localhost:3000', BETTER_AUTH_URL: 'http://localhost:3000', GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret' });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const sent = [];
  const auth = createBetterAuth(prisma, { send: async message => sent.push(message) });
  const service = new AuthService(prisma, { auth });
  const email = `${randomUUID()}@example.test`;
  const ip = `fd00::${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}`;
  const call = (path, body, cookie = '') => auth.handler(new Request(`http://localhost:3000/api/auth${path}`, { method: body ? 'POST' : 'GET', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-gdg-client-ip': ip, cookie }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const clean = async () => {
    const users = await prisma.authUser.findMany({ where: { OR: [{ email }, { email: `changed-${email}` }] } });
    const people = await prisma.person.findMany({ where: { OR: [{ emailPersonal: email }, { emailPersonal: `changed-${email}` }] } });
    for (const person of people) { await prisma.personEmailIdentity.deleteMany({ where: { personId: person.personId } }); await prisma.person.delete({ where: { personId: person.personId } }); }
    await prisma.authVerification.deleteMany({ where: { value: { in: users.map(user => user.id) } } });
    await prisma.authUser.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    await prisma.$disconnect();
  };
  return { prisma, sent, auth, service, email, call, clean };
}

test('application-only person proves inbox ownership before linking; recovery is single-use and revokes sessions', async () => {
  const f = await fixture();
  try {
    const person = await f.prisma.person.create({ data: { fullName: 'Synthetic unlinked person', emailPersonal: f.email } });
    await f.service.requestPasswordReset({ email: f.email, locale: 'ar' });
    assert.equal((await f.prisma.person.findUnique({ where: { personId: person.personId } })).authUserId, null);
    const user = await f.prisma.authUser.findUniqueOrThrow({ where: { email: f.email } });
    assert.equal(user.emailVerified, false);
    await f.service.reconcileVerifiedIdentity(user);
    assert.equal((await f.prisma.person.findUnique({ where: { personId: person.personId } })).authUserId, null);
    assert.equal(f.sent[0].locale, 'ar');
    const token = new URL(f.sent[0].url).pathname.split('/').at(-1);
    assert.equal((await f.call('/reset-password', { token, newPassword: 'verified-inbox-password' })).status, 200);
    const verified = await f.prisma.authUser.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(verified.emailVerified, true);
    await f.service.reconcileVerifiedIdentity(verified);
    assert.equal((await f.prisma.person.findUnique({ where: { personId: person.personId } })).authUserId, user.id);
    const login = await f.call('/sign-in/email', { email: f.email, password: 'verified-inbox-password' });
    assert.equal(login.status, 200); const cookie = cookies(login);
    assert.ok((await (await f.call('/get-session', undefined, cookie)).json())?.session);
    await f.service.requestPasswordReset({ email: f.email });
    const second = new URL(f.sent.at(-1).url).pathname.split('/').at(-1);
    assert.equal((await f.call('/reset-password', { token: second, newPassword: 'replacement-password' })).status, 200);
    assert.equal(await (await f.call('/get-session', undefined, cookie)).json(), null);
    assert.equal((await f.call('/reset-password', { token: second, newPassword: 'replay-password' })).status, 400);
    const before = f.sent.length;
    await f.service.requestPasswordReset({ email: `unknown-${f.email}` });
    assert.equal(f.sent.length, before);
  } finally { await f.clean(); }
});

test('mocked Google callback validates state and links verified Google email to the same user ID', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch;
  try {
    await f.auth.api.signUpEmail({ body: { email: f.email, password: 'google-linked-password', name: 'Synthetic Google user' } });
    await f.auth.handler(new Request(f.sent.find(message => message.kind === 'verification').url));
    const existing = await f.prisma.authUser.findUniqueOrThrow({ where: { email: f.email } });
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey), kid: 'synthetic-google-key', alg: 'RS256', use: 'sig' };
    const signIdentity = async (verified) => new SignJWT({ email: f.email, email_verified: verified, name: 'Synthetic Google user' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer('https://accounts.google.com').setAudience('synthetic-client').setSubject(`google-${existing.id}`).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    let idToken = await signIdentity(false);
    let tokenExchanges = 0;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url ?? input.toString();
      if (url === 'https://oauth2.googleapis.com/token') { tokenExchanges++; return Response.json({ access_token: 'synthetic-access', token_type: 'Bearer', expires_in: 3600, id_token: idToken }); }
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
      throw new Error(`Unexpected external request in mock OAuth test: ${new URL(url).origin}`);
    };
    const begin = async () => {
      const response = await f.call('/sign-in/social', { provider: 'google', callbackURL: 'http://localhost:3000/en/auth/callback' });
      assert.equal(response.status, 200); const data = await response.json();
      return { state: new URL(data.url).searchParams.get('state'), cookie: cookies(response) };
    };
    const bad = await begin();
    const rejected = await f.call('/callback/google?code=synthetic&state=wrong-state', undefined, bad.cookie);
    assert.match(rejected.headers.get('location') ?? '', /error=/);
    assert.equal(tokenExchanges, 0);
    const unverified = await begin();
    const denied = await f.call(`/callback/google?code=synthetic&state=${encodeURIComponent(unverified.state)}`, undefined, unverified.cookie);
    assert.match(denied.headers.get('location') ?? '', /error=/);
    assert.equal(await (await f.call('/get-session', undefined, cookies(denied))).json(), null);
    assert.equal(await f.prisma.authAccount.count({ where: { userId: existing.id, providerId: 'google' } }), 0);
    idToken = await signIdentity(true);
    const good = await begin();
    const accepted = await f.call(`/callback/google?code=synthetic&state=${encodeURIComponent(good.state)}`, undefined, good.cookie);
    assert.equal(accepted.status, 302);
    assert.equal(accepted.headers.get('location'), 'http://localhost:3000/en/auth/callback');
    const session = await (await f.call('/get-session', undefined, cookies(accepted))).json();
    assert.equal(session.user.id, existing.id);
    assert.equal(await f.prisma.authUser.count({ where: { email: f.email } }), 1);
    assert.equal((await f.prisma.authAccount.findFirst({ where: { userId: existing.id, providerId: 'google' } })).accountId, `google-${existing.id}`);
  } finally { globalThis.fetch = originalFetch; await f.clean(); }
});

test('email change confirms both addresses, synchronizes Person, and invalidates old recovery links', async () => {
  const f = await fixture();
  try {
    await f.auth.api.signUpEmail({ body: { email: f.email, password: 'email-change-password', name: 'Synthetic email change' } });
    await f.auth.handler(new Request(f.sent.find(message => message.kind === 'verification').url));
    const user = await f.prisma.authUser.findUniqueOrThrow({ where: { email: f.email } });
    const person = await f.prisma.person.create({ data: { authUserId: user.id, fullName: user.name, emailPersonal: f.email, emailPersonalVerifiedAt: new Date(), emailIdentities: { create: { email: f.email, kind: 'PERSONAL' } } } });
    const login = await f.call('/sign-in/email', { email: f.email, password: 'email-change-password' });
    const cookie = cookies(login);
    await f.service.requestPasswordReset({ email: f.email });
    const oldResetToken = new URL(f.sent.at(-1).url).pathname.split('/').at(-1);
    const changedEmail = `changed-${f.email}`;
    const requested = await f.call('/change-email', { newEmail: changedEmail, callbackURL: 'http://localhost:3000/en/verify-email' }, cookie);
    assert.equal(requested.status, 200);
    assert.equal(f.sent.at(-1).kind, 'email-change'); assert.equal(f.sent.at(-1).to, f.email);
    const confirmOld = f.sent.at(-1).url;
    await f.auth.handler(new Request(confirmOld, { headers: { cookie } }));
    assert.equal(f.sent.at(-1).to, changedEmail);
    assert.equal((await f.prisma.authUser.findUniqueOrThrow({ where: { id: user.id } })).email, f.email);
    await f.auth.handler(new Request(f.sent.at(-1).url, { headers: { cookie } }));
    const updated = await f.prisma.authUser.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(updated.email, changedEmail);
    assert.equal(updated.emailVerified, true);
    await f.service.reconcileVerifiedIdentity(updated);
    assert.equal((await f.prisma.person.findUniqueOrThrow({ where: { personId: person.personId } })).emailPersonal, changedEmail);
    assert.equal((await f.call('/reset-password', { token: oldResetToken, newPassword: 'old-address-attack' })).status, 400);
  } finally { await f.clean(); }
});
