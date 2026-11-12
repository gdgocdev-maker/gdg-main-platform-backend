import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { AddMemberToCommitteeDto, AssignClubPersonDto, RemoveClubPersonDto, UpdateGlobalPointsDto } from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';
import { LeadershipTasksService } from './leadership-tasks.service.js';
import { CreateLeadershipTaskDto, ReviewCommitteeTaskDto, UpdateLeadershipTaskDto } from './committee-dashboard.dto.js';

@Controller('club-leadership')
export class ClubLeadershipDashboardController {
  constructor(@Inject(CommitteeDashboardService) private readonly dashboard: CommitteeDashboardService, @Inject(LeadershipTasksService) private readonly tasks: LeadershipTasksService) {}

  @Get('dashboard')
  async overview(@Req() request: { user?: RequestUser }) {
    return apiSuccess(await this.dashboard.getClubLeadershipOverview(request.user));
  }

  @Get('tasks')
  async getTasks(@Req() request: { user?: RequestUser }) {
    return apiSuccess(await this.tasks.getClubTasks(request.user));
  }

  @Post('tasks')
  async createTask(@Req() request: { user?: RequestUser }, @Body() body: CreateLeadershipTaskDto) {
    return apiSuccess(await this.tasks.createClubTask(request.user, body));
  }

  @Patch('tasks/:taskId')
  async updateTask(@Req() request: { user?: RequestUser }, @Param('taskId', ParseIntPipe) taskId: number, @Body() body: UpdateLeadershipTaskDto) {
    return apiSuccess(await this.tasks.updateClubTask(request.user, taskId, body));
  }

  @Post('tasks/:taskId/review')
  async reviewTask(@Req() request: { user?: RequestUser }, @Param('taskId', ParseIntPipe) taskId: number, @Body() body: ReviewCommitteeTaskDto) {
    return apiSuccess(await this.tasks.reviewClubTask(request.user, taskId, body.decision));
  }

  @Delete('tasks/:taskId')
  async deleteTask(@Req() request: { user?: RequestUser }, @Param('taskId', ParseIntPipe) taskId: number) {
    return apiSuccess(await this.tasks.deleteClubTask(request.user, taskId));
  }
  @Post('members/:memberId/committees')
  async addMemberToCommittee(
    @Req() request: { user?: RequestUser },
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() body: AddMemberToCommitteeDto,
  ) {
    return apiSuccess(await this.dashboard.addMemberToCommittee(request.user, memberId, body));
  }

  @Post('members')
  async assignPerson(
    @Req() request: { user?: RequestUser },
    @Body() body: AssignClubPersonDto,
  ) {
    return apiSuccess(await this.dashboard.assignClubPerson(request.user, body));
  }

  @Delete('members')
  async removePerson(
    @Req() request: { user?: RequestUser },
    @Body() body: RemoveClubPersonDto,
  ) {
    return apiSuccess(await this.dashboard.removeClubPerson(request.user, body));
  }

  @Post('members/:memberId/global-points')
  async updateGlobalPoints(
    @Req() request: { user?: RequestUser },
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() body: UpdateGlobalPointsDto,
  ) {
    return apiSuccess(await this.dashboard.updateGlobalRolePoints(request.user, memberId, body));
  }
}
