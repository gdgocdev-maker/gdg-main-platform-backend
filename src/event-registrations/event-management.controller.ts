import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AuthRequiredGuard,
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.js';
import { apiSuccess } from '../common/http/api-response.js';
import { CreateEventDto, UpdateEventDto } from './event-management.dto.js';
import { EventManagementService } from './event-management.service.js';

@Controller()
@UseGuards(AuthRequiredGuard)
export class EventManagementController {
  constructor(
    @Inject(EventManagementService)
    private readonly service: EventManagementService,
  ) {}

  @Post('events')
  async create(
    @Body() body: CreateEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(await this.service.create(body, user.memberId));
  }

  @Patch('events/:eventId')
  async update(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: UpdateEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(await this.service.update(eventId, body, user.memberId));
  }

  @Delete('events/:eventId')
  async delete(
    @Param('eventId', ParseIntPipe) eventId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.service.delete(eventId, user.memberId);
    return apiSuccess(null, 'Event deleted.');
  }

  @Get('dashboard/events')
  async dashboardEvents(@CurrentUser() user: AuthenticatedUser) {
    return apiSuccess(await this.service.dashboardEvents(user.memberId));
  }
}
