import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { getAllowedFrontendOrigins } from '../common/http/frontend-origins.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BetterAuthService } from './better-auth.service.js';
import { AuthService } from './auth.service.js';

export interface RequestUser {
  personId: number;
  // null if they aren't an active member
  memberId: number | null;
  email?: string;
  fromEmailLink?: boolean;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(BetterAuthService) private readonly better: BetterAuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const session = await this.better.session(request.headers);
    if (!session?.user.emailVerified) return true;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) && !getAllowedFrontendOrigins().includes(request.headers.origin ?? '')) {
      throw new ForbiddenException('Invalid request origin.');
    }
    await this.auth.reconcileVerifiedIdentity(session.user);
    const person = await this.prisma.person.findUnique({
      where: { authUserId: session.user.id },
      select: { personId: true, isActive: true, member: { select: { memberId: true, isActive: true } } },
    });
    if (!person?.isActive) return true;
    request.user = { personId: person.personId, memberId: person.member?.isActive ? person.member.memberId : null, email: session.user.email, fromEmailLink: false };
    return true;
  }
}
