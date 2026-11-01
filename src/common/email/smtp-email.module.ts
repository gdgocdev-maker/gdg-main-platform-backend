import { Module } from '@nestjs/common';
import { SmtpEmailService } from './smtp-email.service.js';

@Module({
  providers: [SmtpEmailService],
  exports: [SmtpEmailService],
})
export class SmtpEmailModule {}
