import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SmtpEmailModule } from '../common/email/smtp-email.module.js';
import { CheckInService } from './check-in.service.js';
import { CommitteeAccessService } from './committee-access.service.js';
import { ConfirmationExpiryJob } from './confirmation-expiry.job.js';
import { RegistrationEmailService } from './registration-email.service.js';
import { RegistrationListService } from './registration-list.service.js';
import { RegistrationReviewService } from './registration-review.service.js';
import { RegistrationsController } from './registrations.controller.js';

@Module({
  imports: [PrismaModule, SmtpEmailModule],
  controllers: [RegistrationsController],
  providers: [
    CheckInService,
    CommitteeAccessService,
    RegistrationEmailService,
    RegistrationListService,
    RegistrationReviewService,
    ConfirmationExpiryJob,
  ],
  // promoteNextFromWaitlist is called by the member confirm/decline flow.
  exports: [
    RegistrationReviewService,
    CommitteeAccessService,
    RegistrationEmailService,
  ],
})
export class RegistrationsModule {}
