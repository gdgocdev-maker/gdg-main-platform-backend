import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthRequiredGuard,
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/current-user.js';
import { apiSuccess } from '../common/http/api-response.js';
import {
  CreateMembershipRequestDto,
  DecideMembershipRequestDto,
  ListMembershipRequestsQueryDto,
  MembershipRequestCommitteeParamDto,
} from './membership-request.dto.js';
import { MembershipRequestService } from './membership-request.service.js';
import { VerifiedSupabaseEmailGuard } from './verified-supabase-email.guard.js';

function memberIdOf(user: AuthenticatedUser) {
  if (!user.memberId) {
    // Authenticated non-members may submit their request; this helper is only
    // used by review routes, where lacking a member record means no permission.
    throw new ForbiddenException();
  }
  return user.memberId;
}

@Controller('membership-requests')
@UseGuards(AuthRequiredGuard)
export class MembershipRequestsController {
  constructor(
    @Inject(MembershipRequestService)
    private readonly requests: MembershipRequestService,
  ) {}

  @Post()
  @UseGuards(VerifiedSupabaseEmailGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateMembershipRequestDto,
  ) {
    return apiSuccess(await this.requests.create(user, body), 'Membership request submitted.');
  }

  @Get()
  async list(
    @Query() query: ListMembershipRequestsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(await this.requests.list(query.committeeCode, memberIdOf(user)));
  }

  @Patch(':requestId/committees/:committeeCode')
  async decide(
    @Param('requestId', ParseIntPipe) requestId: number,
    @Param() params: MembershipRequestCommitteeParamDto,
    @Body() body: DecideMembershipRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return apiSuccess(
      await this.requests.decide(requestId, params.committeeCode, body.decision, user),
      'Membership request decision saved.',
    );
  }
}
