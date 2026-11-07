import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { apiSuccess } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import {
  CreateCommitteeEventDto,
  CreateCommitteeMemberDto,
  CreateCommitteeTaskDto,
  ReviewCommitteeTaskDto,
  UpdateCommitteePointsDto,
  UpdateCommitteeEventDto,
  UpdateCommitteeTaskDto,
} from './committee-dashboard.dto.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';
import { LeadershipTasksService } from './leadership-tasks.service.js';
import { CreateLeadershipTaskDto, UpdateLeadershipTaskDto } from './committee-dashboard.dto.js';

@Controller('committees/:committeeCode')
export class CommitteeDashboardController {
  constructor(
    @Inject(CommitteeDashboardService)
    private readonly dashboard: CommitteeDashboardService,
    @Inject(LeadershipTasksService) private readonly leadershipTasks: LeadershipTasksService,
  ) {}

  @Get('dashboard')
  async getDashboard(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
  ) {
    return apiSuccess(await this.dashboard.getDashboard(request.user, committeeCode));
  }

  @Post('members')
  async addMember(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Body() body: CreateCommitteeMemberDto,
  ) {
    return apiSuccess(await this.dashboard.addMember(request.user, committeeCode, body));
  }

  @Get('managed-events')
  async getManagedEvents(@Req() request: { user?: RequestUser }, @Param('committeeCode') committeeCode: string) {
    this.assertProjectManagementRoute(committeeCode);
    return apiSuccess(await this.leadershipTasks.getProjectEvents(request.user));
  }

  @Post('managed-events/:eventId/tasks')
  async createManagedEventTask(@Req() request: { user?: RequestUser }, @Param('committeeCode') committeeCode: string, @Param('eventId', ParseIntPipe) eventId: number, @Body() body: CreateLeadershipTaskDto) {
    this.assertProjectManagementRoute(committeeCode);
    return apiSuccess(await this.leadershipTasks.createProjectEventTask(request.user, eventId, body));
  }

  @Patch('managed-events/:eventId/tasks/:taskId')
  async updateManagedEventTask(@Req() request: { user?: RequestUser }, @Param('committeeCode') committeeCode: string, @Param('eventId', ParseIntPipe) eventId: number, @Param('taskId', ParseIntPipe) taskId: number, @Body() body: UpdateLeadershipTaskDto) {
    this.assertProjectManagementRoute(committeeCode);
    return apiSuccess(await this.leadershipTasks.updateProjectEventTask(request.user, eventId, taskId, body));
  }

  @Post('managed-events/:eventId/tasks/:taskId/review')
  async reviewManagedEventTask(@Req() request: { user?: RequestUser }, @Param('committeeCode') committeeCode: string, @Param('eventId', ParseIntPipe) eventId: number, @Param('taskId', ParseIntPipe) taskId: number, @Body() body: ReviewCommitteeTaskDto) {
    this.assertProjectManagementRoute(committeeCode);
    return apiSuccess(await this.leadershipTasks.reviewProjectEventTask(request.user, eventId, taskId, body.decision));
  }

  @Delete('managed-events/:eventId/tasks/:taskId')
  async deleteManagedEventTask(@Req() request: { user?: RequestUser }, @Param('committeeCode') committeeCode: string, @Param('eventId', ParseIntPipe) eventId: number, @Param('taskId', ParseIntPipe) taskId: number) {
    this.assertProjectManagementRoute(committeeCode);
    return apiSuccess(await this.leadershipTasks.deleteProjectEventTask(request.user, eventId, taskId));
  }

  private assertProjectManagementRoute(committeeCode: string) {
    if (committeeCode.trim().toUpperCase() !== 'PM') throw new BadRequestException('Project event task routes require the PM committee.');
  }
  @Post('events')
  async createEvent(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Body() body: CreateCommitteeEventDto,
  ) {
    return apiSuccess(await this.dashboard.createEvent(request.user, committeeCode, body));
  }

  @Post('events/images')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)),
  }))
  async uploadEventImage(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ) {
    return apiSuccess(await this.dashboard.uploadEventImage(request.user, committeeCode, file));
  }

  @Get('events/:eventId')
  async getEvent(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return apiSuccess(await this.dashboard.getCommitteeEvent(request.user, committeeCode, eventId));
  }

  @Patch('events/:eventId')
  async updateEvent(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() body: UpdateCommitteeEventDto,
  ) {
    return apiSuccess(await this.dashboard.updateEvent(request.user, committeeCode, eventId, body));
  }

  @Delete('events/:eventId')
  async deleteDraftEvent(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return apiSuccess(await this.dashboard.deleteDraftEvent(request.user, committeeCode, eventId));
  }

  @Post('events/:eventId/publish')
  @HttpCode(200)
  async publishEvent(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('eventId', ParseIntPipe) eventId: number,
  ) {
    return apiSuccess(await this.dashboard.publishEvent(request.user, committeeCode, eventId));
  }

  @Post('tasks')
  async createTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Body() body: CreateCommitteeTaskDto,
  ) {
    return apiSuccess(await this.dashboard.createTask(request.user, committeeCode, body));
  }

  @Patch('tasks/:taskId')
  async updateTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() body: UpdateCommitteeTaskDto,
  ) {
    return apiSuccess(await this.dashboard.updateTask(request.user, committeeCode, taskId, body));
  }

  @Post('tasks/:taskId/review')
  @HttpCode(200)
  async reviewTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body() body: ReviewCommitteeTaskDto,
  ) {
    return apiSuccess(await this.dashboard.reviewTask(request.user, committeeCode, taskId, body.decision));
  }

  @Delete('tasks/:taskId')
  async deleteTask(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('taskId', ParseIntPipe) taskId: number,
  ) {
    return apiSuccess(await this.dashboard.deleteTask(request.user, committeeCode, taskId));
  }

  @Get('members/:memberId/wallet-link')
  async getWalletLink(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('memberId', ParseIntPipe) memberId: number,
  ) {
    return apiSuccess(await this.dashboard.getWalletLink(request.user, committeeCode, memberId));
  }

  @Post('members/:memberId/points')
  async updatePoints(
    @Req() request: { user?: RequestUser },
    @Param('committeeCode') committeeCode: string,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body() body: UpdateCommitteePointsDto,
  ) {
    return apiSuccess(await this.dashboard.updatePoints(request.user, committeeCode, memberId, body));
  }
}
