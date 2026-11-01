import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, type RequestUser } from './auth.guard.js';
import type { TokenVerifierService } from './token-verifier.service.js';

const AUTH_USER_ID = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';

const verify = vi.fn();
const findUnique = vi.fn();
const findRevokedToken = vi.fn();
const originalFrontendUrl = process.env.FRONTEND_URL;
const originalFrontendOrigins = process.env.FRONTEND_ORIGINS;
const guard = new AuthGuard(
  { verify } as unknown as TokenVerifierService,
  { person: { findUnique }, revokedAuthToken: { findUnique: findRevokedToken } } as unknown as PrismaService,
);

// fake request with only the parts the guard looks at
function requestWith(authorization?: string) {
  const request: { headers: { authorization?: string }; user?: RequestUser } = {
    headers: authorization === undefined ? {} : { authorization },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, context };
}

function requestWithCookie(cookie: string, origin?: string) {
  const request = { headers: { cookie, origin }, method: 'POST' };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { request, context };
}

beforeEach(() => {
  verify.mockReset().mockResolvedValue({ authUserId: AUTH_USER_ID });
  findUnique.mockReset();
  findRevokedToken.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = originalFrontendUrl;
  if (originalFrontendOrigins === undefined) delete process.env.FRONTEND_ORIGINS;
  else process.env.FRONTEND_ORIGINS = originalFrontendOrigins;
});

describe('AuthGuard', () => {
  it('lets visitors without a token through with no user', async () => {
    const { request, context } = requestWith();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it('sets personId, memberId and email for an active member', async () => {
    verify.mockResolvedValue({
      authUserId: AUTH_USER_ID,
      email: 'noura@example.test',
    });
    findUnique.mockResolvedValue({
      personId: 6,
      isActive: true,
      member: { memberId: 10000005, isActive: true },
    });
    const { request, context } = requestWith('Bearer good-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good-token');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { authUserId: AUTH_USER_ID } }),
    );
    expect(request.user).toEqual({
      personId: 6,
      memberId: 10000005,
      email: 'noura@example.test',
    });
  });

  it.each([
    ['not a member', null],
    ['an inactive member', { memberId: 10000005, isActive: false }],
  ])('sets memberId to null for %s', async (_, member) => {
    findUnique.mockResolvedValue({ personId: 6, isActive: true, member });
    const { request, context } = requestWith('Bearer good-token');

    await guard.canActivate(context);
    expect(request.user).toEqual({ personId: 6, memberId: null });
  });

  it.each([
    ['is not a bearer token', 'Basic abc123'],
    ['has no token after Bearer', 'Bearer '],
  ])('treats a header that %s as a visitor', async (_, header) => {
    const { request, context } = requestWith(header);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
  });

  it('treats a token the verifier does not trust as a visitor', async () => {
    verify.mockResolvedValue(null);
    const { request, context } = requestWith('Bearer bad-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a validly signed access token after logout revokes it', async () => {
    findRevokedToken.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000) });
    const { request, context } = requestWith('Bearer good-token');
    await guard.canActivate(context);
    expect(request.user).toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('requires the configured origin for cookie-authenticated mutations', async () => {
    process.env.FRONTEND_URL = 'https://gdg-leeniverse.onrender.com';
    process.env.FRONTEND_ORIGINS = 'http://localhost:3000';
    const { context } = requestWithCookie('gdg_access=good-token', 'https://attacker.example');
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('allows explicitly configured local and hosted frontend origins', async () => {
    process.env.FRONTEND_URL = 'https://gdg-leeniverse.onrender.com';
    process.env.FRONTEND_ORIGINS = 'http://localhost:3000';
    const { context } = requestWithCookie('gdg_refresh=refresh-token', 'http://localhost:3000');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([
    ['not linked to any person', null],
    [
      'linked to a deactivated person',
      { personId: 6, isActive: false, member: null },
    ],
  ])('treats a supabase account %s as a visitor', async (_, person) => {
    findUnique.mockResolvedValue(person);
    const { request, context } = requestWith('Bearer good-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
  });

  it('passes on errors when the signing keys cannot be reached', async () => {
    verify.mockRejectedValue(new Error('keys unreachable'));
    const { context } = requestWith('Bearer good-token');

    await expect(guard.canActivate(context)).rejects.toThrow(
      'keys unreachable',
    );
  });
});
