import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { EventManagementController } from './event-management.controller.js';
import { EventManagementService } from './event-management.service.js';

@Module({
    imports: [PrismaModule],
    controllers: [EventManagementController],
    providers: [
        EventManagementService,
        CommitteeAccessService,
    ],
    exports: [EventManagementService],
})
export class EventsModule { }