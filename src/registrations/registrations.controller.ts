import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthRequiredGuard,
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.js';
import { apiSuccess } from '../common/http/api-response.js';
import { CheckInService } from './check-in.service.js';
import { RegistrationEmailDeliveryService } from './registration-email-delivery.service.js';
import {
  DataEventReportQueryDto,
  CheckInDto,
  ListRegistrationsQueryDto,
  ResolveBlacklistDto,
  ReviewRegistrationDto,
  SetWaitlistDto,
} from './registration.dto.js';
import { RegistrationListService } from './registration-list.service.js';
import { registrationForbidden } from './registration-errors.js';
import { RegistrationReviewService } from './registration-review.service.js';

const DEFAULT_PAGE_SIZE = 20;

// Registration management is staff work, so the account must be a member.
function staffMemberId(user: AuthenticatedUser): number {
  if (!user.memberId) throw registrationForbidden();
  return user.memberId;
}

@Controller()
@UseGuards(AuthRequiredGuard)
export class RegistrationsController {
  constructor(
    @Inject(RegistrationListService)
    private readonly listService: RegistrationListService,
    @Inject(RegistrationReviewService)
    private readonly reviewService: RegistrationReviewService,
    @Inject(CheckInService)
    private readonly checkInService: CheckInService,
    @Inject(RegistrationEmailDeliveryService)
    private readonly emailDelivery: RegistrationEmailDeliveryService,
  ) {}

  @Get('data/event-reports/events')
  async listDataReportEvents(@CurrentUser() user: AuthenticatedUser) {
    return apiSuccess(
      await this.listService.listDataReportEvents(staffMemberId(user)),
    );
  }

  @Get('data/event-reports/events/:eventId')
  async getDataEventReport(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Query() query: DataEventReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(
      await this.listService.getDataEventReport(
        eventId,
        query.group,
        staffMemberId(user),
      ),
    );
  }

  @Get('events/:eventId/registrations')
  async list(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Query() query: ListRegistrationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.listService.list(
      eventId,
      {
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : DEFAULT_PAGE_SIZE,
        search: query.search,
        status: query.status,
      },
      staffMemberId(user),
    );
    return apiSuccess(result);
  }

  @Get('registrations/blacklist')
  async listBlacklist(
    @Query() query: ListRegistrationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.listService.listBlacklist(
      {
        page: query.page ? Number(query.page) : 1,
        pageSize: query.pageSize ? Number(query.pageSize) : DEFAULT_PAGE_SIZE,
      },
      staffMemberId(user),
    );
    return apiSuccess(result);
  }

  // PR Leader only: lifts the flag for the person behind this entry.
  @Post('registrations/blacklist/:entryId/resolve')
  @HttpCode(200)
  async resolveBlacklist(
    @Param('entryId', ParseIntPipe) entryId: number,
    @Body() body: ResolveBlacklistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.listService.resolveBlacklist(
      entryId,
      body.reason,
      staffMemberId(user),
    );
    return apiSuccess(result, 'Removed from the blacklist.');
  }

  @Patch('registrations/:registrationId')
  async review(
    @Param('registrationId', ParseIntPipe) registrationId: number,
    @Body() body: ReviewRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.reviewService.review(
      registrationId,
      body.status === 'ACCEPTED' ? 'ACCEPT' : 'REJECT',
      staffMemberId(user),
    );
    return apiSuccess(result);
  }

  @Post('registrations/:registrationId/email/retry')
  @HttpCode(202)
  async retryEmail(
    @Param('registrationId', ParseIntPipe) registrationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(await this.emailDelivery.retry(registrationId, staffMemberId(user)));
  }

  @Put('events/:eventId/waitlist')
  async setWaitlist(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: SetWaitlistDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const waitlist = await this.reviewService.setWaitlist(
      eventId,
      body.registrationIds,
      staffMemberId(user),
    );
    return apiSuccess({ eventId, waitlist });
  }

  // The PR attendance page sends the token read from the member's QR.
  @Post('events/:eventId/check-in')
  @HttpCode(200)
  async checkIn(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: CheckInDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.checkInService.checkIn(
      eventId,
      body.token,
      staffMemberId(user),
    );
    return apiSuccess(result, 'Checked in.');
  }
}
