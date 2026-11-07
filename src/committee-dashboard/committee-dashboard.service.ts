import {
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventStatus, Prisma, QuestionType } from '../generated/prisma/client.js';
import { apiValidationError, type ApiErrorDetail } from '../common/http/api-response.js';
import type { RequestUser } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DEVELOPER_COMMITTEES_CODE } from '../committees/committee-catalog.js';
import { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { SEAT_HOLDING_STATUSES } from '../registrations/event-seats.js';
import { CommitteeEventImageStorageService } from './committee-event-image-storage.service.js';
import { MembershipRequestEmailService } from '../membership-requests/membership-request-email.service.js';
import {
  AddMemberToCommitteeDto,
  AssignClubPersonDto,
  AssignDeveloperCommitteeMemberDto,
  CreateCommitteeEventDto,
  CreateCommitteeMemberDto,
  RemoveClubPersonDto,
  CommitteeTaskStatus,
  MEMBER_TASK_STATUSES,
  CreateCommitteeTaskDto,
  UpdateCommitteePointsDto,
  UpdateCommitteeEventDto,
  UpdateCommitteeTaskDto,
} from './committee-dashboard.dto.js';

const VIEW_PERMISSION = 'dashboard.view';
const TASK_PERMISSION = 'tasks.manage';
const POINTS_PERMISSION = 'points.manage';
const MEMBERS_PERMISSION = 'members.manage';
const MEMBER_ASSIGNABLE_COMMITTEE_CODES = new Set(['CONTENT', 'PM', 'PR', 'DMD', 'DATA', 'CYBER', 'ROBOTICS', 'WEB', 'AUTOMATION', 'AI']);
const EVENTS_PERMISSION = 'events.create';
// Tasks still being worked on, including those waiting for a leader to confirm.
const ACTIVE_TASK_STATUSES = [CommitteeTaskStatus.TODO, CommitteeTaskStatus.IN_PROGRESS, CommitteeTaskStatus.PENDING_REVIEW];

@Injectable()
export class CommitteeDashboardService {
  private readonly logger = new Logger(CommitteeDashboardService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService)
    private readonly access: CommitteeAccessService,
    @Inject(CommitteeEventImageStorageService)
    @Optional() private readonly eventImageStorage?: CommitteeEventImageStorageService,
    @Inject(MembershipRequestEmailService)
    @Optional() private readonly membershipEmails?: MembershipRequestEmailService,
  ) {}

  async getDeveloperOverview(user: RequestUser | undefined) {
    if (!user?.memberId) throw new ForbiddenException();
    if (!(await this.access.hasGlobalPermission(user.memberId, 'developer_committees.dashboard.view'))) throw new ForbiddenException();
    const canAssignMembers = await this.access.hasGlobalPermission(user.memberId, 'developer_committees.members.assign');
    const committees = (await this.prisma.committee.findMany({
      where: { parent: { committeeCode: DEVELOPER_COMMITTEES_CODE } },
      select: { committeeId: true, committeeCode: true, committeeName: true },
      orderBy: { committeeName: 'asc' },
    })) as Array<{ committeeId: number; committeeCode: string; committeeName: string }>;
    const [leaders, activeMembers] = await Promise.all([
      (this.prisma.memberCommittee as any).groupBy({
        by: ['committeeId'],
        where: {
          committeeId: { in: committees.map(({ committeeId }) => committeeId) },
          role: { in: ['Leader', 'Co-Leader'] },
          member: { isActive: true, person: { isActive: true } },
        },
        _count: { _all: true },
      }),
      (this.prisma.memberCommittee as any).groupBy({
        by: ['committeeId'],
        where: {
          committeeId: { in: committees.map(({ committeeId }) => committeeId) },
          member: { isActive: true, person: { isActive: true } },
        },
        _count: { _all: true },
      }),
    ]) as [
      Array<{ committeeId: number; _count: { _all: number } }>,
      Array<{ committeeId: number; _count: { _all: number } }>,
    ];
    const activeTasks = await Promise.all(committees.map((committee: any) => this.prisma.committeeTask.count({
      where: { committeeId: committee.committeeId, status: { in: ACTIVE_TASK_STATUSES } },
    })));
    return {
      permissions: { canAssignMembers },
      committees: committees.map((committee: any, index: number) => ({
      code: committee.committeeCode,
      name: committee.committeeName,
      memberCount: activeMembers.find((row: any) => row.committeeId === committee.committeeId)?._count._all ?? 0,
      leaderCount: leaders.find((row: any) => row.committeeId === committee.committeeId)?._count._all ?? 0,
      activeTaskCount: activeTasks[index],
      })),
    };
  }

  async getClubLeadershipOverview(user: RequestUser | undefined) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, 'club.dashboard.view'))) throw new ForbiddenException();
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }));
    const [person, members, tasks, points, pointTotals, monthPoints, completedTasks, activeTasks, tasksDueThisWeek, events, registrationGroups, committees, committeePointTotals, canAddMembers]: any[] = await Promise.all([
      this.prisma.person.findUnique({ where: { personId: user.personId }, select: { fullName: true } }),
      this.prisma.member.findMany({
        where: { isActive: true, person: { isActive: true } },
        include: {
          person: true,
          committees: { select: { role: true, committeeId: true, committee: { select: { committeeCode: true, committeeName: true } } } },
          roleAssignments: {
            where: { AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: today } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: today } }] }] },
            select: { roleCode: true },
          },
        },
        orderBy: { person: { fullName: 'asc' } },
      }),
      this.prisma.committeeTask.findMany({
        include: {
          assignee: { include: { person: true } },
          committee: { select: { committeeCode: true, committeeName: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }], take: 200,
      }),
      this.prisma.committeePointEntry.findMany({
        include: {
          recipient: { include: { member: { include: { person: true } }, committee: { select: { committeeCode: true, committeeName: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { pointEntryId: 'desc' }], take: 200,
      }),
      (this.prisma.committeePointEntry as any).groupBy({ by: ['memberId'], _sum: { pointsDelta: true } }),
      this.prisma.committeePointEntry.aggregate({ where: { createdAt: { gte: riyadhPeriodStart(new Date(), 'month') } }, _sum: { pointsDelta: true } }),
      (this.prisma.committeeTask as any).groupBy({ by: ['assignedMemberId'], where: { status: CommitteeTaskStatus.COMPLETED }, _count: { _all: true } }),
      this.prisma.committeeTask.count({ where: { status: { in: ACTIVE_TASK_STATUSES } } }),
      this.prisma.committeeTask.count({ where: { status: { in: ACTIVE_TASK_STATUSES }, dueAt: { gte: riyadhPeriodStart(new Date(), 'week'), lt: new Date(riyadhPeriodStart(new Date(), 'week').getTime() + 7 * 86400000) } } }),
      this.prisma.event.findMany({
        include: { _count: { select: { registrations: true } } },
        orderBy: { startsAt: 'asc' },
      }),
      (this.prisma.eventRegistration as any).groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.committee.findMany({ select: { committeeCode: true, committeeName: true }, orderBy: { committeeName: 'asc' } }),
      (this.prisma.committeePointEntry as any).groupBy({ by: ['memberId', 'committeeId'], _sum: { pointsDelta: true } }),
      this.access.hasGlobalPermission(user.memberId, MEMBERS_PERMISSION),
    ]);
    const memberPoints = new Map((pointTotals as any[]).map((row: any) => [row.memberId, row._sum.pointsDelta ?? 0]));
    const memberCommitteePoints = new Map((committeePointTotals as any[]).map((row: any) => [`${row.memberId}:${row.committeeId}`, row._sum.pointsDelta ?? 0]));
    const memberCompletedTasks = new Map((completedTasks as any[]).map((row: any) => [row.assignedMemberId, row._count._all]));
    const mappedMembers = (members as any[]).map((member: any) => ({
      id: String(member.memberId), name: member.person.fullName,
      email: member.person.emailUniversity ?? member.person.emailPersonal ?? '',
      role: [...new Set([...member.committees.map(({ role }: { role: string }) => role), ...member.roleAssignments.map(({ roleCode }: { roleCode: string }) => roleCode)])].join(' / ') || 'Member',
      status: 'Active' as const, points: memberPoints.get(member.memberId) ?? 0,
      tasksCompleted: memberCompletedTasks.get(member.memberId) ?? 0, lastActivity: null,
      committees: member.committees.map(({ role, committeeId, committee }: { role: string; committeeId: number; committee: any }) => ({
        code: committee.committeeCode, name: committee.committeeName, role,
        points: memberCommitteePoints.get(`${member.memberId}:${committeeId}`) ?? 0,
      })),
      globalRoles: member.roleAssignments.map(({ roleCode }: { roleCode: string }) => roleCode),
    }));
    const now = new Date();
    return {
      committee: { id: null, code: 'CLUB', name: 'GDG on Campus UJ' },
      currentMember: user.memberId ? { id: String(user.memberId), name: person?.fullName ?? '', role: 'Club Leadership' } : null,
      stats: {
        committeeMembers: mappedMembers.length, activeMembers: mappedMembers.length, awayMembers: 0,
        upcomingEvents: (events as any[]).filter((event: any) => event.status === 'PUBLISHED' && event.startsAt >= now).length,
        upcomingEventsInNext30Days: (events as any[]).filter((event: any) => event.status === 'PUBLISHED' && event.startsAt >= now && event.startsAt < new Date(now.getTime() + 30 * 86400000)).length,
        totalPoints: [...memberPoints.values()].reduce((sum: number, value: number) => sum + value, 0), pointsThisMonth: monthPoints._sum.pointsDelta ?? 0,
        activeTasks, tasksDueThisWeek, eventsCreated: events.length,
        eventsPublishedThisYear: (events as any[]).filter((event: any) => event.status === 'PUBLISHED' && event.createdAt.getUTCFullYear() === now.getUTCFullYear()).length,
        pendingRegistrations: (registrationGroups as any[]).find(({ status }: { status: string }) => status === 'PENDING')?._count._all ?? 0,
        acceptedRegistrations: (registrationGroups as any[]).filter(({ status }: { status: string }) => ['CONFIRMED', 'AWAITING_CONFIRMATION'].includes(status)).reduce((sum: number, row: any) => sum + row._count._all, 0),
        rejectedRegistrations: (registrationGroups as any[]).filter(({ status }: { status: string }) => ['REJECTED', 'NOT_SELECTED'].includes(status)).reduce((sum: number, row: any) => sum + row._count._all, 0),
      },
      permissions: { canManageTasks: false, canManagePoints: false, canManageRegistrations: false, canAddMembers },
      committees: (committees as any[]).map(({ committeeCode, committeeName }: { committeeCode: string; committeeName: string }) => ({ code: committeeCode, name: committeeName })),
      members: mappedMembers,
      events: (events as any[]).map((event: any) => ({
        id: String(event.eventId), title: event.name, date: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
        location: event.location, imageUrl: event.imageUrl, status: event.status, registered: event._count.registrations,
        confirmed: 0, checkedIn: 0, capacity: event.capacity, createdAt: event.createdAt.toISOString(),
      })),
      tasks: (tasks as any[]).map((task: any) => ({
        id: String(task.taskId), title: task.title, description: task.description,
        assignedMemberId: String(task.assignedMemberId), assignedMemberName: task.assignee.person.fullName,
        createdByMemberId: String(task.createdByMemberId), dueAt: task.dueAt.toISOString(), priority: task.priority,
        status: task.status, taskScope: task.taskScope ?? 'COMMITTEE', eventId: task.eventId == null ? null : String(task.eventId), eventTitle: task.event?.name ?? null, createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
        committeeCode: task.committee.committeeCode, committeeName: task.committee.committeeName,
      })),
      pointHistory: (points as any[]).map((entry: any) => ({
        id: String(entry.pointEntryId), memberId: String(entry.memberId), memberName: entry.recipient.member.person.fullName,
        pointsDelta: entry.pointsDelta, reason: entry.reason, createdAt: entry.createdAt.toISOString(),
        committeeCode: entry.recipient.committee.committeeCode, committeeName: entry.recipient.committee.committeeName,
      })),
      recentActivities: [],
    };
  }

  async getDashboard(user: RequestUser | undefined, committeeCode: string) {
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode } });
    if (!committee) throw new NotFoundException();

    let membership = user?.memberId
      ? await this.prisma.memberCommittee.findUnique({
          where: { memberId_committeeId: { memberId: user.memberId, committeeId: committee.committeeId } },
          include: { member: { include: { person: true } } },
        })
      : null;
    if (membership && (!membership.member.isActive || !membership.member.person.isActive)) {
      membership = null;
    }

    if (!membership) throw new ForbiddenException('An active member of this committee is required for dashboard access.');

    const memberId = membership?.memberId ?? null;
    const [canViewDashboard, canManageTasks, canManagePoints, canManageRegistrations, canAddMembers, canCreateEvents] = memberId
      ? await Promise.all([
          this.access.hasCommitteePermission(memberId, VIEW_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, TASK_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, POINTS_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, 'registrations.review', undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, MEMBERS_PERMISSION, undefined, committee.committeeId),
          this.access.hasCommitteePermission(memberId, EVENTS_PERMISSION, undefined, committee.committeeId),
        ])
      : [true, false, false, false, false, false];
    if (!canViewDashboard) throw new ForbiddenException();
    const canViewWalletLinks = membership.role === 'Leader' || membership.role === 'Co-Leader';
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const monthStart = riyadhPeriodStart(now, 'month');
    const weekStart = riyadhPeriodStart(now, 'week');

    const [memberships, events, tasks, pointEntries, pointTotals, registrationGroups, checkInGroups, totalPoints, pointsThisMonth, tasksDueThisWeek]: any[] = await Promise.all([
      this.prisma.memberCommittee.findMany({
        where: { committeeId: committee.committeeId, member: { isActive: true, person: { isActive: true } } },
        include: {
          member: { include: { person: true } },
          ...(canViewWalletLinks ? {
            walletLinks: { where: { revokedAt: null }, take: 1, select: { verifiedAt: true } },
          } : {}),
        },
        orderBy: [{ role: 'asc' }, { member: { person: { fullName: 'asc' } } }],
      }),
      this.prisma.event.findMany({
        where: { committeeId: committee.committeeId },
        include: {
          _count: {
            select: {
              registrations: true,
            },
          },
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.committeeTask.findMany({
        where: { committeeId: committee.committeeId },
        include: { assignee: { include: { person: true } }, event: { select: { name: true } } },
        orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }],
      }),
      this.prisma.committeePointEntry.findMany({
        where: { committeeId: committee.committeeId },
        include: { recipient: { include: { member: { include: { person: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { pointEntryId: 'desc' }],
        take: 50,
      }),
      (this.prisma.committeePointEntry as any).groupBy({
        by: ['memberId'],
        where: { committeeId: committee.committeeId },
        _sum: { pointsDelta: true },
      }),
      (this.prisma.eventRegistration as any).groupBy({
        by: ['eventId', 'status'],
        where: { event: { committeeId: committee.committeeId } },
        _count: { _all: true },
      }),
      (this.prisma.eventRegistration as any).groupBy({
        by: ['eventId'],
        where: { event: { committeeId: committee.committeeId }, checkedInAt: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.committeePointEntry.aggregate({
        where: { committeeId: committee.committeeId },
        _sum: { pointsDelta: true },
      }),
      this.prisma.committeePointEntry.aggregate({
        where: { committeeId: committee.committeeId, createdAt: { gte: monthStart } },
        _sum: { pointsDelta: true },
      }),
      this.prisma.committeeTask.count({
        where: { committeeId: committee.committeeId, status: { not: CommitteeTaskStatus.COMPLETED }, dueAt: { gte: weekStart, lt: new Date(weekStart.getTime() + 7 * 86400000) } },
      }),
    ]);

    const memberPoints = new Map((pointTotals as any[]).map((item: any) => [item.memberId, item._sum.pointsDelta ?? 0]));
    const memberCompletedTasks = new Map<number, number>();
    for (const task of tasks as any[]) {
      if (task.status === CommitteeTaskStatus.COMPLETED) {
        memberCompletedTasks.set(task.assignedMemberId, (memberCompletedTasks.get(task.assignedMemberId) ?? 0) + 1);
      }
    }
    const activeMemberships = (memberships as any[]).filter(({ member }: { member: any }) => member.isActive);
    const members = activeMemberships.map(({ member, role, walletLinks }: {
      member: any; role: string; walletLinks?: { verifiedAt: Date }[];
    }) => ({
      id: String(member.memberId),
      name: member.person.fullName,
      email: member.person.emailUniversity ?? member.person.emailPersonal ?? '',
      role,
      status: 'Active' as const,
      points: memberPoints.get(member.memberId) ?? 0,
      tasksCompleted: memberCompletedTasks.get(member.memberId) ?? 0,
      lastActivity: null,
      ...(canViewWalletLinks && member.person.isActive && typeof member.membershipNumber === 'number' ? {
        wallet: { membershipNumber: member.membershipNumber, linked: Boolean(walletLinks?.length) },
      } : {}),
    }));
    const mappedTasks = (tasks as any[]).map((task: any) => ({
      id: String(task.taskId),
      title: task.title,
      description: task.description,
      assignedMemberId: String(task.assignedMemberId),
      assignedMemberName: task.assignee.person.fullName,
      createdByMemberId: String(task.createdByMemberId),
      dueAt: task.dueAt.toISOString(),
      priority: task.priority,
      status: task.status, taskScope: task.taskScope ?? 'COMMITTEE',
      eventId: task.eventId == null ? null : String(task.eventId), eventTitle: task.event?.name ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    }));
    const mappedPointHistory = (pointEntries as any[]).map((entry: any) => ({
      id: String(entry.pointEntryId),
      memberId: String(entry.memberId),
      memberName: entry.recipient.member.person.fullName,
      pointsDelta: entry.pointsDelta,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    }));
    const registrationCount = (status: string) => (registrationGroups as any[]).filter((group: any) => group.status === status).reduce((sum: number, group: any) => sum + group._count._all, 0);
    const publishedEvents = (events as any[]).filter((event: any) => event.status === 'PUBLISHED');

    return {
      committee: { id: committee.committeeId, code: committee.committeeCode, name: committee.committeeName },
      currentMember: membership
        ? { id: String(memberId), name: membership.member.person.fullName, role: membership.role }
        : null,
      stats: {
        committeeMembers: memberships.length,
        activeMembers: members.length,
        awayMembers: memberships.length - members.length,
        upcomingEvents: publishedEvents.filter((event: any) => event.startsAt >= now).length,
        upcomingEventsInNext30Days: publishedEvents.filter((event: any) => event.startsAt >= now && event.startsAt < in30Days).length,
        totalPoints: totalPoints._sum.pointsDelta ?? 0,
        pointsThisMonth: pointsThisMonth._sum.pointsDelta ?? 0,
        activeTasks: (tasks as any[]).filter((task: any) => task.status !== CommitteeTaskStatus.COMPLETED).length,
        tasksDueThisWeek,
        eventsCreated: events.length,
        eventsPublishedThisYear: publishedEvents.filter((event: any) => event.createdAt >= new Date(Date.UTC(now.getUTCFullYear(), 0, 1))).length,
        pendingRegistrations: registrationCount('PENDING'),
        acceptedRegistrations: registrationCount('CONFIRMED') + registrationCount('AWAITING_CONFIRMATION'),
        rejectedRegistrations: registrationCount('REJECTED') + registrationCount('NOT_SELECTED'),
      },
      permissions: { canManageTasks, canManagePoints, canManageRegistrations, canAddMembers, canCreateEvents },
      members,
      events: (events as any[]).map((event: any) => ({
        id: String(event.eventId),
        title: event.name,
        date: event.startsAt.toISOString(),
        eventType: event.eventType,
        endsAt: event.endsAt.toISOString(),
        location: event.location,
        imageUrl: event.imageUrl,
        status: event.status,
        registered: event._count.registrations,
        confirmed: (registrationGroups as any[]).filter((group: any) => group.eventId === event.eventId && ['CONFIRMED', 'AWAITING_CONFIRMATION'].includes(group.status)).reduce((sum: number, group: any) => sum + group._count._all, 0),
        checkedIn: (checkInGroups as any[]).find((group: any) => group.eventId === event.eventId)?._count._all ?? 0,
        capacity: event.capacity,
        createdAt: event.createdAt.toISOString(),
      })),
      tasks: mappedTasks,
      pointHistory: mappedPointHistory,
      recentActivities: [
        ...mappedPointHistory.slice(0, 10).map((entry: any) => ({
          id: `point-${entry.id}`, type: 'points_awarded', title: entry.pointsDelta >= 0 ? 'Points awarded' : 'Points deducted',
          description: `${entry.pointsDelta >= 0 ? '+' : ''}${entry.pointsDelta} points to ${entry.memberName} for ${entry.reason}.`, createdAt: entry.createdAt,
        })),
        ...mappedTasks.slice(0, 10).map((task: any) => ({
          id: `task-${task.id}`, type: 'details_updated', title: 'Task updated', description: task.title, createdAt: task.updatedAt,
        })),
      ].sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
    };
  }

  async addMember(user: RequestUser | undefined, committeeCode: string, dto: CreateCommitteeMemberDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, MEMBERS_PERMISSION, committee.committeeId);
    if (!MEMBER_ASSIGNABLE_COMMITTEE_CODES.has(committee.committeeCode)) {
      throw new ForbiddenException('Members can only be added through the approved committee workspaces.');
    }

    const email = dto.email.trim().toLowerCase();
    try {
      const assigned = await this.prisma.$transaction(async (transaction) => {
        const { person, member } = await this.resolveExistingAccountMember(transaction, email);
        const existingMembership = await transaction.memberCommittee.findUnique({
          where: { memberId_committeeId: { memberId: member.memberId, committeeId: committee.committeeId } },
        });
        if (existingMembership) throw new ConflictException('This person is already a member of the committee.');
        await transaction.memberCommittee.create({
          data: { memberId: member.memberId, committeeId: committee.committeeId, role: 'Member' },
        });
        return { result: { id: String(member.memberId), name: person.fullName, email, role: 'Member', status: 'Active' }, recipientName: person.fullName };
      });
      this.dispatchMembershipAssignmentEmail({
        to: email,
        recipientName: assigned.recipientName,
        decision: 'APPROVED',
        committeeName: committee.committeeName,
        roleName: 'Member',
      });
      return assigned.result;
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This person is already a member of the committee.');
      }
      throw error;
    }
  }

  async assignDeveloperCommitteeMember(user: RequestUser | undefined, dto: AssignDeveloperCommitteeMemberDto) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, 'developer_committees.members.assign'))) {
      throw new ForbiddenException();
    }
    const committeeCode = dto.committeeCode.trim().toUpperCase();
    const committee = await this.prisma.committee.findUnique({
      where: { committeeCode },
      include: { parent: { select: { committeeCode: true } } },
    });
    if (!committee || committee.parent?.committeeCode !== DEVELOPER_COMMITTEES_CODE) {
      throw new BadRequestException('Choose one of the six developer committees.');
    }
    const email = dto.email.trim().toLowerCase();
    const assigned = await this.prisma.$transaction(async (transaction) => {
      const { person, member } = await this.resolveExistingAccountMember(transaction, email);
      const membership = await this.createAssignedMembership(transaction, member.memberId, committee.committeeId, dto.role);
      return {
        result: {
          memberId: String(member.memberId), name: person.fullName, email,
          committee: { code: committee.committeeCode, name: committee.committeeName, role: membership.role },
        },
        recipientName: person.fullName,
      };
    });
    this.dispatchMembershipAssignmentEmail({
      to: email,
      recipientName: assigned.recipientName,
      decision: 'APPROVED',
      committeeName: committee.committeeName,
      roleName: dto.role,
    });
    return assigned.result;
  }

  async createEvent(user: RequestUser | undefined, committeeCode: string, dto: CreateCommitteeEventDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const registrationDeadline = new Date(dto.registrationDeadline);
    const questions = (dto.questions ?? []).map((question) => ({
      ...question,
      text: question.text.trim(),
      options: question.type === 'TEXT' ? [] : [...new Set((question.options ?? []).map((option) => option.trim()).filter(Boolean))],
    }));

    const errors: ApiErrorDetail[] = [];
    const now = Date.now();
    if (startsAt.getTime() <= now) errors.push({ pointer: '/startsAt', message: 'The event must start in the future.' });
    if (endsAt.getTime() <= startsAt.getTime()) errors.push({ pointer: '/endsAt', message: 'The event must end after it starts.' });
    if (registrationDeadline.getTime() <= now) errors.push({ pointer: '/registrationDeadline', message: 'The registration deadline must be in the future.' });
    if (registrationDeadline.getTime() > startsAt.getTime()) errors.push({ pointer: '/registrationDeadline', message: 'Registration must close before the event starts.' });
    questions.forEach((question, index) => {
      if (!question.text) errors.push({ pointer: `/questions/${index}/text`, message: 'Question text is required.' });
      if (question.type !== 'TEXT' && question.options.length < 2) {
        errors.push({ pointer: `/questions/${index}/options`, message: 'Choice questions need at least two different options.' });
      }
    });
    if (errors.length > 0) throw apiValidationError(errors);

    const event = await this.prisma.event.create({
      data: {
        name: dto.name.trim(),
        description: dto.description.trim(),
        eventType: dto.eventType,
        startsAt,
        endsAt,
        registrationDeadline,
        location: dto.location.trim(),
        mapsLink: dto.mapsLink?.trim() || null,
        capacity: dto.capacity,
        imageUrl: dto.imageUrl?.trim() || null,
        speakers: dto.speakers?.trim() || null,
        requirements: dto.requirements?.trim() || null,
        requiredRegistrantFields: [...new Set(dto.requiredRegistrantFields ?? [])],
        status: dto.status === 'PUBLISHED' ? EventStatus.PUBLISHED : EventStatus.DRAFT,
        createdByMemberId: memberId,
        committeeId: committee.committeeId,
        questions: {
          create: questions.map((question, index) => ({
            questionText: question.text,
            questionType: QuestionType[question.type],
            isRequired: question.required,
            position: index + 1,
            // SQL NULL, not a JSON null: the table requires text questions to have no options.
            options: question.type === 'TEXT' ? Prisma.DbNull : question.options,
          })),
        },
      },
      select: { eventId: true, name: true, status: true, startsAt: true, registrationDeadline: true },
    });
    return { id: String(event.eventId), ...event };
  }

  async uploadEventImage(user: RequestUser | undefined, committeeCode: string, file: { buffer: Buffer; mimetype: string; size: number } | undefined) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    if (!file) throw new BadRequestException('An image file is required.');
    if (!this.eventImageStorage) throw new ServiceUnavailableException('Event image storage is unavailable.');
    return this.eventImageStorage.upload(file);
  }

  // Full details of one of the committee's events, drafts included, for the people who create them.
  async getCommitteeEvent(user: RequestUser | undefined, committeeCode: string, eventId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    const event = await this.prisma.event.findFirst({
      where: { eventId, committeeId: committee.committeeId },
      select: {
        eventId: true, name: true, description: true, eventType: true, status: true,
        startsAt: true, endsAt: true, registrationDeadline: true, location: true, mapsLink: true,
        capacity: true, speakers: true, requirements: true, imageUrl: true, requiredRegistrantFields: true,
        questions: {
          orderBy: { position: 'asc' },
          select: { questionId: true, questionText: true, questionType: true, isRequired: true, options: true },
        },
      },
    });
    if (!event) throw new NotFoundException();
    return {
      id: String(event.eventId),
      ...event,
      requiredRegistrantFields: event.requiredRegistrantFields.filter((field: string) => field !== 'universityId'),
    };
  }

  async updateEvent(user: RequestUser | undefined, committeeCode: string, eventId: number, dto: UpdateCommitteeEventDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    const existing = await this.prisma.event.findFirst({
      where: { eventId, committeeId: committee.committeeId },
      select: {
        questions: {
          orderBy: { position: 'asc' },
          select: { questionText: true, questionType: true, isRequired: true, position: true, options: true },
        },
      },
    });
    if (!existing) throw new NotFoundException();

    const questions = (dto.questions ?? []).map((question) => ({
      ...question,
      text: question.text.trim(),
      options: question.type === 'TEXT' ? [] : [...new Set((question.options ?? []).map((option) => option.trim()).filter(Boolean))],
    }));
    const questionErrors: ApiErrorDetail[] = [];
    questions.forEach((question, index) => {
      if (!question.text) questionErrors.push({ pointer: `/questions/${index}/text`, message: 'Question text is required.' });
      if (question.type !== 'TEXT' && question.options.length < 2) {
        questionErrors.push({ pointer: `/questions/${index}/options`, message: 'Choice questions need at least two different options.' });
      }
    });
    if (questionErrors.length) throw apiValidationError(questionErrors);
    const questionsChanged = dto.questions !== undefined && (
      existing.questions.length !== questions.length || questions.some((question, index) => {
        const current = existing.questions[index];
        if (!current) return true;
        const currentOptions = Array.isArray(current.options) ? current.options : [];
        return current.questionText !== question.text
          || current.questionType !== QuestionType[question.type]
          || current.isRequired !== question.required
          || current.position !== index + 1
          || JSON.stringify(currentOptions) !== JSON.stringify(question.options);
      })
    );

    const event = await this.prisma.$transaction(async (transaction) => {
      const [locked] = await transaction.$queryRaw<Array<{
        published: boolean; draft: boolean; startsAt: Date; endsAt: Date; registrationDeadline: Date;
      }>>`
        SELECT status = 'published' AS published, status = 'draft' AS draft,
               starts_at AS "startsAt", ends_at AS "endsAt", registration_deadline AS "registrationDeadline"
        FROM events
        WHERE event_id = ${eventId} AND committee_id = ${committee.committeeId}
        FOR UPDATE
      `;
      if (!locked) throw new NotFoundException();
      if (!locked.published && !locked.draft) throw new ConflictException('This event is closed for editing.');
      const startsAt = dto.startsAt === undefined ? locked.startsAt : new Date(dto.startsAt);
      const endsAt = dto.endsAt === undefined ? locked.endsAt : new Date(dto.endsAt);
      const registrationDeadline = dto.registrationDeadline === undefined
        ? locked.registrationDeadline : new Date(dto.registrationDeadline);
      const errors: ApiErrorDetail[] = [];
      if (endsAt <= startsAt) errors.push({ pointer: '/endsAt', message: 'The event must end after it starts.' });
      if (registrationDeadline > startsAt) errors.push({ pointer: '/registrationDeadline', message: 'Registration must close before the event starts.' });
      if (errors.length) throw apiValidationError(errors);
      if (locked.published) {
        const now = new Date();
        if (locked.endsAt <= now || endsAt <= now) throw new ConflictException('An ended event cannot be rescheduled.');
        const scheduleFields = ['startsAt', 'endsAt', 'registrationDeadline'];
        if (Object.entries(dto).some(([field, value]) => value !== undefined && !scheduleFields.includes(field))) {
          throw new BadRequestException('Only the schedule can be changed after an event is published.');
        }
        if (startsAt.getTime() !== locked.startsAt.getTime()) {
          if (locked.startsAt <= now || startsAt <= now) {
            throw new ConflictException('A new start time must be set before the event starts.');
          }
          await transaction.eventRegistration.updateMany({
            where: { eventId, status: 'AWAITING_CONFIRMATION', confirmationDeadline: { gt: startsAt } },
            data: { confirmationDeadline: startsAt },
          });
        }
      }
      if (questionsChanged) {
        const registrationCount = await transaction.eventRegistration.count({ where: { eventId } });
        if (registrationCount > 0) throw new ConflictException('Registration questions cannot be changed after people register.');
      }
      if (dto.capacity !== undefined) {
        const heldSeats = await transaction.eventRegistration.count({
          where: { eventId, status: { in: SEAT_HOLDING_STATUSES } },
        });
        if (dto.capacity < heldSeats) {
          throw apiValidationError([{ pointer: '/capacity', message: `Capacity cannot be lower than the ${heldSeats} seats already held.` }]);
        }
      }
      return transaction.event.update({
        where: { eventId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(dto.eventType !== undefined ? { eventType: dto.eventType } : {}),
          ...(dto.startsAt !== undefined ? { startsAt } : {}),
          ...(dto.endsAt !== undefined ? { endsAt } : {}),
          ...(dto.registrationDeadline !== undefined ? { registrationDeadline } : {}),
          ...(dto.location !== undefined ? { location: dto.location.trim() } : {}),
          ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
          ...(dto.mapsLink !== undefined ? { mapsLink: dto.mapsLink?.trim() || null } : {}),
          ...(dto.speakers !== undefined ? { speakers: dto.speakers.trim() || null } : {}),
          ...(dto.requirements !== undefined ? { requirements: dto.requirements.trim() || null } : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl?.trim() || null } : {}),
          ...(questionsChanged ? {
            questions: {
              deleteMany: {},
              create: questions.map((question, index) => ({
                questionText: question.text,
                questionType: QuestionType[question.type],
                isRequired: question.required,
                position: index + 1,
                options: question.type === 'TEXT' ? Prisma.DbNull : question.options,
              })),
            },
          } : {}),
        },
        select: { eventId: true, name: true, status: true, startsAt: true, endsAt: true, location: true, capacity: true, updatedAt: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return { id: String(event.eventId), ...event };
  }

  // Only drafts can be deleted: nobody can register for a draft, so no registration is lost.
  async deleteDraftEvent(user: RequestUser | undefined, committeeCode: string, eventId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    const event = await this.prisma.event.findFirst({
      where: { eventId, committeeId: committee.committeeId },
      select: { status: true },
    });
    if (!event) throw new NotFoundException();
    if (event.status !== EventStatus.DRAFT) throw new ConflictException('Only a draft can be deleted.');
    // Conditional delete, so a draft published at the same moment is kept. Its questions go with it.
    const { count } = await this.prisma.event.deleteMany({ where: { eventId, status: EventStatus.DRAFT } });
    if (count === 0) throw new ConflictException('Only a draft can be deleted.');
    return { id: String(eventId) };
  }

  async publishEvent(user: RequestUser | undefined, committeeCode: string, eventId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, EVENTS_PERMISSION, committee.committeeId);
    const event = await this.prisma.event.findFirst({
      where: { eventId, committeeId: committee.committeeId },
      select: { status: true, registrationDeadline: true },
    });
    if (!event) throw new NotFoundException();
    if (event.status !== EventStatus.DRAFT) throw new ConflictException('Only a draft can be published.');
    if (event.registrationDeadline.getTime() <= Date.now()) {
      throw apiValidationError([{ pointer: '/registrationDeadline', message: 'The registration deadline has passed.' }]);
    }
    // Conditional update so two publishes at once cannot both succeed.
    const { count } = await this.prisma.event.updateMany({
      where: { eventId, status: EventStatus.DRAFT },
      data: { status: EventStatus.PUBLISHED },
    });
    if (count === 0) throw new ConflictException('Only a draft can be published.');
    return { id: String(eventId), status: EventStatus.PUBLISHED };
  }

  // club leadership adds an existing member to another committee; new people still join through membership requests
  async assignClubPerson(user: RequestUser | undefined, dto: AssignClubPersonDto) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, MEMBERS_PERMISSION))) throw new ForbiddenException();
    const email = dto.email.trim().toLowerCase();
    const globalRole = dto.role === 'ADVISOR' || dto.role === 'DEVELOPER_COMMITTEES_LEADER';
    if (globalRole && dto.committeeCode) throw new BadRequestException('Global roles do not use a committee.');
    if (!globalRole && !dto.committeeCode?.trim()) throw new BadRequestException('Choose a committee for this role.');

    const assigned = await this.prisma.$transaction(async (transaction) => {
      const { person, member } = await this.resolveExistingAccountMember(transaction, email);
      if (globalRole) {
        const createdRole = await transaction.memberRole.createMany({
          data: [{ memberId: member.memberId, roleCode: dto.role, assignedBy: user.memberId! }],
          skipDuplicates: true,
        });
        return {
          result: { memberId: String(member.memberId), name: person.fullName, email, role: dto.role },
          recipientName: person.fullName,
          committeeName: undefined as string | undefined,
          globalRoleName: dto.role === 'ADVISOR' ? 'Advisor' : 'Developer Committees Leader',
          roleName: dto.role === 'ADVISOR' ? 'Advisor' : 'Leader',
          notifyEmail: createdRole.count > 0,
        };
      }

      const committeeCode = dto.committeeCode!.trim().toUpperCase();
      const committee = await transaction.committee.findFirst({
        where: { committeeCode, children: { none: {} } },
        select: { committeeId: true, committeeCode: true, committeeName: true },
      });
      if (!committee) throw new NotFoundException('The selected committee does not exist or cannot have members.');
      const membership = await this.assignClubCommitteeRole(transaction, member.memberId, committee.committeeId, dto.role);
      return {
        result: {
          memberId: String(member.memberId), name: person.fullName, email,
          committee: { code: committee.committeeCode, name: committee.committeeName, role: membership.role },
        },
        recipientName: person.fullName,
        committeeName: committee.committeeName,
        globalRoleName: undefined as string | undefined,
        roleName: membership.role,
        notifyEmail: true,
      };
    });
    if (assigned.notifyEmail) {
      this.dispatchMembershipAssignmentEmail({
        to: email,
        recipientName: assigned.recipientName,
        decision: 'APPROVED',
        ...(assigned.committeeName ? { committeeName: assigned.committeeName } : { globalRoleName: assigned.globalRoleName }),
        roleName: assigned.roleName,
      });
    }
    return assigned.result;
  }

  async addMemberToCommittee(user: RequestUser | undefined, targetMemberId: number, dto: AddMemberToCommitteeDto) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, MEMBERS_PERMISSION))) throw new ForbiddenException();
    const committee = await this.prisma.committee.findFirst({
      where: { committeeCode: dto.committeeCode.trim().toUpperCase(), children: { none: {} } },
    });
    if (!committee) throw new NotFoundException('The selected leaf committee does not exist.');
    const member = await this.prisma.member.findUnique({ where: { memberId: targetMemberId }, include: { person: true } });
    if (!member || !member.isActive || !member.person.isActive) throw new NotFoundException('The selected person is not an active member.');

    try {
      const membership = await this.prisma.memberCommittee.create({
        data: { memberId: member.memberId, committeeId: committee.committeeId, role: 'Member' },
      });
      this.dispatchMembershipAssignmentEmail({
        to: member.person.emailPersonal ?? member.person.emailUniversity,
        recipientName: member.person.fullName,
        decision: 'APPROVED',
        committeeName: committee.committeeName,
        roleName: membership.role,
      });
      return {
        memberId: String(member.memberId),
        committee: { code: committee.committeeCode, name: committee.committeeName, role: membership.role, points: 0 },
      };
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This person is already a member of the committee.');
      }
      throw error;
    }
  }

  async removeClubPerson(user: RequestUser | undefined, dto: RemoveClubPersonDto) {
    if (!user?.memberId || !(await this.access.hasGlobalPermission(user.memberId, MEMBERS_PERMISSION))) {
      throw new ForbiddenException();
    }

    const email = dto.email.trim().toLowerCase();
    const requestedCommitteeCode = dto.committeeCode?.trim().toUpperCase();
    return this.prisma.$transaction(async (transaction) => {
      const people = await transaction.person.findMany({
        where: {
          isActive: true,
          OR: [
            { emailPersonal: { equals: email, mode: 'insensitive' } },
            { emailUniversity: { equals: email, mode: 'insensitive' } },
            { emailIdentities: { some: { email: { equals: email, mode: 'insensitive' } } } },
          ],
        },
        include: {
          member: {
            include: {
              roleAssignments: {
                where: { endsOn: null, OR: [{ startsOn: null }, { startsOn: { lte: new Date() } }] },
                select: { roleCode: true },
              },
            },
          },
        },
        orderBy: { personId: 'asc' },
        take: 2,
      });
      if (people.length > 1) {
        throw new ConflictException('This email matches more than one account. No membership was removed.');
      }
      const person = people[0];
      const member = person?.member;
      if (!person || !member?.isActive) {
        throw new NotFoundException('No active group membership was found for this email.');
      }
      if (member.memberId === user.memberId) {
        throw new ConflictException('You cannot remove your own group membership.');
      }

      if (requestedCommitteeCode === 'ADVISOR' || requestedCommitteeCode === 'DEVELOPER_COMMITTEES_LEADER') {
        const roleCode = requestedCommitteeCode;
        const activeRole = await transaction.memberRole.findFirst({
          where: {
            memberId: member.memberId,
            roleCode,
            AND: [
              { OR: [{ startsOn: null }, { startsOn: { lte: new Date() } }] },
              { OR: [{ endsOn: null }, { endsOn: { gte: new Date() } }] },
            ],
          },
          select: { id: true },
        });
        if (!activeRole) throw new NotFoundException('This person does not have the selected group role.');
        await transaction.$executeRaw`
          UPDATE "member_role"
          SET "ends_on" = CURRENT_DATE - 1
          WHERE "member_id" = ${member.memberId}
            AND "role_code" = ${roleCode}
            AND ("starts_on" IS NULL OR "starts_on" < CURRENT_DATE)
            AND ("ends_on" IS NULL OR "ends_on" >= CURRENT_DATE)`;
        // Date-only role assignments cannot represent a same-day revocation;
        // remove a role created today so access ends immediately.
        await transaction.$executeRaw`
          DELETE FROM "member_role"
          WHERE "member_id" = ${member.memberId}
            AND "role_code" = ${roleCode}
            AND "starts_on" >= CURRENT_DATE
            AND ("ends_on" IS NULL OR "ends_on" >= CURRENT_DATE)`;
        return {
          memberId: String(member.memberId),
          name: person.fullName,
          email,
          globalRole: roleCode,
          globalRoleRemoved: true,
          membershipRemoved: false,
        };
      }

      if (requestedCommitteeCode) {
        const committee = await transaction.committee.findFirst({
          where: { committeeCode: requestedCommitteeCode, children: { none: {} } },
          select: { committeeId: true, committeeCode: true, committeeName: true },
        });
        if (!committee) throw new NotFoundException('The selected committee does not exist.');
        const membership = await transaction.memberCommittee.findUnique({
          where: { memberId_committeeId: { memberId: member.memberId, committeeId: committee.committeeId } },
          select: { id: true, role: true },
        });
        if (!membership) throw new NotFoundException('This person is not an active member of the selected committee.');

        await transaction.memberCommittee.delete({ where: { id: membership.id } });
        return {
          memberId: String(member.memberId),
          name: person.fullName,
          email,
          committee: { code: committee.committeeCode, name: committee.committeeName, role: membership.role },
          committeeMembershipRemoved: true,
          membershipRemoved: false,
        };
      }

      const groupLeadershipCodes = ['GROUP_LEADER', 'GROUP_CO_LEADER'];
      const hasGroupLeadershipRole = member.roleAssignments.some(({ roleCode }) =>
        groupLeadershipCodes.includes(roleCode),
      );
      if (hasGroupLeadershipRole) {
        // Serialize leadership removals so two requests cannot remove the last
        // active group leader at the same time.
        await transaction.$queryRaw`
          SELECT id FROM "member_role"
          WHERE "role_code" IN ('GROUP_LEADER', 'GROUP_CO_LEADER')
            AND "ends_on" IS NULL
          FOR UPDATE`;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const otherLeaders = await transaction.memberRole.findMany({
          where: {
            memberId: { not: member.memberId },
            roleCode: { in: groupLeadershipCodes },
            endsOn: null,
            member: { isActive: true, person: { isActive: true } },
            OR: [{ startsOn: null }, { startsOn: { lte: today } }],
          },
          distinct: ['memberId'],
          take: 1,
          select: { memberId: true },
        });
        if (otherLeaders.length === 0) {
          throw new ConflictException('The last active group leader cannot be removed.');
        }
      }

      await transaction.member.update({
        where: { memberId: member.memberId },
        data: { isActive: false },
      });
      await transaction.$executeRaw`
        UPDATE "member_role"
        SET "ends_on" = GREATEST(CURRENT_DATE, COALESCE("starts_on", CURRENT_DATE))
        WHERE "member_id" = ${member.memberId} AND "ends_on" IS NULL`;

      return {
        memberId: String(member.memberId),
        name: person.fullName,
        email,
        membershipRemoved: true,
      };
    });
  }

  async createTask(user: RequestUser | undefined, committeeCode: string, dto: CreateCommitteeTaskDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    await this.requireCommitteeMember(committee.committeeId, dto.assignedMemberId);
    const task = await this.prisma.committeeTask.create({
      data: {
        committeeId: committee.committeeId,
        title: dto.title.trim(),
        description: dto.description?.trim() ?? '',
        assignedMemberId: dto.assignedMemberId,
        createdByMemberId: memberId,
        dueAt: new Date(dto.dueAt),
        priority: dto.priority,
        status: dto.status ?? CommitteeTaskStatus.TODO,
        taskScope: 'COMMITTEE',
        eventId: null,
      },
      include: { assignee: { include: { person: true } }, event: { select: { name: true } } },
    });
    return this.mapTask(task);
  }

  async updateTask(user: RequestUser | undefined, committeeCode: string, taskId: number, dto: UpdateCommitteeTaskDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    const existing = await this.prisma.committeeTask.findFirst({ where: { taskId, committeeId: committee.committeeId } });
    if (!existing) throw new NotFoundException();
    if (existing.taskScope !== 'COMMITTEE') throw new ForbiddenException();
    if (dto.assignedMemberId !== undefined) await this.requireCommitteeMember(committee.committeeId, dto.assignedMemberId);
    const task = await this.prisma.committeeTask.update({
      where: { taskId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.assignedMemberId !== undefined ? { assignedMemberId: dto.assignedMemberId } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: new Date(dto.dueAt) } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { assignee: { include: { person: true } }, event: { select: { name: true } } },
    });
    return this.mapTask(task);
  }

  // A member moves their own task along; marking it done only asks a leader to confirm it.
  async updateMyTaskStatus(memberId: number | null | undefined, taskId: number, status: (typeof MEMBER_TASK_STATUSES)[number]) {
    if (!memberId) throw new ForbiddenException();
    const task = await this.prisma.committeeTask.findFirst({
      where: { taskId, assignedMemberId: memberId, assignee: { isActive: true, person: { isActive: true } } },
      select: { status: true },
    });
    if (!task) throw new NotFoundException();
    if (task.status === CommitteeTaskStatus.COMPLETED) throw new ConflictException('A confirmed task cannot be changed.');
    if (task.status !== status) {
      // Conditional, so a leader's confirmation at the same moment is never overwritten.
      const { count } = await this.prisma.committeeTask.updateMany({
        where: { taskId, assignedMemberId: memberId, status: task.status },
        data: { status },
      });
      if (count === 0) throw new ConflictException('The task changed; reload and try again.');
    }
    return (await this.getMyTasks(memberId)).find((item: any) => item.id === String(taskId));
  }

  // A committee leader confirms a task the member marked done, or sends it back.
  async reviewTask(user: RequestUser | undefined, committeeCode: string, taskId: number, decision: 'APPROVE' | 'RETURN') {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    const task = await this.prisma.committeeTask.findFirst({ where: { taskId, committeeId: committee.committeeId, taskScope: 'COMMITTEE' }, select: { status: true } });
    if (!task) throw new NotFoundException();
    const { count } = await this.prisma.committeeTask.updateMany({
      where: { taskId, committeeId: committee.committeeId, taskScope: 'COMMITTEE', status: CommitteeTaskStatus.PENDING_REVIEW },
      data: { status: decision === 'APPROVE' ? CommitteeTaskStatus.COMPLETED : CommitteeTaskStatus.IN_PROGRESS },
    });
    if (count === 0) throw new ConflictException('Only a task waiting for confirmation can be reviewed.');
    const updated = await this.prisma.committeeTask.findUniqueOrThrow({
      where: { taskId },
      include: { assignee: { include: { person: true } }, event: { select: { name: true } } },
    });
    return this.mapTask(updated);
  }

  async deleteTask(user: RequestUser | undefined, committeeCode: string, taskId: number) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, TASK_PERMISSION, committee.committeeId);
    const result = await this.prisma.committeeTask.deleteMany({ where: { taskId, committeeId: committee.committeeId, taskScope: 'COMMITTEE' } });
    if (!result.count) throw new NotFoundException();
    return { deleted: true };
  }

  async getWalletLink(user: RequestUser | undefined, committeeCode: string, targetMemberId: number) {
    if (!user?.memberId) throw new ForbiddenException();
    const { committee, membership } = await this.requireMembership(user, committeeCode.trim().toUpperCase());
    if (membership.role !== 'Leader' && membership.role !== 'Co-Leader') throw new ForbiddenException();

    const target = await this.prisma.memberCommittee.findFirst({
      where: {
        committeeId: committee.committeeId,
        memberId: targetMemberId,
        member: { isActive: true, person: { isActive: true } },
      },
      select: {
        member: { select: { membershipNumber: true } },
        walletLinks: {
          where: { revokedAt: null },
          select: { verifiedAt: true },
          take: 1,
        },
      },
    });
    if (!target) throw new NotFoundException();
    return {
      membershipNumber: target.member.membershipNumber,
      walletLinked: target.walletLinks.length > 0,
    };
  }

  async updatePoints(user: RequestUser | undefined, committeeCode: string, targetMemberId: number, dto: UpdateCommitteePointsDto) {
    const { committee, memberId } = await this.requireMembership(user, committeeCode);
    await this.requirePermission(memberId, POINTS_PERMISSION, committee.committeeId);
    await this.requireCommitteeMember(committee.committeeId, targetMemberId);
    if (!Number.isSafeInteger(dto.pointsDelta) || dto.pointsDelta === 0) throw new BadRequestException('A non-zero points change is required.');

    return this.prisma.$transaction(async (transaction) => {
      // Lock the actual committee membership row so concurrent point changes
      // for this member are serialized without returning PostgreSQL's `void`
      // advisory-lock result through Prisma.
      const membership = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM member_committee
        WHERE committee_id = ${committee.committeeId}
          AND member_id = ${targetMemberId}
        FOR UPDATE
      `;
      if (membership.length === 0) throw new NotFoundException();

      const current = await transaction.committeePointEntry.aggregate({
        where: { committeeId: committee.committeeId, memberId: targetMemberId },
        _sum: { pointsDelta: true },
      });
      if ((current._sum.pointsDelta ?? 0) + dto.pointsDelta < 0) {
        throw new ForbiddenException('A points deduction cannot reduce a member below zero.');
      }
      const entry = await transaction.committeePointEntry.create({
        data: {
          committeeId: committee.committeeId,
          memberId: targetMemberId,
          awardedByMemberId: memberId,
          pointsDelta: dto.pointsDelta,
          reason: dto.reason.trim(),
        },
        include: { recipient: { include: { member: { include: { person: true } } } } },
      });
      return {
        id: String(entry.pointEntryId), memberId: String(entry.memberId),
        memberName: entry.recipient.member.person.fullName, pointsDelta: entry.pointsDelta,
        reason: entry.reason, createdAt: entry.createdAt.toISOString(),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  // The signed-in member's own tasks in every committee they belong to; the id comes from the token only.
  async getMyTasks(memberId: number | null | undefined) {
    if (!memberId) return [];
    const tasks: any[] = await this.prisma.committeeTask.findMany({
      where: { assignedMemberId: memberId, assignee: { isActive: true, person: { isActive: true } } },
      include: {
        assignee: { include: { person: true } },
        committee: { select: { committeeCode: true, committeeName: true } },
        event: { select: { name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { taskId: 'desc' }],
      take: 500,
    });
    return tasks.map((task: any) => ({
      ...this.mapTask(task),
      committeeCode: task.committee.committeeCode,
      committeeName: task.committee.committeeName,
    }));
  }

  async getMyCommitteeDirectory(user: { memberId?: number | null } | undefined, committeeCode: string) {
    const { committee } = await this.requireMembership(user, committeeCode.trim().toUpperCase());
    const memberships = await this.prisma.memberCommittee.findMany({
      where: { committeeId: committee.committeeId, member: { isActive: true, person: { isActive: true } } },
      include: {
        member: {
          include: {
            person: {
              select: {
                fullName: true, university: true, major: true, phoneNumber: true,
                profileImageUrl: true, bio: true, githubUrl: true, portfolioUrl: true, xUrl: true,
              },
            },
          },
        },
      },
      orderBy: [{ role: 'asc' }, { member: { person: { fullName: 'asc' } } }],
    });
    return memberships.map(({ member, role }: any) => ({
      id: String(member.memberId),
      name: member.person.fullName,
      role,
      university: member.person.university,
      major: member.person.major,
      phone: member.person.phoneNumber,
      profileImageUrl: member.person.profileImageUrl,
      bio: member.person.bio,
      socialLinks: {
        github: member.person.githubUrl,
        linkedin: null,
        website: member.person.portfolioUrl,
        x: member.person.xUrl,
      },
    }));
  }

  private mapTask(task: {
    taskId: number; title: string; description: string; assignedMemberId: number;
    createdByMemberId: number; dueAt: Date; priority: string; status: string;
    createdAt: Date; updatedAt: Date; assignee: { person: { fullName: string } }; taskScope?: string; eventId?: number | null; event?: { name: string } | null;
  }) {
    return {
      id: String(task.taskId), title: task.title, description: task.description,
      assignedMemberId: String(task.assignedMemberId), assignedMemberName: task.assignee.person.fullName,
      createdByMemberId: String(task.createdByMemberId), dueAt: task.dueAt.toISOString(),
      priority: task.priority, status: task.status, taskScope: task.taskScope ?? 'COMMITTEE',
      eventId: task.eventId == null ? null : String(task.eventId), eventTitle: task.event?.name ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private async createAssignedMembership(transaction: Prisma.TransactionClient, memberId: number, committeeId: number, role: string) {
    try {
      return await transaction.memberCommittee.create({ data: { memberId, committeeId, role } });
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This person is already assigned to the committee.');
      }
      throw error;
    }
  }

  private async assignClubCommitteeRole(transaction: Prisma.TransactionClient, memberId: number, committeeId: number, role: string) {
    const existing = await transaction.memberCommittee.findUnique({
      where: { memberId_committeeId: { memberId, committeeId } },
    });
    if (existing) {
      if (existing.role === role) {
        throw new ConflictException('This person already has this role in the selected committee.');
      }
      return transaction.memberCommittee.update({
        where: { memberId_committeeId: { memberId, committeeId } },
        data: { role },
      });
    }
    return this.createAssignedMembership(transaction, memberId, committeeId, role);
  }

  private async resolveExistingAccountMember(transaction: Prisma.TransactionClient, email: string) {
    const person = await transaction.person.findFirst({
      where: { emailPersonal: { equals: email, mode: 'insensitive' }, authUserId: { not: null } },
      include: { member: true },
    });
    if (!person) throw new NotFoundException('An existing platform account with this login email is required.');
    if (!person.isActive) throw new ConflictException('This platform account is inactive.');
    let member = person.member;
    if (!member) {
      member = await transaction.member.create({ data: { personId: person.personId } });
    }
    if (!member.isActive) throw new ConflictException('This member is inactive and cannot be assigned.');
    return { person, member };
  }

  private dispatchMembershipAssignmentEmail(
    email: Parameters<MembershipRequestEmailService['sendDecisionEmail']>[0],
  ) {
    if (!this.membershipEmails) return;
    void Promise.resolve()
      .then(() => this.membershipEmails!.sendDecisionEmail(email))
      .catch((error: unknown) => {
        this.logger.error({
          event: 'direct_membership_assignment_email_failed',
          decision: email.decision,
          targetName: email.committeeName ?? email.globalRoleName ?? 'group role',
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      });
  }

  private async requireMembership(user: { memberId?: number | null } | undefined, committeeCode: string) {
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode } });
    if (!committee) throw new NotFoundException();
    let membership = user?.memberId
      ? await this.prisma.memberCommittee.findUnique({
          where: { memberId_committeeId: { memberId: user.memberId, committeeId: committee.committeeId } },
          include: { member: { include: { person: true } } },
        })
      : null;

    if (!membership) {
      if (!user?.memberId) throw new ForbiddenException();
      throw new ForbiddenException('An active member of this committee is required for dashboard changes.');
    }
    if (!membership.member.isActive || !membership.member.person.isActive) throw new ForbiddenException();
    return { committee, memberId: membership.memberId, membership };
  }

  private async requirePermission(memberId: number, permission: string, committeeId: number) {
    if (!(await this.access.hasCommitteePermission(memberId, permission, undefined, committeeId))) throw new ForbiddenException();
  }

  private async requireCommitteeMember(committeeId: number, memberId: number) {
    const membership = await this.prisma.memberCommittee.findFirst({
      where: { committeeId, memberId, member: { isActive: true } },
    });
    if (!membership) throw new NotFoundException('The selected person is not an active member of this committee.');
  }
}

function riyadhPeriodStart(now: Date, period: 'month' | 'week') {
  const local = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const offset = period === 'month' ? day - 1 : day - local.getUTCDay();
  const monthIndex = period === 'month' ? month : month;
  return new Date(Date.UTC(year, monthIndex, 1 + (period === 'week' ? offset : 0)) - 3 * 60 * 60 * 1000);
}
