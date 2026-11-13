import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ResendAuthEmailService } from './resend-auth-email.service.js';

vi.mock('better-auth', () => ({ betterAuth: vi.fn((options) => options) }));
import { createBetterAuth } from '../better-auth.factory.js';

describe('password reset security notice', () => {
  afterEach(() => vi.unstubAllEnvs());
  for (const locale of ['ar', 'en']) {
    it(`notifies the account owner in ${locale} after the reset`, async () => {
      vi.stubEnv(
        'BETTER_AUTH_SECRET',
        'test-only-secret-longer-than-thirty-two-characters',
      );
      vi.stubEnv('FRONTEND_URL', 'https://gdguj.org');
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const send = vi.fn().mockResolvedValue('notice-id');
      const options = createBetterAuth(
        { authUser: { updateMany } } as unknown as PrismaService,
        { send } as unknown as ResendAuthEmailService,
      ) as unknown as {
        emailAndPassword: { onPasswordReset(input: unknown): Promise<void> };
      };
      await options.emailAndPassword.onPasswordReset({
        user: { id: 'user-id', email: 'owner@example.test', locale },
      });
      expect(updateMany).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith({
        to: 'owner@example.test',
        kind: 'password-changed',
        locale,
        url: `https://gdguj.org/${locale}/login`,
      });
      expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        send.mock.invocationCallOrder[0],
      );
    });
  }
  it('does not turn a completed password reset into an error when delivery fails', async () => {
    vi.stubEnv(
      'BETTER_AUTH_SECRET',
      'test-only-secret-longer-than-thirty-two-characters',
    );
    const options = createBetterAuth(
      {
        authUser: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      } as unknown as PrismaService,
      {
        send: vi.fn().mockRejectedValue(new Error('provider unavailable')),
      } as unknown as ResendAuthEmailService,
    ) as unknown as {
      emailAndPassword: { onPasswordReset(input: unknown): Promise<void> };
    };
    await expect(
      options.emailAndPassword.onPasswordReset({
        user: { id: 'user-id', email: 'owner@example.test' },
      }),
    ).resolves.toBeUndefined();
  });
});
