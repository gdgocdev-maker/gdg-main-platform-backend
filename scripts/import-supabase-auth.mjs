// Offline owner export only. Never reads Supabase or a remote database.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function assertLocalDatabase(value) {
  const url = new URL(value);
  if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Import requires a loopback PostgreSQL database outside production');
  }
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) throw new Error('Host overrides are forbidden');
}

export function planImport(source, now = new Date()) {
  if (!Array.isArray(source.users) || !Array.isArray(source.identities)) throw new Error('Expected users and identities arrays');
  const ids = new Set();
  const emails = new Set();
  const accounts = new Set();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const users = source.users.map(row => {
    if (!uuid.test(row.id) || ids.has(row.id)) throw new Error('Invalid or duplicate user UUID');
    ids.add(row.id);
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@') || emails.has(email)) throw new Error('Missing or duplicate normalized email');
    emails.add(email);
    // Reject rather than silently enabling disabled accounts or losing data.
    if (row.deleted_at || (row.banned_until && new Date(row.banned_until) > now)) throw new Error('Disabled users require owner reconciliation before import');
    if (row.encrypted_password && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(row.encrypted_password)) throw new Error('Unsupported password hash');
    const metadata = row.raw_user_meta_data ?? {};
    const createdAt = new Date(row.created_at ?? now);
    if (!Number.isFinite(createdAt.getTime())) throw new Error('Invalid creation timestamp');
    return { id: row.id, email, name: String(metadata.full_name ?? metadata.name ?? email), emailVerified: Boolean(row.email_confirmed_at), locale: metadata.locale === 'ar' ? 'ar' : 'en', createdAt, updatedAt: createdAt, password: row.encrypted_password || null };
  });
  const credentials = users.filter(user => user.password).map(user => ({ userId: user.id, providerId: 'credential', accountId: user.id, password: user.password }));
  for (const identity of source.identities) {
    if (!ids.has(identity.user_id)) throw new Error('Identity refers to missing user');
    if (identity.provider === 'email') continue;
    if (identity.provider !== 'google') throw new Error('Unsupported provider requires owner reconciliation');
    const accountId = identity.identity_data?.sub ?? identity.provider_id;
    if (typeof accountId !== 'string' || !accountId) throw new Error('Missing Google subject');
    const key = `google:${accountId}`;
    if (accounts.has(key)) throw new Error('Duplicate Google identity');
    accounts.add(key);
    credentials.push({ userId: identity.user_id, providerId: 'google', accountId, password: null });
  }
  return { users, accounts: credentials };
}

export async function importPlan(prisma, plan, apply = false) {
  return prisma.$transaction(async tx => {
    for (const { password: _password, ...user } of plan.users) {
      const existing = await tx.authUser.findFirst({ where: { OR: [{ id: user.id }, { email: user.email }] } });
      if (existing && (existing.id !== user.id || existing.email !== user.email)) throw new Error('Auth user identity conflict');
      const person = await tx.person.findFirst({ where: { emailPersonal: { equals: user.email, mode: 'insensitive' } } });
      if (person && person.authUserId !== user.id) throw new Error('Person link conflict; automatic email linking is forbidden');
      const linked = await tx.person.findUnique({ where: { authUserId: user.id } });
      if (linked?.emailPersonal?.trim().toLowerCase() !== user.email && linked) throw new Error('Linked person email conflict');
      if (apply && !existing) await tx.authUser.create({ data: user });
    }
    for (const account of plan.accounts) {
      const existing = await tx.authAccount.findUnique({ where: { providerId_accountId: { providerId: account.providerId, accountId: account.accountId } } });
      if (existing && existing.userId !== account.userId) throw new Error('Provider account conflict');
      // Never overwrite a password or token on rerun.
      if (apply && !existing) await tx.authAccount.create({ data: { id: randomUUID(), ...account } });
    }
    return { users: plan.users.length, accounts: plan.accounts.length, applied: apply };
  }, { isolationLevel: 'Serializable' });
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(arg => !arg.startsWith('--'));
  if (!file || args.some(arg => arg.startsWith('--') && arg !== '--apply')) throw new Error('Usage: import-supabase-auth.mjs export.json [--apply]');
  assertLocalDatabase(process.env.DATABASE_URL ?? '');
  const plan = planImport(JSON.parse(await readFile(file, 'utf8')));
  const { PrismaClient } = await import('../dist/generated/prisma/client.js');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try { console.log(JSON.stringify(await importPlan(prisma, plan, args.includes('--apply')))); }
  finally { await prisma.$disconnect(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Auth import failed. Check local database, export validity and identity conflicts. No credentials are logged.'); process.exitCode = 1; });
}
