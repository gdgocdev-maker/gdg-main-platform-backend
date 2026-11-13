import { describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import { hashAuthPassword, verifyAuthPassword } from './password.js';
describe('migrated credentials', () => {
  it('accepts Supabase bcrypt variants and rejects wrong passwords', async () => {
    const hash = await bcrypt.hash('existing-password', 10);
    for (const prefix of ['$2a$', '$2b$', '$2y$']) {
      expect(await verifyAuthPassword({ hash: prefix + hash.slice(4), password: 'existing-password' })).toBe(true);
      expect(await verifyAuthPassword({ hash: prefix + hash.slice(4), password: 'wrong-password' })).toBe(false);
    }
  });
  it('uses the current default hash for newly set passwords', async () => {
    const hash = await hashAuthPassword('new-strong-password');
    expect(hash).not.toMatch(/^\$2/);
    expect(await verifyAuthPassword({ hash, password: 'new-strong-password' })).toBe(true);
    expect(await verifyAuthPassword({ hash, password: 'wrong-password' })).toBe(false);
  });
  it('does not accept a truncated legacy password', async () => {
    const password = 'a'.repeat(72);
    expect(await verifyAuthPassword({ hash: await bcrypt.hash(password, 10), password: password + 'extra' })).toBe(false);
  });
});
