import { Inject, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResendAuthEmailService } from './email/resend-auth-email.service.js';
import { createBetterAuth } from './better-auth.factory.js';

@Injectable()
export class BetterAuthService {
  readonly auth: ReturnType<typeof createBetterAuth>;
  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(ResendAuthEmailService) email: ResendAuthEmailService,
  ) {
    this.auth = createBetterAuth(prisma, email);
  }

  session(headers: IncomingHttpHeaders) {
    return this.auth.api.getSession({ headers: fromNodeHeaders(headers) });
  }
}
