import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  type AuthError,
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmtpEmailService } from '../common/email/smtp-email.service.js';
import { approvalScopeFor, findApplicableCommittees } from '../committees/committee-catalog.js';
import type { RequestUser } from './auth.guard.js';
import type { CheckEmailDto } from './check-email.dto.js';
import type { LoginDto } from './login.dto.js';
import type {
  RequestSetupLinkDto,
  CompleteSetupPasswordDto,
  SetupPasswordDto,
} from './setup-password.dto.js';
import type { SignupDto } from './signup.dto.js';
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

// supabase's free email sender only allows a few emails an hour
function emailError(error: AuthError) {
  if (error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit' || error.status === 429) {
    return new HttpException(
      'Too many emails were sent. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error.code === 'email_address_not_authorized') {
    return new ForbiddenException(
      'This email address is not authorized by the default email provider.',
      { errorCode: 'EMAIL_ADDRESS_NOT_AUTHORIZED' },
    );
  }
  return error;
}

function tokens(session: Session) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private supabase?: SupabaseClient;
  private supabaseAdmin?: SupabaseClient;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(SmtpEmailService) private readonly smtp: SmtpEmailService,
  ) {}

  // supabase checks the password, we just hand back the session
  async login({ email, password }: LoginDto) {
    const { data, error } = await this.client().auth.signInWithPassword({
      email,
      password,
    });

    if (error?.code === 'email_not_confirmed') {
      const pending = await this.prisma.signupVerification.findUnique({
        where: { emailPersonal: email.trim().toLowerCase() },
      });
      if (pending && !pending.verifiedAt) {
        try {
          await this.resendPersonalVerification(pending.emailPersonal);
        } catch (resendError) {
          if (!(resendError instanceof HttpException) || resendError.getStatus() !== HttpStatus.TOO_MANY_REQUESTS) throw resendError;
        }
        throw new ConflictException('Verify your personal email to continue.', {
          errorCode: 'EMAIL_NOT_VERIFIED',
        });
      }
      const legacy = await this.prisma.person.findFirst({
        where: {
          emailPersonal: { equals: email.trim(), mode: 'insensitive' },
          emailPersonalVerifiedAt: null,
          pendingSignup: { is: { expiresAt: { gt: new Date() } } },
        },
        select: { emailPersonal: true },
      });
      if (legacy) {
        try {
          await this.resendPersonalVerification(legacy.emailPersonal!);
        } catch (resendError) {
          if (!(resendError instanceof HttpException) || resendError.getStatus() !== HttpStatus.TOO_MANY_REQUESTS) throw resendError;
        }
        throw new ConflictException('Verify your personal email to continue.', {
          errorCode: 'EMAIL_NOT_VERIFIED',
        });
      }
    }

    // same answer for wrong email + wrong password
    if (error?.code === 'invalid_credentials') {
      throw new UnauthorizedException();
    }
    if (error) throw emailError(error);

    if (!data.user || !data.session) throw new UnauthorizedException();
    const localPerson = await this.prisma.person.findUnique({
      where: { authUserId: data.user.id },
      select: { isActive: true },
    });
    if (!localPerson?.isActive) {
      await this.admin().signOut(data.session.access_token, 'local');
      throw new UnauthorizedException();
    }

    return tokens(data.session);
  }

  async verifySignupEmail(email: string, token: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const pending = await this.prisma.signupVerification.findUnique({
      where: { emailPersonal: normalizedEmail },
    });
    if (!pending) return this.verifyLegacySignupEmail(normalizedEmail, token);
    if (pending.expiresAt <= new Date() || pending.verifiedAt) throw new UnauthorizedException();
    // Non-members only attend events, so their account is ready once verified.
    const registrationPendingApproval = pending.registrationType === 'MEMBER';

    if (pending.codeHash) {
      if (!pending.codeExpiresAt || pending.codeExpiresAt <= new Date()) throw new UnauthorizedException();
      await this.verifySharedSignupCode(pending, token);
      await this.createVerifiedSignup(pending, new Date());
      return { authenticated: false as const, registrationPendingApproval };
    }

    const { data, error } = await this.client().auth.verifyOtp({ email: normalizedEmail, token, type: 'email' });
    if (error?.status === 429 || error?.code === 'over_request_rate_limit') throw emailError(error);
    if (error || !data.session || !data.user || data.user.id !== pending.authUserId) throw new UnauthorizedException();
    await this.createVerifiedSignup(pending, new Date());
    return { ...tokens(data.session), registrationPendingApproval };
  }

  private async verifyLegacySignupEmail(email: string, token: string) {
    const legacy = await this.prisma.person.findFirst({
      where: { emailPersonal: { equals: email, mode: 'insensitive' }, pendingSignup: { is: { expiresAt: { gt: new Date() } } } },
      select: { personId: true, authUserId: true },
    });
    const legacyChallenge = legacy
      ? await this.prisma.emailVerificationChallenge.findUnique({
          where: { personId_purpose: { personId: legacy.personId, purpose: 'SHARED_SIGNUP' } },
        })
      : null;
    if (legacy && legacyChallenge) {
      if (!legacy.authUserId) throw new UnauthorizedException();
      await this.verifyLegacySharedSignupCode(legacy.personId, legacy.authUserId, token);
      return { authenticated: false as const, registrationPendingApproval: true as const };
    }
    const { data, error } = await this.client().auth.verifyOtp({ email, token, type: 'email' });
    if (error?.status === 429 || error?.code === 'over_request_rate_limit') throw emailError(error);
    if (error || !data.session || !data.user) throw new UnauthorizedException();
    const person = await this.prisma.person.findUnique({
      where: { authUserId: data.user.id },
      select: { personId: true, pendingSignup: { select: { expiresAt: true } } },
    });
    if (!person?.pendingSignup || person.pendingSignup.expiresAt <= new Date()) throw new UnauthorizedException();
    await this.prisma.person.update({ where: { personId: person.personId }, data: { emailPersonalVerifiedAt: new Date() } });
    await this.finalizePendingSignup(person.personId);
    return { ...tokens(data.session), registrationPendingApproval: true };
  }

  async refreshSession(refreshToken: string) {
    const { data, error } = await this.client().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session || !data.user) throw new UnauthorizedException();
    const person = await this.prisma.person.findUnique({
      where: { authUserId: data.user.id },
      select: { isActive: true },
    });
    if (!person?.isActive) {
      await this.admin().signOut(data.session.access_token, 'local');
      throw new UnauthorizedException();
    }
    return tokens(data.session);
  }

  async logout(refreshToken?: string, accessToken?: string, accessTokenExpiresAt?: number) {
    if (accessToken) {
      const tokenHash = createHash('sha256').update(accessToken).digest('hex');
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = accessTokenExpiresAt && accessTokenExpiresAt > now
        ? new Date(accessTokenExpiresAt * 1000)
        : new Date((now + 24 * 60 * 60) * 1000);
      await this.prisma.revokedAuthToken.upsert({
        where: { tokenHash },
        create: { tokenHash, expiresAt },
        update: { expiresAt },
      });
      await this.prisma.revokedAuthToken.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    }
    if (!refreshToken) return;
    const { data, error } = await this.client().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) return;
    const { error: revokeError } = await this.admin().signOut(data.session.access_token, 'local');
    if (revokeError) this.logger.warn('Supabase did not revoke the local session during logout.');
  }

  // Supabase access tokens do not include a stable email-confirmed claim.
  // Ask Supabase Auth for the user tied to this already-verified JWT instead.
  async isEmailVerified(accessToken: string): Promise<boolean> {
    const { data, error } = await this.client().auth.getUser(accessToken);
    if (error || !data.user) return false;
    return Boolean(data.user.email_confirmed_at);
  }

  // tells the frontend which screen comes after the email box
  async checkEmail({ email }: CheckEmailDto) {
    const person = await this.findPersonByEmail(email);

    if (!person) return { nextStep: 'SIGNUP_REQUIRED' };
    if (!person.authUserId) return { nextStep: 'PASSWORD_SETUP_REQUIRED' };
    return { nextStep: 'PASSWORD_REQUIRED' };
  }

  // supabase account + person row, no member row or role
  async signup({
    fullName, email, universityEmail, password, registrationType,
    applicationData, committees = [], requestedGlobalRoles = [],
  }: SignupDto) {
    if (universityEmail && universityEmail.trim().toLowerCase() === email.trim().toLowerCase()) {
      throw new BadRequestException('Personal and university emails must be different.', {
        errorCode: 'EMAILS_MUST_DIFFER',
      });
    }
    // Reject unknown or parent committees before creating the auth account.
    if (!(await findApplicableCommittees(this.prisma, committees.map((item) => item.committeeCode)))) throw committeeUnavailable();
    // Existing members and unexpired signup attempts both reserve their emails.
    if (await this.findPersonByEmail(email)) throw emailAlreadyExists();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUniversityEmail = universityEmail?.trim().toLowerCase() ?? null;
    const staged = await this.prisma.signupVerification.findFirst({
      where: {
        expiresAt: { gt: new Date() },
        emailPersonal: normalizedEmail,
      },
      select: { signupVerificationId: true },
    });
    if (staged) throw emailAlreadyExists();

    const { data, error } = await this.client().auth.signUp({ email, password });
    if (error?.code === 'user_already_exists' || error?.code === 'email_exists') throw emailAlreadyExists();
    if (error?.code === 'weak_password') {
      throw new BadRequestException('Choose a stronger password.', { errorCode: 'SIGNUP_WEAK_PASSWORD' });
    }
    if (error) throw emailError(error);
    if (!data.user || data.user.identities?.length === 0) throw emailAlreadyExists();
    if (data.session) {
      await this.deleteAccount(data.user.id);
      throw new ServiceUnavailableException('Enable Supabase email confirmation before allowing signup.');
    }
    const authUserId = data.user.id;

    try {
      await this.prisma.signupVerification.create({
        data: {
          authUserId,
          fullName: fullName.trim(),
          emailPersonal: normalizedEmail,
          emailUniversity: normalizedUniversityEmail,
          registrationType,
          applicationData: JSON.parse(JSON.stringify(applicationData)),
          committees: JSON.parse(JSON.stringify(committees)),
          globalRoles: JSON.parse(JSON.stringify(requestedGlobalRoles)),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (personError) {
      await this.prisma.signupVerification.deleteMany({ where: { authUserId } }).catch(() => undefined);
      await this.deleteAccount(authUserId);
      if (
        personError instanceof Prisma.PrismaClientKnownRequestError &&
        personError.code === UNIQUE_VIOLATION
      ) {
        throw emailAlreadyExists();
      }
      throw personError;
    }

    return { emailVerificationRequired: true };
  }

  async resendPersonalVerification(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const pending = await this.prisma.signupVerification.findUnique({ where: { emailPersonal: normalizedEmail } });
    if (!pending) {
      const legacy = await this.prisma.person.findFirst({
        where: { emailPersonal: { equals: normalizedEmail, mode: 'insensitive' }, emailPersonalVerifiedAt: null, pendingSignup: { is: { expiresAt: { gt: new Date() } } } },
        select: { personId: true },
      });
      if (!legacy) return;
      const challenge = await this.prisma.emailVerificationChallenge.findUnique({
        where: { personId_purpose: { personId: legacy.personId, purpose: 'SHARED_SIGNUP' } },
      });
      if (challenge) {
        await this.sendLegacySharedSignupVerification(legacy.personId, normalizedEmail);
      } else {
        const { error } = await this.client().auth.resend({ type: 'signup', email: normalizedEmail });
        if (error) throw emailError(error);
      }
      return;
    }
    if (pending.verifiedAt) return;
    if (pending.expiresAt <= new Date()) {
      await this.prisma.signupVerification.update({
        where: { signupVerificationId: pending.signupVerificationId },
        data: { expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
    }
    if (pending.codeHash) {
      await this.sendSharedSignupVerification(pending);
      return;
    }
    const { error } = await this.client().auth.resend({ type: 'signup', email: normalizedEmail });
    if (error) throw emailError(error);
  }

  private async verifySharedSignupCode(
    pending: Prisma.SignupVerificationGetPayload<object>,
    code: string,
  ) {
    if (!pending.codeHash || !pending.sentAt || !pending.codeExpiresAt || pending.codeExpiresAt <= new Date() || pending.attempts >= 5) throw new UnauthorizedException();
    const actual = Buffer.from(this.verificationHash(pending.authUserId, code, 'SHARED_SIGNUP'), 'hex');
    const expected = Buffer.from(pending.codeHash, 'hex');
    const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    const updated = await this.prisma.signupVerification.updateMany({
      where: { signupVerificationId: pending.signupVerificationId, verifiedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
      data: valid ? { attempts: { increment: 0 } } : { attempts: { increment: 1 } },
    });
    if (!updated.count || !valid) throw new UnauthorizedException();
    const { error } = await this.admin().updateUserById(pending.authUserId, { email_confirm: true });
    if (error) throw error;
  }

  private async verifyLegacySharedSignupCode(personId: number, authUserId: string, code: string) {
    const challenge = await this.prisma.emailVerificationChallenge.findUnique({
      where: { personId_purpose: { personId, purpose: 'SHARED_SIGNUP' } },
    });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) throw new UnauthorizedException();
    const actual = Buffer.from(this.verificationHash(personId, code, 'SHARED_SIGNUP'), 'hex');
    const expected = Buffer.from(challenge.codeHash, 'hex');
    const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    const updated = await this.prisma.emailVerificationChallenge.updateMany({
      where: { emailVerificationChallengeId: challenge.emailVerificationChallengeId, consumedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
      data: valid ? { attempts: { increment: 0 } } : { attempts: { increment: 1 } },
    });
    if (!updated.count || !valid) throw new UnauthorizedException();
    const { error } = await this.admin().updateUserById(authUserId, { email_confirm: true });
    if (error) throw error;
    const consumed = await this.prisma.emailVerificationChallenge.updateMany({
      where: { emailVerificationChallengeId: challenge.emailVerificationChallengeId, consumedAt: null, attempts: { lt: 5 }, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (!consumed.count) throw new UnauthorizedException();
    await this.prisma.person.update({ where: { personId }, data: { emailPersonalVerifiedAt: new Date() } });
    await this.finalizePendingSignup(personId);
  }

  private async sendLegacySharedSignupVerification(personId: number, personalEmail: string) {
    const now = new Date();
    const previous = await this.prisma.emailVerificationChallenge.findUnique({
      where: { personId_purpose: { personId, purpose: 'SHARED_SIGNUP' } },
      select: { sentAt: true },
    });
    if (previous && now.getTime() - previous.sentAt.getTime() < 60_000) throw new HttpException('Please wait before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);
    const from = this.config.get<string>('AUTH_EMAIL_FROM');
    if (!from) throw new ServiceUnavailableException('Email verification is not configured.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    await this.prisma.emailVerificationChallenge.upsert({
      where: { personId_purpose: { personId, purpose: 'SHARED_SIGNUP' } },
      create: { personId, purpose: 'SHARED_SIGNUP', email: personalEmail, codeHash: this.verificationHash(personId, code, 'SHARED_SIGNUP'), sentAt: now, expiresAt, attempts: 0 },
      update: { email: personalEmail, codeHash: this.verificationHash(personId, code, 'SHARED_SIGNUP'), sentAt: now, expiresAt, attempts: 0, consumedAt: null },
    });
    const text = `Your GDG on Campus UJ registration code is ${code}. Enter it on the signup page within 10 minutes.`;
    await this.sendAuthEmail({ from, to: personalEmail, subject: 'Verify your GDG on Campus UJ registration', text });
  }

  private async sendSharedSignupVerification(pending: Prisma.SignupVerificationGetPayload<object>) {
    const now = new Date();
    if (pending.sentAt && now.getTime() - pending.sentAt.getTime() < 60_000) {
      throw new HttpException('Please wait before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const from = this.config.get<string>('AUTH_EMAIL_FROM');
    if (!from) throw new ServiceUnavailableException('Email verification is not configured.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeExpiresAt = new Date(now.getTime() + 10 * 60_000);
    await this.prisma.signupVerification.update({
      where: { signupVerificationId: pending.signupVerificationId },
      data: { codeHash: this.verificationHash(pending.authUserId, code, 'SHARED_SIGNUP'), sentAt: now, codeExpiresAt, attempts: 0 },
    });
    const text = `Your GDG on Campus UJ registration code is ${code}. Enter it on the signup page within 10 minutes.`;
    await this.sendAuthEmail({ from, to: pending.emailPersonal, subject: 'Verify your GDG on Campus UJ registration', text });
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

  private async sendAuthEmail(message: { from: string; to: string; subject: string; text: string }) {
    await this.smtp.sendMail(message, {
      unavailableMessage: 'Email delivery is not configured.',
      sendErrorMessage: 'Could not send verification email. Check the SMTP settings.',
    });
  }

  private verificationHash(personId: number | string, code: string, purpose: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'))
      .update(`${personId}:${purpose}:${code}`).digest('hex');
  }

  private async finalizePendingSignup(personId: number) {
    await this.prisma.$transaction(async (tx) => {
      const person = await tx.person.findUnique({ where: { personId }, include: { pendingSignup: true } });
      const pending = person?.pendingSignup;
      if (!person || !pending || pending.expiresAt <= new Date() || !person.emailPersonalVerifiedAt) throw new UnauthorizedException();
      const data = pending.applicationData as Record<string, unknown>;
      await tx.person.update({ where: { personId }, data: {
        phoneNumber: String(data.phoneNumber), university: String(data.university),
        branch: typeof data.branch === 'string' ? data.branch : null,
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

  // step 1: email them a link to choose a password
  async requestSetupLink({ email, locale = 'en' }: RequestSetupLinkDto) {
    const person = await this.findPersonByEmail(email);
    // Keep account-recovery responses identical for known and unknown emails.
    if (!person) return;

    // linked already = invite expired or password forgotten, a reset email does the same job
    if (person.authUserId) {
      const { error } = await this.client().auth.resetPasswordForEmail(email, {
        redirectTo: this.setupPageUrl(locale),
      });
      if (error) throw emailError(error);
      return;
    }

    const { data, error } = await this.admin().inviteUserByEmail(email, {
      redirectTo: this.setupPageUrl(locale),
    });
    // a supabase account with this email exists but isn't linked to them, needs fixing by hand
    if (error?.code === 'email_exists') throw new ConflictException();
    if (error) throw emailError(error);

    // link now, never later by matching emails
    try {
      await this.prisma.person.updateMany({
        where: { personId: person.personId, authUserId: null },
        data: { authUserId: data.user.id },
      });
    } catch (linkError) {
      await this.deleteAccount(data.user.id);
      throw linkError;
    }
  }

  // step 2: they opened the link and chose a password, then they're logged in
  async setupPassword(user: RequestUser, { password }: SetupPasswordDto) {
    // a normal login token isn't enough, it has to come from the email link
    if (!user.fromEmailLink) throw new ForbiddenException();

    const person = await this.prisma.person.findUniqueOrThrow({
      where: { personId: user.personId },
      select: { authUserId: true },
    });
    if (!person.authUserId) throw new UnauthorizedException();

    const { data, error } = await this.admin().updateUserById(
      person.authUserId,
      { password },
    );
    if (error?.code === 'weak_password' || error?.code === 'same_password') {
      throw new BadRequestException('password is too weak.');
    }
    if (error) throw error;

    return this.login({ email: data.user.email ?? '', password });
  }

  // Verify the one-time email hash only when the user submits the reset form.
  // Merely opening the landing page cannot consume the link (email scanners may prefetch it).
  async completeSetupPassword({ tokenHash, type, password }: CompleteSetupPasswordDto): Promise<void> {
    let stage = 'verify_token';
    try {
      const { data, error } = await this.client().auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });
      if (error?.status === 429 || error?.code === 'over_request_rate_limit') throw emailError(error);
      if (error || !data.user?.id || !data.session) throw new UnauthorizedException();

      stage = 'find_person';
      const person = await this.prisma.person.findUnique({
        where: { authUserId: data.user.id },
        select: { personId: true, isActive: true },
      });
      if (!person?.isActive) throw new UnauthorizedException();

      stage = 'update_password';
      // Use the just-verified recovery session instead of admin.updateUserById.
      // This scopes the password change to the account that proved email ownership
      // and avoids relying on an admin API key for this user-initiated action.
      const recoveryClient = createClient(
        this.config.getOrThrow<string>('SUPABASE_URL'),
        this.config.getOrThrow<string>('SUPABASE_PUBLISHABLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
      );
      const { error: sessionError } = await recoveryClient.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) {
        if (sessionError.status === 401 || sessionError.status === 403) throw new UnauthorizedException();
        throw sessionError;
      }

      const { data: updated, error: updateError } = await recoveryClient.auth.updateUser({ password });
      if (updateError?.code === 'weak_password' || updateError?.code === 'same_password') {
        throw new BadRequestException('password is too weak.');
      }
      if (updateError?.status === 401 || updateError?.status === 403) throw new UnauthorizedException();
      if (updateError || !updated.user?.id) throw updateError ?? new UnauthorizedException();

      // A valid invite/recovery token proves control of the personal address.
      // Keep the local verification status aligned with Supabase Auth.
      await this.prisma.person.updateMany({
        where: { personId: person.personId, emailPersonalVerifiedAt: null },
        data: { emailPersonalVerifiedAt: new Date() },
      });

      return;
    } catch (error) {
      const isServerError = !(error instanceof HttpException) || error.getStatus() >= 500;
      if (isServerError) {
        const details = error as { name?: unknown; code?: unknown; status?: unknown };
        this.logger.error({
          event: 'password_setup_failed',
          stage,
          errorName: error instanceof Error ? error.name : 'unknown',
          errorCode: typeof details.code === 'string' ? details.code : undefined,
          errorStatus: typeof details.status === 'number' ? details.status : undefined,
        });
      }
      throw error;
    }
  }

  // who's logged in + what the frontend needs to pick their pages
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

  private async deleteAccount(authUserId: string) {
    try {
      const { error } = await this.admin().deleteUser(authUserId);
      if (!error) return;
    } catch {
      // logged below
    }
    // can't undo = someone has to delete it in the supabase dashboard
    this.logger.error(`couldn't delete supabase user ${authUserId}`);
  }

  // frontend page the email link opens
  private setupPageUrl(locale: 'en' | 'ar' = 'en') {
    const url = new URL(this.config.getOrThrow<string>('PASSWORD_SETUP_URL'));
    const basePath = url.pathname
      .replace(/\/(?:en|ar)\/reset-password\/?$/, '')
      .replace(/\/+$/, '');
    url.pathname = `${basePath}/${locale}/reset-password`;
    return url.toString().replace(/\/$/, '');
  }

  // made on first use so the app still starts without the supabase env vars
  private client() {
    this.supabase ??= this.connect('SUPABASE_PUBLISHABLE_KEY');
    return this.supabase;
  }

  // secret key client, only for deleting/inviting accounts, nobody logs in here
  private admin() {
    this.supabaseAdmin ??= this.connect('SUPABASE_SERVICE_ROLE_KEY');
    return this.supabaseAdmin.auth.admin;
  }

  private connect(keyName: string) {
    return createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>(keyName),
      // the server keeps no session of its own
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
}
