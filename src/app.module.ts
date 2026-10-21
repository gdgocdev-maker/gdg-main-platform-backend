import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApiValidationPipe } from './common/http/api-validation.pipe.js';
import { HttpErrorFilter } from './common/http/http-error.filter.js';
import { EventRegistrationsModule } from './event-registrations/event-registrations.module.js';
import { EventsModule } from './event-registrations/events.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RegistrationsModule } from './registrations/registrations.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RegistrationsModule,
    EventRegistrationsModule,
    EventsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpErrorFilter },
    { provide: APP_PIPE, useClass: ApiValidationPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((req: any, res: any, next: () => void) => {
        const personIdHeader =
          req.headers['x-person-id'] || req.headers['x-user-id'];
        const memberIdHeader = req.headers['x-member-id'];

        if (personIdHeader) {
          req.user = {
            personId: Number(personIdHeader),
            memberId: memberIdHeader ? Number(memberIdHeader) : 10000005,
          };
        }
        next();
      })
      .forRoutes('*');
  }
}