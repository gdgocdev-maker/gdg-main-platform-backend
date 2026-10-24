import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipCommitteeDecision,
  MembershipRequestStatus,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/current-user.js';
import {
  CommitteeAccessService,
} from '../registrations/committee-access.service.js';
import type {
  CreateMembershipRequestDto,
  DecideMembershipRequestDto,
} from './membership-request.dto.js';

export const APPLICATIONS_DECIDE = 'applications.decide';

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
} as const;

@Injectable()
export class MembershipRequestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommitteeAccessService) private readonly access: CommitteeAccessService,
  ) {}

  async create(user: AuthenticatedUser, body: CreateMembershipRequestDto) {
    const committeeCodes = body.committees.map(({ committeeCode }) => committeeCode);
    const committees = await this.prisma.committee.findMany({
      where: { committeeCode: { in: committeeCodes } },
      select: { committeeId: true, committeeCode: true },
    });
    if (committees.length !== new Set(committeeCodes).size) {
      throw new NotFoundException('One or more selected committees are unavailable.');
    }

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
            create: body.committees.map((item) => ({
              committeeId: committees.find((c) => c.committeeCode === item.committeeCode)!.committeeId,
              requestedRole: item.requestedRole,
            })),
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
      where: { committeeId: committee.committeeId },
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

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ membership_request_id: number }[]>`
        SELECT membership_request_id FROM membership_request
        WHERE membership_request_id = ${requestId}
        FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Membership request not found.');

      const application = await tx.membershipRequestCommittee.findFirst({
        where: { membershipRequestId: requestId, committeeId: committee.committeeId },
      });
      if (!application) throw new NotFoundException('Membership request not found.');
      if (application.status !== MembershipCommitteeDecision.PENDING) {
        throw new ConflictException('This committee has already decided this request.');
      }

      if (decision === MembershipCommitteeDecision.APPROVED) {
        const request = await tx.membershipRequest.findUniqueOrThrow({
          where: { membershipRequestId: requestId },
          select: { personId: true },
        });
        let member = await tx.member.findUnique({ where: { personId: request.personId } });
        member ??= await tx.member.create({ data: { personId: request.personId } });
        if (!member.isActive) {
          throw new ConflictException('The member account must be reactivated before approval.');
        }
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

      const decisions = await tx.membershipRequestCommittee.findMany({
        where: { membershipRequestId: requestId },
        select: { status: true },
      });
      const status = decisions.some((item) => item.status === MembershipCommitteeDecision.PENDING)
        ? MembershipRequestStatus.PENDING
        : decisions.some((item) => item.status === MembershipCommitteeDecision.APPROVED)
          ? MembershipRequestStatus.APPROVED
          : MembershipRequestStatus.REJECTED;
      await tx.membershipRequest.update({
        where: { membershipRequestId: requestId },
        data: { status },
      });

      const updated = await tx.membershipRequest.findUniqueOrThrow({
        where: { membershipRequestId: requestId },
        include: requestInclude,
      });
      const ownDecision = updated.committees.find((row) => row.committeeId === committee.committeeId)!;
      return {
        ...this.serialize(updated),
        committeeDecision: {
          committeeCode,
          status: ownDecision.status,
          requestedRole: ownDecision.requestedRole,
          decidedAt: ownDecision.decidedAt,
        },
      };
    });
  }

  private async assertCanDecide(memberId: number, committeeCode: string) {
    if (!(await this.access.hasCommitteePermission(memberId, APPLICATIONS_DECIDE, committeeCode))) {
      throw new ForbiddenException();
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
