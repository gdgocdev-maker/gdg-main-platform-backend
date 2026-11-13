import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { AuthService } from './auth.service.js';
import { BetterAuthService } from './better-auth.service.js';
import { ResendAuthEmailService } from './email/resend-auth-email.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    BetterAuthService,
    ResendAuthEmailService,
    AuthService,
    { provide: APP_GUARD, useClass: AuthRateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, BetterAuthService],
})
export class AuthModule {}
