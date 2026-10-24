import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { MembershipRequestsController } from './membership-requests.controller.js';
import { MembershipRequestService } from './membership-request.service.js';
import { VerifiedSupabaseEmailGuard } from './verified-supabase-email.guard.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [MembershipRequestsController],
  providers: [CommitteeAccessService, MembershipRequestService, VerifiedSupabaseEmailGuard],
})
export class MembershipRequestsModule {}
