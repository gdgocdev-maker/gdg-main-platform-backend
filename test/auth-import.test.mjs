import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalDatabase, planImport, importPlan } from '../scripts/import-supabase-auth.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const source = () => ({ users: [{ id, email: ' Test@example.test ', email_confirmed_at: '2026-01-01', encrypted_password: '$2b$10$' + 'a'.repeat(53) }], identities: [{ user_id: id, provider: 'google', identity_data: { sub: 'google-123' } }] });
test('preserves UUID, normalized identity and bcrypt hash without importing sessions', () => {
  const plan = planImport(source());
  assert.equal(plan.users[0].id, id);
  assert.equal(plan.users[0].email, 'test@example.test');
  assert.equal(plan.accounts[0].password, source().users[0].encrypted_password);
  assert.equal(plan.accounts[1].accountId, 'google-123');
});
test('rejects remote databases and connection host overrides', () => {
  assertLocalDatabase('postgresql://localhost/test');
  for (const url of ['postgresql://db.example/test', 'postgresql://localhost/test?host=remote', 'https://localhost/test']) assert.throws(() => assertLocalDatabase(url));
});
test('rejects duplicate emails, unsupported hashes and disabled users', () => {
  const duplicate = source(); duplicate.users.push({ ...duplicate.users[0], id: '00000000-0000-4000-8000-000000000002' });
  assert.throws(() => planImport(duplicate));
  const bad = source(); bad.users[0].encrypted_password = 'plaintext'; assert.throws(() => planImport(bad));
  const disabled = source(); disabled.users[0].deleted_at = '2026-01-01'; assert.throws(() => planImport(disabled));
});
test('idempotent rerun does not overwrite changed credentials', async () => {
  let writes = 0;
  const tx = { authUser: { findFirst: async () => ({ id, email: 'test@example.test' }), create: async () => writes++ }, person: { findFirst: async () => null, findUnique: async () => null }, authAccount: { findUnique: async () => ({ userId: id, password: 'new-password-hash' }), create: async () => writes++ } };
  await importPlan({ $transaction: fn => fn(tx) }, planImport(source()), true);
  assert.equal(writes, 0);
});
