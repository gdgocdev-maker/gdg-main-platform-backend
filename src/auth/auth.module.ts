import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SmtpEmailModule } from '../common/email/smtp-email.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { AuthService } from './auth.service.js';
import { TokenVerifierService } from './token-verifier.service.js';

@Module({
  imports: [PrismaModule, SmtpEmailModule],
  controllers: [AuthController],
  providers: [
    TokenVerifierService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthRateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
