import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { AnnouncementsModule } from './announcements/announcements.module.js';
import { CommitteeDashboardModule } from './committee-dashboard/committee-dashboard.module.js';
import { ApiValidationPipe } from './common/http/api-validation.pipe.js';
import { HttpErrorFilter } from './common/http/http-error.filter.js';
import { EventRegistrationsModule } from './event-registrations/event-registrations.module.js';
import { HealthController } from './health/health.controller.js';
import { MembershipRequestsModule } from './membership-requests/membership-requests.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RegistrationsModule } from './registrations/registrations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AnnouncementsModule,
    CommitteeDashboardModule,
    RegistrationsModule,
    EventRegistrationsModule,
    MembershipRequestsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    { provide: APP_PIPE, useClass: ApiValidationPipe },
  ],
})
export class AppModule {}
