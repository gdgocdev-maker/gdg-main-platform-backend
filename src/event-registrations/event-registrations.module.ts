import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { EventRegistrationService } from './event-registration.service.js';
import { EventRegistrationsController } from './event-registrations.controller.js';

// Member-facing side: browse events, register, confirm or decline a seat.
@Module({
  imports: [PrismaModule, RegistrationsModule],
  controllers: [EventRegistrationsController],
  providers: [EventRegistrationService],
})
export class EventRegistrationsModule {}
