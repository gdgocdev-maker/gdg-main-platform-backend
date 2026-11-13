import bcrypt from 'bcrypt';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

export const hashAuthPassword: (password: string) => Promise<string> = hashPassword;
export async function verifyAuthPassword(input: { hash: string; password: string }): Promise<boolean> {
  if (/^\$2[aby]\$/.test(input.hash)) {
    // bcrypt silently truncates after 72 bytes; reject longer inputs for legacy hashes.
    if (Buffer.byteLength(input.password, 'utf8') > 72) return false;
    return bcrypt.compare(input.password, input.hash.replace(/^\$2y\$/, '$2b$'));
  }
  return verifyPassword(input);
}
