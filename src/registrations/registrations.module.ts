import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SmtpEmailModule } from '../common/email/smtp-email.module.js';
import { AttendanceTokenService } from '../event-registrations/attendance-token.service.js';
import { CheckInService } from './check-in.service.js';
import { GuestWalletRelayService } from './guest-wallet-relay.service.js';
import { GuestWalletWorkerController } from './guest-wallet-worker.controller.js';
import { CommitteeAccessService } from './committee-access.service.js';
import { ConfirmationExpiryJob } from './confirmation-expiry.job.js';
import { RegistrationEmailService } from './registration-email.service.js';
import { RegistrationEmailDeliveryService } from './registration-email-delivery.service.js';
import { RegistrationListService } from './registration-list.service.js';
import { RegistrationReviewService } from './registration-review.service.js';
import { WalletProjectionService } from './wallet-projection.service.js';
import { RegistrationsController } from './registrations.controller.js';

@Module({
  imports: [PrismaModule, SmtpEmailModule],
  controllers: [RegistrationsController, GuestWalletWorkerController],
  providers: [
    CheckInService,
    AttendanceTokenService,
    RegistrationEmailDeliveryService,
    WalletProjectionService,
    GuestWalletRelayService,
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
    AttendanceTokenService,
  ],
})
export class RegistrationsModule {}
