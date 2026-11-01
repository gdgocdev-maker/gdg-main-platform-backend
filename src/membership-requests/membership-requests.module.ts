import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SmtpEmailModule } from '../common/email/smtp-email.module.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { MembershipRequestsController } from './membership-requests.controller.js';
import { MembershipRequestEmailService } from './membership-request-email.service.js';
import { MembershipRequestService } from './membership-request.service.js';
import { VerifiedSupabaseEmailGuard } from './verified-supabase-email.guard.js';

@Module({
  imports: [AuthModule, PrismaModule, SmtpEmailModule],
  controllers: [MembershipRequestsController],
  providers: [CommitteeAccessService, MembershipRequestEmailService, MembershipRequestService, VerifiedSupabaseEmailGuard],
})
export class MembershipRequestsModule {}
