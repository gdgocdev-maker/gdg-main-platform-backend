import bcrypt from 'bcrypt';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

export const hashAuthPassword: (password: string) => Promise<string> = hashPassword;
export async function verifyAuthPassword(input: { hash: string; password: string }): Promise<boolean> {
  if (/^\$2[aby]\$/.test(input.hash)) {
    // Preserve Supabase bcrypt semantics for existing multibyte passwords.
    // Hash upgrades for inputs beyond bcrypt's 72-byte boundary are deferred to reset.
    return bcrypt.compare(input.password, input.hash.replace(/^\$2y\$/, '$2b$'));
  }
  return verifyPassword(input);
}
