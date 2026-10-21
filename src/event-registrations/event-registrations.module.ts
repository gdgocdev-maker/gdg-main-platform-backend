import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { AttendanceTokenService } from './attendance-token.service.js';
import { EventRegistrationService } from './event-registration.service.js';
import { EventManagementController } from './event-management.controller.js';
import { EventManagementService } from './event-management.service.js';
import { EventRegistrationsController } from './event-registrations.controller.js';

// Member-facing side: browse events, register, confirm or decline a seat.
@Module({
  imports: [PrismaModule, RegistrationsModule],
  controllers: [EventRegistrationsController, EventManagementController],
  providers: [
    AttendanceTokenService,
    EventManagementService,
    EventRegistrationService,
  ],
})
export class EventRegistrationsModule {}
