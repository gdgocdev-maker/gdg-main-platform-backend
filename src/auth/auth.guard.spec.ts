import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, type RequestUser } from './auth.guard.js';
import type { BetterAuthService } from './better-auth.service.js';
import type { AuthService } from './auth.service.js';
const session = vi.fn();
const findUnique = vi.fn();
const reconcileVerifiedIdentity = vi.fn();
const guard = new AuthGuard({ session } as unknown as BetterAuthService, { person: { findUnique } } as unknown as PrismaService, { reconcileVerifiedIdentity } as unknown as AuthService);
function fixture(method = 'GET', origin = 'http://localhost:3000') {
  const request: { method: string; headers: { origin: string }; user?: RequestUser } = { method, headers: { origin } };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext };
}
beforeEach(() => {
  vi.stubEnv('FRONTEND_URL', 'http://localhost:3000');
  session.mockReset().mockResolvedValue({ user: { id: 'identity-id', email: 'member@example.test', emailVerified: true } });
  findUnique.mockReset().mockResolvedValue({ personId: 1, isActive: true, member: { memberId: 2, isActive: true } });
  reconcileVerifiedIdentity.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it('maps verified server identity to existing active member', async () => {
  const f = fixture(); await guard.canActivate(f.context);
  expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { authUserId: 'identity-id' } }));
  expect(f.request.user).toEqual({ personId: 1, memberId: 2, email: 'member@example.test', fromEmailLink: false });
});
it.each([null, { user: { emailVerified: false } }])('does not grant identity to missing or unverified session', async value => {
  session.mockResolvedValue(value); const f = fixture(); await guard.canActivate(f.context);
  expect(f.request.user).toBeUndefined(); expect(findUnique).not.toHaveBeenCalled();
});
it.each([null, { personId: 1, isActive: false }])('does not grant identity to absent or deactivated person', async person => {
  findUnique.mockResolvedValue(person); const f = fixture(); await guard.canActivate(f.context); expect(f.request.user).toBeUndefined();
});
it('does not grant member permissions to inactive membership', async () => {
  findUnique.mockResolvedValue({ personId: 1, isActive: true, member: { memberId: 2, isActive: false } });
  const f = fixture(); await guard.canActivate(f.context); expect(f.request.user?.memberId).toBeNull();
});
it('rejects cross-origin cookie mutations before provisioning', async () => {
  await expect(guard.canActivate(fixture('POST', 'https://attacker.example').context)).rejects.toBeInstanceOf(ForbiddenException);
  expect(reconcileVerifiedIdentity).not.toHaveBeenCalled();
});
it('fails closed on session store failure', async () => {
  session.mockRejectedValue(new Error('database unavailable'));
  await expect(guard.canActivate(fixture().context)).rejects.toThrow('database unavailable');
});
