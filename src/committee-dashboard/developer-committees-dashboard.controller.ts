import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { AssignDeveloperCommitteeMemberDto } from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';
import { LeadershipTasksService } from './leadership-tasks.service.js';
import { CreateLeadershipTaskDto, ReviewCommitteeTaskDto, UpdateLeadershipTaskDto } from './committee-dashboard.dto.js';

@Controller('developer-committees')
export class DeveloperCommitteesDashboardController {
  constructor(@Inject(CommitteeDashboardService) private readonly dashboard: CommitteeDashboardService, @Inject(LeadershipTasksService) private readonly tasks: LeadershipTasksService) {}

  @Get('dashboard')
  async overview(@Req() request: { user?: RequestUser }) {
    return apiSuccess(await this.dashboard.getDeveloperOverview(request.user));
  }

  @Get('tasks')
  async getTasks(@Req() request: { user?: RequestUser }) {
    return apiSuccess(await this.tasks.getDeveloperTasks(request.user));
  }

  @Post('tasks')
  async createTask(@Req() request: { user?: RequestUser }, @Body() body: CreateLeadershipTaskDto) {
    return apiSuccess(await this.tasks.createDeveloperTask(request.user, body));
  }

  @Patch('tasks/:taskId')
  async updateTask(@Req() request: { user?: RequestUser }, @Param('taskId', ParseIntPipe) taskId: number, @Body() body: UpdateLeadershipTaskDto) {
    return apiSuccess(await this.tasks.updateDeveloperTask(request.user, taskId, body));
  }

  @Post('tasks/:taskId/review')
  async reviewTask(@Req() request: { user?: RequestUser }, @Param('taskId', ParseIntPipe) taskId: number, @Body() body: ReviewCommitteeTaskDto) {
    return apiSuccess(await this.tasks.reviewDeveloperTask(request.user, taskId, body.decision));
  }

  @Delete('tasks/:taskId')
  async deleteTask(@Req() request: { user?: RequestUser }, @Param('taskId', ParseIntPipe) taskId: number) {
    return apiSuccess(await this.tasks.deleteDeveloperTask(request.user, taskId));
  }
  @Post('members')
  async assignMember(
    @Req() request: { user?: RequestUser },
    @Body() body: AssignDeveloperCommitteeMemberDto,
  ) {
    return apiSuccess(await this.dashboard.assignDeveloperCommitteeMember(request.user, body));
  }

  @Delete('committees/:committeeCode/members/:memberId')
  async removeCommitteeLeader(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    return apiSuccess(await this.dashboard.removeDeveloperCommitteeLeader(request.user, committeeCode, memberId));
  }
}
