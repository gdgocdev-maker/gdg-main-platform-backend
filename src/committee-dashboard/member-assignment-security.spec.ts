import { ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CommitteeAccessService } from '../registrations/committee-access.service.js';
import { CommitteeDashboardService } from './committee-dashboard.service.js';

const account = {
  personId: 50,
  fullName: 'Existing Account',
  emailPersonal: 'existing@example.test',
  authUserId: 'auth-user-50',
  isActive: true,
};

function makeService() {
  const hasGlobalPermission = vi.fn().mockResolvedValue(true);
  const hasCommitteePermission = vi.fn().mockResolvedValue(true);
  const transaction = {
    person: { findFirst: vi.fn().mockResolvedValue({ ...account, member: null }) },
    member: { create: vi.fn().mockResolvedValue({ memberId: 70, personId: account.personId, isActive: true }) },
    committee: { findFirst: vi.fn(), findUnique: vi.fn() },
    memberCommittee: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ role: 'Member' }),
    },
    memberRole: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    committee: { findUnique: vi.fn(), findFirst: vi.fn() },
    memberCommittee: { findUnique: vi.fn() },
  };
  const service = new CommitteeDashboardService(
    prisma as unknown as PrismaService,
    { hasGlobalPermission, hasCommitteePermission } as unknown as CommitteeAccessService,
  );
  return { service, prisma, transaction, hasGlobalPermission, hasCommitteePermission };
}

describe('committee-specific member assignment security', () => {
  const user = { personId: 10, memberId: 20 };

  it('adds only the Member role to the caller’s own permitted committee', async () => {
    const { service, prisma, transaction, hasCommitteePermission } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 6, committeeCode: 'DATA' });
    prisma.memberCommittee.findUnique.mockResolvedValue({
      memberId: 20,
      role: 'Leader',
      member: { isActive: true, person: { isActive: true } },
    });

    await service.addMember(user, 'DATA', { email: account.emailPersonal!, role: 'Leader' } as any);

    expect(hasCommitteePermission).toHaveBeenCalledWith(20, 'members.manage', undefined, 6);
    expect(transaction.memberCommittee.create).toHaveBeenCalledWith({
      data: { memberId: 70, committeeId: 6, role: 'Member' },
    });
  });

  it('rejects a duplicate active membership instead of changing it', async () => {
    const { service, prisma, transaction } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 6, committeeCode: 'DATA' });
    prisma.memberCommittee.findUnique.mockResolvedValue({
      memberId: 20, role: 'Co-Leader', member: { isActive: true, person: { isActive: true } },
    });
    transaction.memberCommittee.findUnique.mockResolvedValue({ role: 'Member' });

    await expect(service.addMember(user, 'DATA', { email: account.emailPersonal! })).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.memberCommittee.create).not.toHaveBeenCalled();
  });
  it('rejects a request targeting a committee the caller does not belong to', async () => {
    const { service, prisma, transaction } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 8, committeeCode: 'PR' });
    prisma.memberCommittee.findUnique.mockResolvedValue(null);

    await expect(service.addMember(user, 'PR', { email: account.emailPersonal! })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.memberCommittee.create).not.toHaveBeenCalled();
  });

  it('rejects non-leaders and committees outside the approved list', async () => {
    const { service, prisma, hasCommitteePermission, transaction } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 6, committeeCode: 'DATA' });
    prisma.memberCommittee.findUnique.mockResolvedValue({
      memberId: 20, role: 'Member', member: { isActive: true, person: { isActive: true } },
    });
    hasCommitteePermission.mockResolvedValue(false);

    await expect(service.addMember(user, 'DATA', { email: account.emailPersonal! })).rejects.toBeInstanceOf(ForbiddenException);
    hasCommitteePermission.mockResolvedValue(true);
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 99, committeeCode: 'DEV' });
    prisma.memberCommittee.findUnique.mockResolvedValue({
      memberId: 20, role: 'Leader', member: { isActive: true, person: { isActive: true } },
    });
    await expect(service.addMember(user, 'DEV', { email: account.emailPersonal! })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction.memberCommittee.create).not.toHaveBeenCalled();
  });

  it('rejects an unregistered email and promotes a registered non-member account only after lookup', async () => {
    const { service, prisma, transaction } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 6, committeeCode: 'DATA' });
    prisma.memberCommittee.findUnique.mockResolvedValue({
      memberId: 20, role: 'Leader', member: { isActive: true, person: { isActive: true } },
    });
    transaction.person.findFirst.mockResolvedValueOnce(null);

    await expect(service.addMember(user, 'DATA', { email: 'unknown@example.test' })).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.member.create).not.toHaveBeenCalled();

    transaction.person.findFirst.mockResolvedValueOnce({ ...account, member: null });
    await service.addMember(user, 'DATA', { email: account.emailPersonal! });
    expect(transaction.member.create).toHaveBeenCalledWith({ data: { personId: account.personId } });
  });
});

describe('developer committee assignment role grants', () => {
  it('grants the six-committee assignment permission only to the overall Developer Committees Leader', () => {
    const migration = readFileSync(new URL('../../prisma/migrations/20261104120000_developer_committee_member_assignment/migration.sql', import.meta.url), 'utf8');
    expect(migration).toContain("('DEVELOPER_COMMITTEES_LEADER', 'developer_committees.members.assign')");
    expect(migration).not.toContain('DEVELOPER_COMMITTEES_CO_LEADER');
  });
});
describe('developer-wide member assignment security', () => {
  const user = { personId: 10, memberId: 20 };

  it('requires the overall leader assignment permission and limits assignments to DEV children', async () => {
    const { service, prisma, hasGlobalPermission, transaction } = makeService();
    hasGlobalPermission.mockResolvedValue(false);
    await expect(service.assignDeveloperCommitteeMember(user, {
      email: account.emailPersonal!, committeeCode: 'DATA', role: 'Leader',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(20, 'developer_committees.members.assign');
    expect(prisma.committee.findUnique).not.toHaveBeenCalled();

    hasGlobalPermission.mockResolvedValue(true);
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 6, committeeCode: 'DATA', parent: { committeeCode: 'DEV' } });
    transaction.memberCommittee.create.mockResolvedValue({ role: 'Leader' });
    await service.assignDeveloperCommitteeMember(user, {
      email: account.emailPersonal!, committeeCode: 'DATA', role: 'Leader',
    });
    expect(transaction.memberCommittee.create).toHaveBeenCalledWith({ data: { memberId: 70, committeeId: 6, role: 'Leader' } });

    prisma.committee.findUnique.mockResolvedValue({ committeeId: 1, committeeCode: 'PR', parent: { committeeCode: 'CLUB' } });
    await expect(service.assignDeveloperCommitteeMember(user, {
      email: account.emailPersonal!, committeeCode: 'PR', role: 'Co-Leader',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unregistered email and reports duplicate active assignments as conflicts', async () => {
    const { service, prisma, transaction } = makeService();
    prisma.committee.findUnique.mockResolvedValue({ committeeId: 6, committeeCode: 'DATA', parent: { committeeCode: 'DEV' } });
    transaction.person.findFirst.mockResolvedValue(null);
    await expect(service.assignDeveloperCommitteeMember(user, {
      email: 'unknown@example.test', committeeCode: 'DATA', role: 'Member',
    })).rejects.toBeInstanceOf(NotFoundException);

    transaction.person.findFirst.mockResolvedValue({ ...account, member: { memberId: 70, isActive: true } });
    transaction.memberCommittee.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: 'test',
    }));
    await expect(service.assignDeveloperCommitteeMember(user, {
      email: account.emailPersonal!, committeeCode: 'DATA', role: 'Member',
    })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('group-wide assignment security', () => {
  const user = { personId: 10, memberId: 20 };

  it('requires global group member management permission', async () => {
    const { service, hasGlobalPermission, transaction } = makeService();
    hasGlobalPermission.mockResolvedValue(false);
    await expect(service.assignClubPerson(user, {
      email: account.emailPersonal!, committeeCode: 'PR', role: 'Leader',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(hasGlobalPermission).toHaveBeenCalledWith(20, 'members.manage');
    expect(transaction.person.findFirst).not.toHaveBeenCalled();
  });

  it.each(['Member', 'Leader', 'Co-Leader'] as const)('assigns the selected %s role to an existing account in a leaf committee', async (role) => {
    const { service, transaction } = makeService();
    transaction.committee.findFirst.mockResolvedValue({
      committeeId: 2, committeeCode: 'PR', committeeName: 'Public Relations',
    });
    transaction.memberCommittee.create.mockResolvedValue({ role });

    await service.assignClubPerson(user, {
      email: account.emailPersonal!, committeeCode: 'PR', role,
    });

    expect(transaction.memberCommittee.create).toHaveBeenCalledWith({
      data: { memberId: 70, committeeId: 2, role },
    });
  });

  it('does not assign committee roles to parent committees and prevents duplicate memberships', async () => {
    const { service, transaction } = makeService();
    transaction.committee.findFirst.mockResolvedValue(null);
    await expect(service.assignClubPerson(user, {
      email: account.emailPersonal!, committeeCode: 'DEV', role: 'Leader',
    })).rejects.toBeInstanceOf(NotFoundException);

    transaction.committee.findFirst.mockResolvedValue({
      committeeId: 2, committeeCode: 'PR', committeeName: 'Public Relations',
    });
    transaction.memberCommittee.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002', clientVersion: 'test',
    }));
    await expect(service.assignClubPerson(user, {
      email: account.emailPersonal!, committeeCode: 'PR', role: 'Member',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['ADVISOR', 'DEVELOPER_COMMITTEES_LEADER'] as const)('assigns the %s role globally without a committee', async (role) => {
    const { service, transaction } = makeService();
    await service.assignClubPerson(user, { email: account.emailPersonal!, role });
    expect(transaction.memberRole.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ memberId: 70, roleCode: role, assignedBy: user.memberId }],
      skipDuplicates: true,
    }));
  });

  it('rejects an unregistered email for group-wide assignment', async () => {
    const { service, transaction } = makeService();
    transaction.person.findFirst.mockResolvedValue(null);
    await expect(service.assignClubPerson(user, {
      email: 'unknown@example.test', committeeCode: 'PR', role: 'Member',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.memberCommittee.create).not.toHaveBeenCalled();
  });
});
