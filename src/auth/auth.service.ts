import { randomUUID } from 'node:crypto';
import type { RequestSetupLinkDto } from './setup-password.dto.js';
import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BetterAuthService } from './better-auth.service.js';
import { approvalScopeFor, findApplicableCommittees } from '../committees/committee-catalog.js';
import type { RequestUser } from './auth.guard.js';
import type { SignupDto } from './signup.dto.js';
import type { CheckEmailDto } from './check-email.dto.js';
import type { GoogleSignupCompletionDto } from './google-auth.dto.js';
import type { UpdateSocialLinksDto } from './update-social-links.dto.js';

const UNIQUE_VIOLATION = 'P2002';

function emailAlreadyExists() {
  return new ConflictException('An account with this email already exists.', {
    errorCode: 'EMAIL_ALREADY_EXISTS',
  });
}

function committeeUnavailable() {
  return new BadRequestException('A selected committee is unavailable.', {
    errorCode: 'COMMITTEE_UNAVAILABLE',
  });
}

function normalizeBranch<T extends { branch?: string }>(applicationData: T): T {
  return typeof applicationData.branch === 'string'
    ? { ...applicationData, branch: applicationData.branch.trim() }
    : applicationData;
}

function assertExternalUniversityBranch(
  registrationType: 'MEMBER' | 'NON_MEMBER',
  university: string,
  branch?: string,
) {
  if (
    registrationType === 'MEMBER' &&
    university !== 'University of Jeddah' &&
    !branch?.trim()
  ) {
    throw new BadRequestException('Branch is required for members outside the University of Jeddah.', {
      errorCode: 'BRANCH_REQUIRED',
    });
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BetterAuthService) private readonly better: BetterAuthService,
  ) {}

  async checkEmail({ email }: CheckEmailDto) {
    const person = await this.findPersonByEmail(email.trim().toLowerCase());
    if (!person) return { nextStep: 'SIGNUP_REQUIRED' };
    return { nextStep: person.authUserId ? 'PASSWORD_REQUIRED' : 'PASSWORD_SETUP_REQUIRED' };
  }

  async requestPasswordReset({ email, locale = 'en' }: RequestSetupLinkDto) {
    const normalized = email.trim().toLowerCase();
    const person = await this.prisma.person.findFirst({ where: { emailPersonal: { equals: normalized, mode: 'insensitive' }, isActive: true } });
    // Existing application-only people can claim their account by proving inbox ownership.
    // Creating an unverified auth row grants no session, person link, or permissions.
    if (person && !person.authUserId) {
      await this.prisma.authUser.upsert({ where: { email: normalized },
        create: { id: randomUUID(), email: normalized, name: person.fullName, emailVerified: false, locale }, update: {} });
    }
    await this.better.auth.api.requestPasswordReset({ body: { email: normalized,
      redirectTo: `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/${locale}/reset-password` } });
  }

  async signup(input: SignupDto) {
    const { fullName, email, universityEmail, password, registrationType, committees = [], requestedGlobalRoles = [], locale = 'en' } = input;
    const applicationData = normalizeBranch(input.applicationData);
    assertExternalUniversityBranch(registrationType, applicationData.university, applicationData.branch);
    const normalizedEmail = email.trim().toLowerCase();
    if (universityEmail?.trim().toLowerCase() === normalizedEmail) throw new BadRequestException('Personal and university emails must be different.', { errorCode: 'EMAILS_MUST_DIFFER' });
    if (registrationType === 'MEMBER' && !committees.length && !requestedGlobalRoles.length) throw new BadRequestException('Select at least one committee or leadership role.');
    if (!(await findApplicableCommittees(this.prisma, committees.map(item => item.committeeCode)))) throw committeeUnavailable();
    if (await this.findPersonByEmail(normalizedEmail)) throw emailAlreadyExists();
    if (await this.prisma.authUser.findUnique({ where: { email: normalizedEmail } })) throw emailAlreadyExists();
    const result = await this.better.auth.api.signUpEmail({ body: {
      email: normalizedEmail, password, name: fullName.trim(), locale,
      callbackURL: `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/${locale}/verify-email`,
    } });
    if (!result.user) throw emailAlreadyExists();
    // Only auth credentials exist before verification. Profile and requested roles remain staged.
    try {
      await this.prisma.signupVerification.create({ data: {
        authUserId: result.user.id, fullName: fullName.trim(), emailPersonal: normalizedEmail,
        emailUniversity: universityEmail?.trim().toLowerCase() ?? null, registrationType,
        applicationData: JSON.parse(JSON.stringify(applicationData)), committees: JSON.parse(JSON.stringify(committees)),
        globalRoles: JSON.parse(JSON.stringify(requestedGlobalRoles)), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } });
    } catch (error) {
      await this.prisma.authUser.delete({ where: { id: result.user.id } });
      throw error;
    }
    return { emailVerificationRequired: true };
  }

  async reconcileVerifiedIdentity(identity: { id: string; email: string; emailVerified: boolean }) {
    if (!identity.emailVerified) return;
    await this.prisma.person.updateMany({
      where: { authUserId: null, emailPersonal: { equals: identity.email, mode: 'insensitive' }, isActive: true },
      data: { authUserId: identity.id, emailPersonalVerifiedAt: new Date() },
    });
    const pending = await this.prisma.signupVerification.findUnique({ where: { authUserId: identity.id } });
    if (pending && pending.expiresAt > new Date() && !pending.verifiedAt) {
      if (pending.emailPersonal !== identity.email.toLowerCase()) throw new UnauthorizedException();
      try { await this.createVerifiedSignup(pending, new Date()); }
      catch (error) {
        // Concurrent requests may both observe the staged row. Only the winner provisions it.
        if (!(await this.prisma.person.findUnique({ where: { authUserId: identity.id } }))) throw error;
      }
    }
    const person = await this.prisma.person.findUnique({ where: { authUserId: identity.id }, select: { personId: true, emailPersonal: true, pendingSignup: true } });
    if (person && person.emailPersonal?.toLowerCase() !== identity.email.toLowerCase()) {
      // Only a verified Better Auth identity may update the application login email.
      await this.prisma.$transaction(async tx => {
        const owner = await tx.person.findFirst({ where: { emailPersonal: { equals: identity.email, mode: 'insensitive' }, personId: { not: person.personId } } });
        if (owner) throw emailAlreadyExists();
        await tx.person.update({ where: { personId: person.personId }, data: { emailPersonal: identity.email.toLowerCase(), emailPersonalVerifiedAt: new Date() } });
        await tx.personEmailIdentity.upsert({ where: { personId_kind: { personId: person.personId, kind: 'PERSONAL' } }, create: { personId: person.personId, kind: 'PERSONAL', email: identity.email.toLowerCase() }, update: { email: identity.email.toLowerCase() } });
      });
    }
    if (person?.pendingSignup) await this.finalizePendingSignup(person.personId);
  }

  async completeGoogleSignup(identity: { id: string; email: string; emailVerified: boolean }, input: GoogleSignupCompletionDto) {
    if (!identity.emailVerified) throw new UnauthorizedException();
    const email = identity.email.trim().toLowerCase();
    const verifiedAt = new Date();
    const existingByAuthId = await this.prisma.person.findUnique({
      where: { authUserId: identity.id },
      select: { personId: true, pendingSignup: true },
    });
    if (existingByAuthId) {
      if (existingByAuthId.pendingSignup) await this.finalizePendingSignup(existingByAuthId.personId);
      return { registrationPendingApproval: input.registrationType === 'MEMBER' };
    }

    const emailOwner = await this.findPersonByEmail(email);
    if (emailOwner) {
      throw new ConflictException('Sign in to your existing GDG account before connecting Google.', {
        errorCode: 'GOOGLE_ACCOUNT_LINK_REQUIRED',
      });
    }

    const universityEmail = input.applicationData.universityEmail?.trim().toLowerCase() ?? null;
    if (universityEmail === email) {
      throw new BadRequestException('Personal and university emails must be different.', {
        errorCode: 'EMAILS_MUST_DIFFER',
      });
    }

    const committees = input.committees ?? [];
    const globalRoles = input.requestedGlobalRoles ?? [];
    const applicationData = normalizeBranch(input.applicationData);
    assertExternalUniversityBranch(
      input.registrationType,
      applicationData.university,
      applicationData.branch,
    );
    if (input.registrationType === 'MEMBER' && !committees.length && !globalRoles.length) {
      throw new BadRequestException('Select at least one committee or leadership role.');
    }
    const committeeRows = await findApplicableCommittees(
      this.prisma,
      committees.map((item) => item.committeeCode),
    );
    if (!committeeRows) throw committeeUnavailable();

    try {
      const personId = await this.prisma.$transaction(async (tx) => {
        const person = await tx.person.create({
          data: {
            authUserId: identity.id,
            fullName: input.fullName.trim(),
            emailPersonal: email,
            emailPersonalVerifiedAt: verifiedAt,
            emailUniversity: universityEmail,
            emailUniversityVerifiedAt: null,
            emailIdentities: { create: [{ email, kind: 'PERSONAL' }] },
            pendingSignup: {
              create: {
                registrationType: input.registrationType,
                applicationData: JSON.parse(JSON.stringify(applicationData)),
                committees: JSON.parse(JSON.stringify(committees)),
                globalRoles: JSON.parse(JSON.stringify(globalRoles)),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            },
          },
          select: { personId: true },
        });
        return person.personId;
      });
      await this.finalizePendingSignup(personId);
    } catch (signupError) {
      if (
        signupError instanceof Prisma.PrismaClientKnownRequestError &&
        signupError.code === UNIQUE_VIOLATION
      ) throw emailAlreadyExists();
      throw signupError;
    }

    return { registrationPendingApproval: input.registrationType === 'MEMBER' };
  }

  private async createVerifiedSignup(pending: Prisma.SignupVerificationGetPayload<object>, verifiedAt: Date) {
    const personId = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.signupVerification.updateMany({
        where: { signupVerificationId: pending.signupVerificationId, verifiedAt: null, expiresAt: { gt: new Date() } },
        data: { verifiedAt },
      });
      if (!claimed.count) throw new UnauthorizedException();

      const person = await tx.person.create({
        data: {
          authUserId: pending.authUserId,
          fullName: pending.fullName,
          emailPersonal: pending.emailPersonal,
          emailUniversity: pending.emailUniversity,
          emailPersonalVerifiedAt: verifiedAt,
          emailUniversityVerifiedAt: null,
          emailIdentities: {
            create: [
              { email: pending.emailPersonal, kind: 'PERSONAL' },
            ],
          },
          pendingSignup: {
            create: {
              registrationType: pending.registrationType,
              applicationData: pending.applicationData as Prisma.InputJsonValue,
              committees: pending.committees as Prisma.InputJsonValue,
              globalRoles: pending.globalRoles as Prisma.InputJsonValue,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          },
        },
        select: { personId: true },
      });
      await tx.signupVerification.delete({ where: { signupVerificationId: pending.signupVerificationId } });
      return person.personId;
    });
    await this.finalizePendingSignup(personId);
  }

  private async finalizePendingSignup(personId: number) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT person_id FROM person WHERE person_id = ${personId} FOR UPDATE`;
      const person = await tx.person.findUnique({ where: { personId }, include: { pendingSignup: true } });
      const pending = person?.pendingSignup;
      if (!person || !person.emailPersonalVerifiedAt) throw new UnauthorizedException();
      if (!pending) return; // A concurrent request already finalized this verified profile.
      if (pending.expiresAt <= new Date()) throw new UnauthorizedException();
      const data = pending.applicationData as Record<string, unknown>;
      await tx.person.update({ where: { personId }, data: {
        phoneNumber: String(data.phoneNumber), university: String(data.university),
        branch: typeof data.branch === 'string' ? data.branch.trim() || null : null,
        major: String(data.major), gender: String(data.gender),
      } });
      if (pending.registrationType === 'NON_MEMBER') {
        await tx.nonMemberRegistration.create({ data: { personId, applicationData: pending.applicationData as Prisma.InputJsonValue } });
      } else {
        const committees = pending.committees as Array<{ committeeCode: string; requestedRole: string }>;
        const globalRoles = pending.globalRoles as string[];
        if (!committees.length && !globalRoles.length) throw new BadRequestException('Select at least one committee or leadership role.');
        const rows = await findApplicableCommittees(tx, committees.map((item) => item.committeeCode));
        if (!rows) throw committeeUnavailable();
        await tx.membershipRequest.create({ data: {
          personId, applicationData: pending.applicationData as Prisma.InputJsonValue,
          committees: { create: committees.map((selection) => {
            const committee = rows.find((row) => row.committeeCode === selection.committeeCode)!;
            return {
              committeeId: committee.committeeId,
              requestedRole: selection.requestedRole,
              approvalScope: approvalScopeFor(committee, selection.requestedRole),
            };
          }) },
          globalRoles: { create: globalRoles.map((roleCode) => ({ roleCode })) },
        } });
      }
      await tx.pendingSignup.delete({ where: { personId } });
    });
  }

  async updateBio(user: RequestUser, bio: string) {
    const person = await this.prisma.person.update({
      where: { personId: user.personId },
      data: { bio: bio.trim() || null },
      select: { bio: true },
    });
    return { bio: person.bio };
  }

  async updateSocialLinks(user: RequestUser, links: UpdateSocialLinksDto) {
    const data = {
      ...(links.githubUrl !== undefined ? { githubUrl: links.githubUrl?.trim() || null } : {}),
      ...(links.portfolioUrl !== undefined ? { portfolioUrl: links.portfolioUrl?.trim() || null } : {}),
      ...(links.xUrl !== undefined ? { xUrl: links.xUrl?.trim() || null } : {}),
    };
    const person = await this.prisma.person.update({
      where: { personId: user.personId },
      data,
      select: { githubUrl: true, portfolioUrl: true, xUrl: true },
    });
    return {
      socialLinks: {
        github: person.githubUrl,
        portfolio: person.portfolioUrl,
        x: person.xUrl,
      },
    };
  }

  async me(user: RequestUser) {
    // role dates are saudi calendar days
    const today = new Date(
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }),
    );

    const person = await this.prisma.person.findUniqueOrThrow({
      where: { personId: user.personId },
      select: {
        fullName: true,
        emailPersonal: true,
        emailUniversity: true,
        phoneNumber: true,
        university: true,
        branch: true,
        major: true,
        gender: true,
        bio: true,
        githubUrl: true,
        portfolioUrl: true,
        xUrl: true,
        profileImageUrl: true,
        member: {
          select: {
            membershipNumber: true,
            joinDate: true,
            committees: {
              select: {
                role: true,
                committee: {
                  select: { committeeCode: true, committeeName: true },
                },
              },
              orderBy: { committeeId: 'asc' },
            },
            roleAssignments: {
              where: {
                AND: [
                  { OR: [{ startsOn: null }, { startsOn: { lte: today } }] },
                  { OR: [{ endsOn: null }, { endsOn: { gte: today } }] },
                ],
              },
              select: { roleCode: true },
            },
          },
        },
        membershipRequest: { select: { status: true, applicationData: true } },
        nonMemberRegistration: { select: { applicationData: true } },
      },
    });

    // an inactive member sees the same as a non-member
    const member = user.memberId ? person.member : null;
    const applicationData = (
      person.membershipRequest?.applicationData ??
      person.nonMemberRegistration?.applicationData ??
      {}
    ) as Record<string, unknown>;
    const applicationText = (key: string) =>
      typeof applicationData[key] === 'string' && applicationData[key].trim()
        ? applicationData[key].trim()
        : null;

    return {
      personId: user.personId,
      memberId: user.memberId,
      membershipNumber: member?.membershipNumber ?? null,
      fullName: person.fullName,
      email: person.emailPersonal ?? user.email ?? null,
      universityEmail: person.emailUniversity,
      phoneNumber: person.phoneNumber,
      university: person.university,
      branch: person.branch,
      college: applicationText('college'),
      major: person.major,
      level: applicationText('level'),
      gender: person.gender,
      bio: person.bio,
      socialLinks: {
        github: person.githubUrl,
        portfolio: person.portfolioUrl,
        x: person.xUrl,
      },
      profileImageUrl: person.profileImageUrl,
      joinDate: member?.joinDate ?? null,
      committees:
        member?.committees.map(({ role, committee }) => ({
          code: committee.committeeCode,
          name: committee.committeeName,
          position: role,
        })) ?? [],
      roles: [...new Set(member?.roleAssignments.map((r) => r.roleCode))],
      membershipRequestPending: person.membershipRequest?.status === 'PENDING',
    };
  }

  // The personal email is the sign-in identity. University email is profile data only.
  private findPersonByEmail(email: string) {
    return this.prisma.person.findFirst({
      where: { emailPersonal: { equals: email, mode: 'insensitive' } },
      select: { personId: true, authUserId: true },
    });
  }

}
