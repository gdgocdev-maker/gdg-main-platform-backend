import {
  ConflictException,
  ForbiddenException,
  Inject,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipCommitteeDecision,
  MembershipRequestStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/current-user.js';
import { approvalScopeFor, findApplicableCommittees } from '../committees/committee-catalog.js';
import {
  CommitteeAccessService,
} from '../registrations/committee-access.service.js';
import type {
  CreateMembershipRequestDto,
  DecideMembershipRequestDto,
} from './membership-request.dto.js';
import { MembershipRequestEmailService } from './membership-request-email.service.js';

export const APPLICATIONS_DECIDE = 'applications.decide';
const DEVELOPER_LEADERS_DECIDE = 'applications.developer_leaders.decide';

type ApprovalScope = 'COMMITTEE' | 'DEVELOPER_COMMITTEES' | 'CLUB';

const requestInclude = {
  person: {
    select: {
      fullName: true,
      emailPersonal: true,
      emailUniversity: true,
    },
  },
  committees: {
    include: { committee: { select: { committeeCode: true, committeeName: true } } },
    orderBy: { committeeId: 'asc' as const },
  },
  globalRoles: { include: { role: { select: { roleCode: true, description: true } } } },
} as const;

@Injectable()
export class MembershipRequestService {
  private readonly logger = new Logger(MembershipRequestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService) private readonly access: CommitteeAccessService,
    @Inject(MembershipRequestEmailService) private readonly emails?: MembershipRequestEmailService,
  ) {}

  async create(user: AuthenticatedUser, body: CreateMembershipRequestDto) {
    const person = await this.prisma.person.findUnique({
      where: { personId: user.personId },
      select: { emailPersonalVerifiedAt: true },
    });
    if (!person?.emailPersonalVerifiedAt) throw new ForbiddenException('Verify your personal email before submitting a membership request.');
    const committees = await findApplicableCommittees(this.prisma, body.committees.map(({ committeeCode }) => committeeCode));
    if (!committees) throw new NotFoundException('One or more selected committees are unavailable.');

    const existing = await this.prisma.membershipRequest.findUnique({
      where: { personId: user.personId },
      include: requestInclude,
    });
    if (existing) return this.serialize(existing);

    const applicationData = JSON.parse(JSON.stringify(body.applicationData));
    try {
      const request = await this.prisma.membershipRequest.create({
        data: {
          personId: user.personId,
          applicationData,
          committees: {
            create: body.committees.map((item) => {
              const committee = committees.find((c) => c.committeeCode === item.committeeCode)!;
              return {
                committeeId: committee.committeeId,
                requestedRole: item.requestedRole,
                approvalScope: approvalScopeFor(committee, item.requestedRole),
              };
            }),
          },
        },
        include: requestInclude,
      });
      return this.serialize(request);
    } catch (error) {
      // Concurrent duplicate submissions are treated as idempotent.
      const raced = await this.prisma.membershipRequest.findUnique({
        where: { personId: user.personId },
        include: requestInclude,
      });
      if (raced) return this.serialize(raced);
      throw error;
    }
  }

  async list(committeeCode: string, actorMemberId: number) {
    await this.assertCanDecide(actorMemberId, committeeCode);
    const committee = await this.prisma.committee.findUnique({
      where: { committeeCode },
      select: { committeeId: true },
    });
    if (!committee) throw new NotFoundException('Committee not found.');

    const rows = await this.prisma.membershipRequestCommittee.findMany({
      where: { committeeId: committee.committeeId, approvalScope: 'COMMITTEE', requestedRole: 'Member' },
      orderBy: [
        { status: 'asc' },
        { membershipRequest: { createdAt: 'asc' } },
        { membershipRequestCommitteeId: 'asc' },
      ],
      include: {
        membershipRequest: { include: requestInclude },
      },
    });
    return rows.map((row) => ({
      ...this.serialize(row.membershipRequest),
      committeeDecision: {
        committeeCode,
        status: row.status,
        requestedRole: row.requestedRole,
        decidedAt: row.decidedAt,
      },
    }));
  }

  async decide(
    requestId: number,
    committeeCode: string,
    decision: DecideMembershipRequestDto['decision'],
    actor: AuthenticatedUser,
  ) {
    const actorMemberId = actor.memberId;
    if (!actorMemberId) throw new ForbiddenException();
    await this.assertCanDecide(actorMemberId, committeeCode);

    const committee = await this.prisma.committee.findUnique({
      where: { committeeCode },
      select: { committeeId: true },
    });
    if (!committee) throw new NotFoundException('Committee not found.');

    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ membership_request_id: number }[]>`
        SELECT membership_request_id FROM membership_request
        WHERE membership_request_id = ${requestId}
        FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Membership request not found.');

      const application = await tx.membershipRequestCommittee.findFirst({
        where: { membershipRequestId: requestId, committeeId: committee.committeeId },
      });
      if (!application) throw new NotFoundException('Membership request not found.');
      if (application.approvalScope !== 'COMMITTEE' || application.requestedRole !== 'Member') throw new ForbiddenException('Leadership applications require the leadership approval route.');
      const requestOwner = await tx.membershipRequest.findUniqueOrThrow({ where: { membershipRequestId: requestId }, select: { personId: true } });
      if (requestOwner.personId === actor.personId) throw new ForbiddenException('You cannot approve your own request.');
      if (application.status !== MembershipCommitteeDecision.PENDING) {
        throw new ConflictException('This committee has already decided this request.');
      }

      if (decision === MembershipCommitteeDecision.APPROVED) {
        const member = await this.getOrCreateActiveMember(tx, requestOwner.personId);
        // The selected role is only a preference. Never promote an applicant
        // into a privileged committee position through this decision endpoint.
        await tx.memberCommittee.upsert({
          where: { memberId_committeeId: { memberId: member.memberId, committeeId: committee.committeeId } },
          create: { memberId: member.memberId, committeeId: committee.committeeId, role: 'Member' },
          update: {},
        });
      }

      await tx.membershipRequestCommittee.update({
        where: { membershipRequestCommitteeId: application.membershipRequestCommitteeId },
        data: {
          status: decision,
          decidedByMemberId: actorMemberId,
          decidedAt: new Date(),
        },
      });

      await this.refreshAggregateStatus(tx, requestId);

      const updated = await tx.membershipRequest.findUniqueOrThrow({
        where: { membershipRequestId: requestId },
        include: requestInclude,
      });
      const ownDecision = updated.committees.find((row) => row.committeeId === committee.committeeId)!;
      return {
        response: {
          ...this.serialize(updated),
          committeeDecision: {
            committeeCode,
            status: ownDecision.status,
            requestedRole: ownDecision.requestedRole,
            decidedAt: ownDecision.decidedAt,
          },
        },
        email: { updated, committeeName: ownDecision.committee.committeeName, requestedRole: ownDecision.requestedRole, status: ownDecision.status },
      };
    });
    await this.sendCommitteeDecisionEmail(
      outcome.email.updated,
      outcome.email.committeeName,
      outcome.email.requestedRole,
      outcome.email.status,
    );
    return outcome.response;
  }

  async listLeadership(scope: 'CLUB' | 'DEVELOPER_COMMITTEES', actor: AuthenticatedUser) {
    if (!actor.memberId) throw new ForbiddenException();
    await this.assertLeadershipPermission(actor.memberId, scope);
    // Nobody decides their own request. Each approval tier sees only requests
    // filed for that tier; committee requests never fall through to group leadership.
    const notOwn = { membershipRequest: { personId: { not: actor.personId } } };
    const pending = await this.prisma.membershipRequestCommittee.findMany({
      where: { status: MembershipCommitteeDecision.PENDING, approvalScope: scope, ...notOwn },
      orderBy: { membershipRequest: { createdAt: 'asc' } },
      include: { membershipRequest: { include: requestInclude }, committee: { select: { committeeCode: true, committeeName: true } } },
    });
    const rows = pending.filter((row) => row.approvalScope === scope);
    const globalRoleRows = scope === 'CLUB'
      ? await this.prisma.membershipRequestGlobalRole.findMany({
          where: { status: MembershipCommitteeDecision.PENDING, ...notOwn },
          orderBy: { membershipRequest: { createdAt: 'asc' } },
          include: { membershipRequest: { include: requestInclude }, role: { select: { roleCode: true, description: true } } },
        })
      : [];
    return [
      ...rows.map((row) => ({ type: 'COMMITTEE_LEADERSHIP', ...this.serialize(row.membershipRequest), committee: row.committee, requestedRole: row.requestedRole, decisionStatus: row.status })),
      ...globalRoleRows.map((row) => ({ type: 'GLOBAL_ROLE', ...this.serialize(row.membershipRequest), role: row.role, decisionStatus: row.status })),
    ].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  }

  async decideLeadershipCommittee(requestId: number, committeeCode: string, decision: DecideMembershipRequestDto['decision'], actor: AuthenticatedUser) {
    if (!actor.memberId) throw new ForbiddenException();
    const committee = await this.prisma.committee.findUnique({ where: { committeeCode }, select: { committeeId: true } });
    if (!committee) throw new NotFoundException('Committee not found.');
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT membership_request_id FROM membership_request WHERE membership_request_id = ${requestId} FOR UPDATE`;
      const row = await tx.membershipRequestCommittee.findUnique({
        where: { membershipRequestId_committeeId: { membershipRequestId: requestId, committeeId: committee.committeeId } },
        include: {
          membershipRequest: { select: { personId: true } },
          committee: { select: { committeeName: true } },
        },
      });
      if (!row) throw new NotFoundException('Leadership request not found.');
      // Requests stay with the approval tier selected when they were submitted.
      if (row.approvalScope !== 'CLUB' && row.approvalScope !== 'DEVELOPER_COMMITTEES') {
        throw new NotFoundException('Leadership request not found.');
      }
      const scope = row.approvalScope;
      await this.assertLeadershipPermission(actor.memberId!, scope);
      if (row.membershipRequest.personId === actor.personId) throw new ForbiddenException('You cannot approve your own request.');
      if (row.status !== MembershipCommitteeDecision.PENDING) throw new ConflictException('This request has already been decided.');
      if (decision === MembershipCommitteeDecision.APPROVED) {
        const member = await this.getOrCreateActiveMember(tx, row.membershipRequest.personId);
        // A committee-level request that moved up still only grants membership.
        const role = row.requestedRole;
        await tx.memberCommittee.upsert({
          where: { memberId_committeeId: { memberId: member.memberId, committeeId: committee.committeeId } },
          create: { memberId: member.memberId, committeeId: committee.committeeId, role },
          update: { role },
        });
      }
      await tx.membershipRequestCommittee.update({ where: { membershipRequestCommitteeId: row.membershipRequestCommitteeId }, data: { status: decision, decidedByMemberId: actor.memberId, decidedAt: new Date() } });
      await this.refreshAggregateStatus(tx, requestId);
      const updated = await tx.membershipRequest.findUniqueOrThrow({ where: { membershipRequestId: requestId }, include: requestInclude });
      return {
        response: { id: row.membershipRequestId, committeeCode, decision },
        email: { request: updated, committeeName: row.committee?.committeeName ?? committeeCode, requestedRole: row.requestedRole },
      };
    });
    await this.sendCommitteeDecisionEmail(
      outcome.email.request,
      outcome.email.committeeName,
      outcome.email.requestedRole,
      decision,
    );
    return outcome.response;
  }

  async decideGlobalRole(requestId: number, roleCode: string, decision: DecideMembershipRequestDto['decision'], actor: AuthenticatedUser) {
    if (!actor.memberId) throw new ForbiddenException();
    await this.assertLeadershipPermission(actor.memberId, 'CLUB');
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT membership_request_id FROM membership_request WHERE membership_request_id = ${requestId} FOR UPDATE`;
      const row = await tx.membershipRequestGlobalRole.findUnique({
        where: { membershipRequestId_roleCode: { membershipRequestId: requestId, roleCode } },
        include: {
          membershipRequest: { select: { personId: true } },
          role: { select: { description: true } },
        },
      });
      if (!row) throw new NotFoundException('Leadership request not found.');
      if (row.membershipRequest.personId === actor.personId) throw new ForbiddenException('You cannot approve your own request.');
      if (row.status !== MembershipCommitteeDecision.PENDING) throw new ConflictException('This request has already been decided.');
      if (decision === MembershipCommitteeDecision.APPROVED) {
        const member = await this.getOrCreateActiveMember(tx, row.membershipRequest.personId);
        const existing = await tx.memberRole.findFirst({ where: { memberId: member.memberId, roleCode, endsOn: null } });
        if (!existing) await tx.memberRole.create({ data: { memberId: member.memberId, roleCode, assignedBy: actor.memberId } });
      }
      await tx.membershipRequestGlobalRole.update({ where: { membershipRequestGlobalRoleId: row.membershipRequestGlobalRoleId }, data: { status: decision, decidedByMemberId: actor.memberId, decidedAt: new Date() } });
      await this.refreshAggregateStatus(tx, requestId);
      const updated = await tx.membershipRequest.findUniqueOrThrow({ where: { membershipRequestId: requestId }, include: requestInclude });
      const roleName = row.role?.description ?? row.roleCode;
      return {
        response: { id: row.membershipRequestId, roleCode, decision },
        email: { request: updated, roleName },
      };
    });
    await this.sendGlobalRoleDecisionEmail(outcome.email.request, outcome.email.roleName, decision);
    return outcome.response;
  }

  private async assertCanDecide(memberId: number, committeeCode: string) {
    if (!(await this.access.hasCommitteePermission(memberId, APPLICATIONS_DECIDE, committeeCode))) {
      throw new ForbiddenException();
    }
  }

  private async getOrCreateActiveMember(tx: Prisma.TransactionClient, personId: number) {
    const member = await tx.member.findUnique({ where: { personId } })
      ?? await tx.member.create({ data: { personId } });
    if (!member.isActive) {
      throw new ConflictException('The member account must be reactivated before approval.');
    }
    return member;
  }

  private async assertLeadershipPermission(memberId: number, scope: 'CLUB' | 'DEVELOPER_COMMITTEES') {
    const permission = scope === 'CLUB' ? 'applications.club_leaders.decide' : DEVELOPER_LEADERS_DECIDE;
    if (!(await this.access.hasGlobalPermission(memberId, permission))) throw new ForbiddenException();
  }

  private async refreshAggregateStatus(tx: Prisma.TransactionClient, requestId: number) {
    const [committees, roles] = await Promise.all([
      tx.membershipRequestCommittee.findMany({ where: { membershipRequestId: requestId }, select: { status: true } }),
      tx.membershipRequestGlobalRole.findMany({ where: { membershipRequestId: requestId }, select: { status: true } }),
    ]);
    const decisions = [...committees, ...roles];
    const status = decisions.some((item) => item.status === MembershipCommitteeDecision.PENDING)
      ? MembershipRequestStatus.PENDING
      : decisions.some((item) => item.status === MembershipCommitteeDecision.APPROVED)
        ? MembershipRequestStatus.APPROVED : MembershipRequestStatus.REJECTED;
    await tx.membershipRequest.update({ where: { membershipRequestId: requestId }, data: { status } });
  }

  private async sendCommitteeDecisionEmail(
    request: {
      person?: { fullName?: string; emailPersonal?: string | null; emailUniversity?: string | null };
    },
    committeeName: string,
    requestedRole: string,
    decision: MembershipCommitteeDecision,
  ) {
    const person = request.person;
    if (!this.emails || !person) return;
    const to = person.emailPersonal ?? person.emailUniversity ?? null;
    if (!to) return;
    try {
      await this.emails.sendDecisionEmail({
        to,
        recipientName: person.fullName ?? 'Applicant',
        decision: decision === MembershipCommitteeDecision.APPROVED ? 'APPROVED' : 'REJECTED',
        committeeName,
        roleName: requestedRole,
      });
    } catch (error) {
      this.logger.error({
        event: 'membership_decision_email_failed',
        decision,
        targetName: committeeName,
        error: error instanceof Error ? error.message : 'Unknown email delivery error',
      });
    }
  }

  private async sendGlobalRoleDecisionEmail(
    request: {
      person?: { fullName?: string; emailPersonal?: string | null; emailUniversity?: string | null };
    },
    roleName: string,
    decision: MembershipCommitteeDecision,
  ) {
    const person = request.person;
    if (!this.emails || !person) return;
    const to = person.emailPersonal ?? person.emailUniversity ?? null;
    if (!to) return;
    try {
      await this.emails.sendDecisionEmail({
        to,
        recipientName: person.fullName ?? 'Applicant',
        decision: decision === MembershipCommitteeDecision.APPROVED ? 'APPROVED' : 'REJECTED',
        globalRoleName: roleName,
        roleName,
      });
    } catch (error) {
      this.logger.error({
        event: 'membership_decision_email_failed',
        decision,
        targetName: roleName,
        error: error instanceof Error ? error.message : 'Unknown email delivery error',
      });
    }
  }

  private serialize(request: {
    membershipRequestId: number;
    personId: number;
    status: MembershipRequestStatus;
    applicationData: unknown;
    createdAt: Date;
    person: { fullName: string; emailPersonal: string | null; emailUniversity: string | null };
    committees: Array<{
      status: MembershipCommitteeDecision;
      requestedRole: string;
      decidedAt: Date | null;
      committee: { committeeCode: string; committeeName: string };
    }>;
  }) {
    return {
      id: request.membershipRequestId,
      status: request.status,
      submittedAt: request.createdAt,
      applicant: {
        fullName: request.person.fullName,
        email: request.person.emailPersonal ?? request.person.emailUniversity,
        universityEmail: request.person.emailUniversity,
        details: request.applicationData,
      },
      committees: request.committees.map((item) => ({
        code: item.committee.committeeCode,
        name: item.committee.committeeName,
        status: item.status,
        requestedRole: item.requestedRole,
        decidedAt: item.decidedAt,
      })),
    };
  }
}
