import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MembershipCommitteeDecision as Decision } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { MembershipRequestService } from './membership-request.service.js';

const findUniqueCommittee = vi.fn();
const hasCommitteePermission = vi.fn();
const hasGlobalPermission = vi.fn();
const tx: Record<string, any> = {};
const prisma = {
  committee: { findUnique: findUniqueCommittee },
  $transaction: vi.fn((callback: (arg: typeof tx) => unknown) => callback(tx)),
} as unknown as PrismaService;
const access = { hasCommitteePermission, hasGlobalPermission } as unknown as CommitteeAccessService;
const emailService = { sendDecisionEmail: vi.fn().mockResolvedValue(undefined) };
const service = new MembershipRequestService(prisma, access, emailService as any);
const actor = { personId: 8, memberId: 17 };

beforeEach(() => {
  vi.clearAllMocks();
  hasCommitteePermission.mockResolvedValue(true);
  hasGlobalPermission.mockResolvedValue(true);
  emailService.sendDecisionEmail.mockResolvedValue(undefined);
  findUniqueCommittee.mockResolvedValue({ committeeId: 3 });
  tx.$queryRaw = vi.fn().mockResolvedValue([{ membership_request_id: 40 }]);
  tx.membershipRequestCommittee = {
    findFirst: vi.fn().mockResolvedValue({
      membershipRequestCommitteeId: 400,
      membershipRequestId: 40,
      committeeId: 3,
      status: Decision.PENDING,
      requestedRole: 'Member',
      approvalScope: 'COMMITTEE',
    }),
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([
      { status: Decision.APPROVED },
      { status: Decision.PENDING },
    ]),
  };
  tx.membershipRequest = {
    findUniqueOrThrow: vi.fn()
      .mockResolvedValueOnce({ personId: 61 })
      .mockResolvedValueOnce({
        membershipRequestId: 40,
        personId: 61,
        status: 'PENDING',
        applicationData: { university: 'Example University' },
        createdAt: new Date('2026-10-24T00:00:00Z'),
        person: { fullName: 'Noura', emailPersonal: 'noura@example.test', emailUniversity: null },
        committees: [
          { committeeId: 3, status: Decision.APPROVED, requestedRole: 'Leader', decidedAt: new Date(), committee: { committeeCode: 'DATA', committeeName: 'Data' } },
          { committeeId: 4, status: Decision.PENDING, requestedRole: 'Member', decidedAt: null, committee: { committeeCode: 'PR', committeeName: 'Public Relations' } },
        ],
      }),
    update: vi.fn().mockResolvedValue({}),
  };
  tx.membershipRequestGlobalRole = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  };
  tx.member = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ memberId: 99, isActive: true }),
  };
  // By default every committee has its own leader and there is another
  // developer-committees leader, so requests stay where they were filed.
  tx.memberCommittee = {
    upsert: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([{ committeeId: 3, member: { personId: 50 } }]),
  };
  tx.memberRole = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([{ member: { personId: 51 } }]),
  };
});

function leadershipRow(overrides: Record<string, unknown>) {
  return {
    membershipRequestCommitteeId: 400,
    membershipRequestId: 40,
    committeeId: 3,
    status: Decision.PENDING,
    membershipRequest: { personId: 61 },
    ...overrides,
  };
}

describe('MembershipRequestService.decide', () => {
  it('changes only the selected committee, grants Member role, and keeps aggregate pending', async () => {
    const result = await service.decide(40, 'DATA', 'APPROVED', actor);

    expect(hasCommitteePermission).toHaveBeenCalledWith(17, 'applications.decide', 'DATA');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.memberCommittee.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId_committeeId: { memberId: 99, committeeId: 3 } },
      create: { memberId: 99, committeeId: 3, role: 'Member' },
      update: {},
    }));
    expect(tx.membershipRequestCommittee.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { membershipRequestCommitteeId: 400 },
      data: expect.objectContaining({ status: 'APPROVED', decidedByMemberId: 17 }),
    }));
    expect(tx.membershipRequest.update).toHaveBeenCalledWith({
      where: { membershipRequestId: 40 },
      data: { status: 'PENDING' },
    });
    expect(emailService.sendDecisionEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'noura@example.test',
      decision: 'APPROVED',
      committeeName: 'Data',
      roleName: 'Leader',
    }));
    expect(result).toMatchObject({
      status: 'PENDING',
      committeeDecision: { committeeCode: 'DATA', status: 'APPROVED' },
      committees: [
        { code: 'DATA', status: 'APPROVED' },
        { code: 'PR', status: 'PENDING' },
      ],
    });
  });

  it('returns 403 before reading a request if the actor cannot decide for that committee', async () => {
    hasCommitteePermission.mockResolvedValue(false);

    await expect(service.decide(40, 'PR', 'REJECTED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate decision with 409 and leaves the decision unchanged', async () => {
    tx.membershipRequestCommittee.findFirst.mockResolvedValueOnce({
      membershipRequestCommitteeId: 400,
      status: Decision.REJECTED,
      requestedRole: 'Member',
      approvalScope: 'COMMITTEE',
    });

    await expect(service.decide(40, 'DATA', 'APPROVED', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.membershipRequestCommittee.update).not.toHaveBeenCalled();
  });

  it('does not let committee review decide a leadership application', async () => {
    tx.membershipRequestCommittee.findFirst.mockResolvedValueOnce({
      membershipRequestCommitteeId: 400,
      approvalScope: 'DEVELOPER_COMMITTEES',
      status: Decision.PENDING,
      requestedRole: 'Leader',
    });
    await expect(service.decide(40, 'DATA', 'APPROVED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.memberCommittee.upsert).not.toHaveBeenCalled();
  });

  it('prevents a request owner from approving their own leadership position', async () => {
    tx.membershipRequestCommittee.findUnique.mockResolvedValue({
      membershipRequestCommitteeId: 400,
      membershipRequestId: 40,
      approvalScope: 'DEVELOPER_COMMITTEES',
      status: Decision.PENDING,
      requestedRole: 'Leader',
      membershipRequest: { personId: actor.personId },
    });
    await expect(service.decideLeadershipCommittee(40, 'DATA', 'APPROVED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.developer_leaders.decide');
    expect(tx.memberCommittee.upsert).not.toHaveBeenCalled();
  });

  it('grants an individual committee leader role only after the developer-tier approval', async () => {
    tx.membershipRequestCommittee.findUnique.mockResolvedValue({
      membershipRequestCommitteeId: 400,
      membershipRequestId: 40,
      committeeId: 3,
      approvalScope: 'DEVELOPER_COMMITTEES',
      status: Decision.PENDING,
      requestedRole: 'Leader',
      membershipRequest: { personId: 61 },
    });
    await service.decideLeadershipCommittee(40, 'DATA', 'APPROVED', actor);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.developer_leaders.decide');
    expect(tx.memberCommittee.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { memberId: 99, committeeId: 3, role: 'Leader' },
      update: { role: 'Leader' },
    }));
  });

  it('assigns a requested global role only after club-leadership approval', async () => {
    tx.membershipRequestGlobalRole.findUnique.mockResolvedValue({
      membershipRequestGlobalRoleId: 700,
      membershipRequestId: 40,
      roleCode: 'ADVISOR',
      status: Decision.PENDING,
      membershipRequest: { personId: 61 },
    });
    await service.decideGlobalRole(40, 'ADVISOR', 'APPROVED', actor);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.club_leaders.decide');
    expect(tx.memberRole.create).toHaveBeenCalledWith({ data: { memberId: 99, roleCode: 'ADVISOR', assignedBy: actor.memberId } });
    expect(tx.membershipRequestGlobalRole.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', decidedByMemberId: actor.memberId }) }));
  });

  it('does not let developer leaders approve a club-only global role', async () => {
    hasGlobalPermission.mockResolvedValue(false);
    await expect(service.decideGlobalRole(40, 'DEVELOPER_COMMITTEES_LEADER', 'APPROVED', actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.club_leaders.decide');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents duplicate processing of a global role approval', async () => {
    tx.membershipRequestGlobalRole.findUnique.mockResolvedValue({
      membershipRequestGlobalRoleId: 701,
      membershipRequestId: 40,
      roleCode: 'ADVISOR',
      status: Decision.APPROVED,
      membershipRequest: { personId: 61 },
    });
    await expect(service.decideGlobalRole(40, 'ADVISOR', 'APPROVED', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.memberRole.create).not.toHaveBeenCalled();
    expect(tx.membershipRequestGlobalRole.update).not.toHaveBeenCalled();
  });
});

describe('MembershipRequestService approval routing', () => {
  it('keeps a developer leader request with developer leadership when the applicant is the only developer-committees leader', async () => {
    tx.memberRole.findMany.mockResolvedValue([{ member: { personId: 61 } }]);
    tx.membershipRequestCommittee.findUnique.mockResolvedValue(leadershipRow({ approvalScope: 'DEVELOPER_COMMITTEES', requestedRole: 'Co-Leader' }));
    await service.decideLeadershipCommittee(40, 'DATA', 'APPROVED', actor);
    expect(hasGlobalPermission).toHaveBeenCalledWith(actor.memberId, 'applications.developer_leaders.decide');
    expect(tx.memberCommittee.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { memberId: 99, committeeId: 3, role: 'Co-Leader' } }));
  });

  it('keeps a member request out of club leadership even when its committee has no leader', async () => {
    tx.memberCommittee.findMany.mockResolvedValue([]);
    tx.membershipRequestCommittee.findUnique.mockResolvedValue(leadershipRow({ approvalScope: 'COMMITTEE', requestedRole: 'Member' }));
    await expect(service.decideLeadershipCommittee(40, 'DMD', 'APPROVED', actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.memberCommittee.upsert).not.toHaveBeenCalled();
  });

  it('keeps a member request with its committee while the committee has a leader', async () => {
    tx.membershipRequestCommittee.findUnique.mockResolvedValue(leadershipRow({ approvalScope: 'COMMITTEE', requestedRole: 'Member' }));
    await expect(service.decideLeadershipCommittee(40, 'DATA', 'APPROVED', actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.memberCommittee.upsert).not.toHaveBeenCalled();
  });

  it('lists only club-tier requests for club leadership and never the reviewer’s own request', async () => {
    const request = (personId: number) => ({
      membershipRequestId: personId,
      personId,
      status: 'PENDING',
      applicationData: {},
      createdAt: new Date('2026-10-27T00:00:00Z'),
      person: { fullName: 'Applicant', emailPersonal: 'applicant@example.test', emailUniversity: null },
      committees: [],
      globalRoles: [],
    });
    const committee = { committeeCode: 'DMD', committeeName: 'Digital Media and Design' };
    const findMany = vi.fn().mockResolvedValue([
      { committeeId: 3, approvalScope: 'COMMITTEE', requestedRole: 'Member', status: Decision.PENDING, committee, membershipRequest: request(61) },
      { committeeId: 9, approvalScope: 'CLUB', requestedRole: 'Co-Leader', status: Decision.PENDING, committee, membershipRequest: request(62) },
    ]);
    const listing = new MembershipRequestService({
      ...prisma,
      membershipRequestCommittee: { findMany },
      membershipRequestGlobalRole: { findMany: vi.fn().mockResolvedValue([]) },
      memberCommittee: tx.memberCommittee,
      memberRole: tx.memberRole,
    } as unknown as PrismaService, access, emailService as any);

    const result = await listing.listLeadership('CLUB', actor);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ approvalScope: 'CLUB', membershipRequest: { personId: { not: actor.personId } } }),
    }));
    // The committee member request is never escalated into the club leadership queue.
    expect(result.map((item) => item.id)).toEqual([62]);
  });
});
