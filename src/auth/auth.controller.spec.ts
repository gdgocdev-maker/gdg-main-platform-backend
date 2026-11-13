import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthController } from './auth.controller.js';
import type { RequestUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { BetterAuthService } from './better-auth.service.js';
const findUniqueOrThrow = vi.fn();
const better = { session: vi.fn() } as unknown as BetterAuthService;
const controller = new AuthController(new AuthService({ person: { findUniqueOrThrow } } as unknown as PrismaService, better), better);
const NOURA = {
  fullName: 'Noura Demo',
  emailPersonal: 'noura@example.test',
  emailUniversity: 'noura@university.example',
  phoneNumber: '+966500000000',
  university: 'University of Jeddah',
  branch: 'Main Campus',
  major: 'Software Engineering',
  gender: 'female',
  bio: null,
  githubUrl: null,
  portfolioUrl: null,
  xUrl: null,
  profileImageUrl: null,
  membershipRequest: {
    status: 'APPROVED',
    applicationData: { college: 'College of Computer Science', level: 'Third Year' },
  },
  member: {
    membershipNumber: 100001,
    joinDate: new Date('2025-09-01T00:00:00.000Z'),
    committees: [
      {
        role: 'Leader',
        committee: { committeeCode: 'DATA', committeeName: 'Data' },
      },
    ],
    roleAssignments: [{ roleCode: 'ADVISOR' }],
  },
};

function meAs(user?: RequestUser) {
  return controller.me({ user });
}

beforeEach(() => {
  findUniqueOrThrow.mockReset().mockResolvedValue(NOURA);
});

describe('GET /me', () => {
  it('rejects visitors who are not logged in', async () => {
    await expect(meAs()).rejects.toThrow(UnauthorizedException);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('returns a member with their committees and current roles', async () => {
    const response = await meAs({
      personId: 6,
      memberId: 10000005,
      email: 'noura@example.test',
    });

    expect(findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { personId: 6 } }),
    );
    expect(response).toEqual({
      success: true,
      message: 'OK',
      error: null,
      data: {
        personId: 6,
        memberId: 10000005,
        membershipNumber: 100001,
        fullName: 'Noura Demo',
        email: 'noura@example.test',
        universityEmail: 'noura@university.example',
        phoneNumber: '+966500000000',
        university: 'University of Jeddah',
        branch: 'Main Campus',
        college: 'College of Computer Science',
        major: 'Software Engineering',
        level: 'Third Year',
        gender: 'female',
        bio: null,
        socialLinks: { github: null, portfolio: null, x: null },
        profileImageUrl: null,
        joinDate: new Date('2025-09-01T00:00:00.000Z'),
        committees: [{ code: 'DATA', name: 'Data', position: 'Leader' }],
        roles: ['ADVISOR'],
        membershipRequestPending: false,
      },
    });
  });

  it('returns no committees or roles for someone who is not a member', async () => {
    findUniqueOrThrow.mockResolvedValue({
      ...NOURA,
      fullName: 'Visitor',
      emailPersonal: null,
      emailUniversity: null,
      phoneNumber: null,
      university: null,
      branch: null,
      major: null,
      gender: null,
      bio: null,
      profileImageUrl: null,
      member: null,
      membershipRequest: null,
      nonMemberRegistration: null,
    });

    const response = await meAs({ personId: 11, memberId: null });

    expect(response.data).toEqual({
      personId: 11,
      memberId: null,
      membershipNumber: null,
      fullName: 'Visitor',
      email: null,
      universityEmail: null,
      phoneNumber: null,
      university: null,
      branch: null,
      college: null,
      major: null,
      level: null,
      gender: null,
      bio: null,
      socialLinks: { github: null, portfolio: null, x: null },
      profileImageUrl: null,
      joinDate: null,
      committees: [],
      roles: [],
      membershipRequestPending: false,
    });
  });

  it('tells an applicant apart from a non-member while their membership request waits', async () => {
    findUniqueOrThrow.mockResolvedValue({ fullName: 'Applicant', member: null, membershipRequest: { status: 'PENDING' } });

    const response = await meAs({ personId: 12, memberId: null });

    expect(response.data).toMatchObject({ memberId: null, membershipRequestPending: true });
  });

  it('hides committees and roles of an inactive member', async () => {
    const response = await meAs({ personId: 6, memberId: null });

    expect(response.data).toMatchObject({ committees: [], roles: [] });
  });
});
