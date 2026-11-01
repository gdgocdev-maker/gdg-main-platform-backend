import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { CommitteeEventImageStorageService } from '../committee-dashboard/committee-event-image-storage.service.js';
import { AnnouncementsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [AnnouncementsController],
  providers: [CommitteeAccessService, CommitteeEventImageStorageService, AnnouncementsService],
})
export class AnnouncementsModule {}
