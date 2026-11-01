import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { getAllowedFrontendOrigins } from '../common/http/frontend-origins.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TokenVerifierService } from './token-verifier.service.js';

export interface RequestUser {
  personId: number;
  // null if they aren't an active member
  memberId: number | null;
  email?: string;
  fromEmailLink?: boolean;
}

interface AuthRequest {
  headers: { authorization?: string; cookie?: string; origin?: string };
  method: string;
  user?: RequestUser;
  verifiedAccessTokenExpiresAt?: number;
}

// runs before every route, only works out who's calling. never blocks, routes that need a login check request.user
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokenVerifierService)
    private readonly verifier: TokenVerifierService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const usesAuthCookie = request.headers.cookie?.split(';').some((item) => /^\s*gdg_(access|refresh)=/.test(item)) ?? false;
    if (usesAuthCookie && !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      if (!getAllowedFrontendOrigins().includes(request.headers.origin ?? '')) {
        throw new ForbiddenException('Invalid request origin.');
      }
    }
    const header = request.headers.authorization;
    const cookie = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith('gdg_access='));
    const token = (header && /^Bearer\s+(\S+)$/i.exec(header)?.[1])
      ?? (cookie ? decodeURIComponent(cookie.slice('gdg_access='.length)) : undefined);
    if (!token) return true;

    const identity = await this.verifier.verify(token);
    if (!identity) return true;
    request.verifiedAccessTokenExpiresAt = identity.expiresAt;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const revoked = await this.prisma.revokedAuthToken.findUnique({ where: { tokenHash }, select: { expiresAt: true } });
    if (revoked && revoked.expiresAt > new Date()) return true;

    const person = await this.prisma.person.findUnique({
      where: { authUserId: identity.authUserId },
      select: {
        personId: true,
        isActive: true,
        member: { select: { memberId: true, isActive: true } },
      },
    });
    // no linked person or deactivated = visitor
    if (!person?.isActive) return true;

    request.user = {
      personId: person.personId,
      memberId: person.member?.isActive ? person.member.memberId : null,
      email: identity.email,
      fromEmailLink: identity.fromEmailLink,
    };
    return true;
  }
}
