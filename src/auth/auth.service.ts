import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AuthError,
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestUser } from './auth.guard.js';
import type { CheckEmailDto } from './check-email.dto.js';
import type { LoginDto } from './login.dto.js';
import type {
  RequestSetupLinkDto,
  SetupPasswordDto,
} from './setup-password.dto.js';
import type { SignupDto } from './signup.dto.js';

const UNIQUE_VIOLATION = 'P2002';

function emailAlreadyExists() {
  return new ConflictException('An account with this email already exists.', {
    errorCode: 'EMAIL_ALREADY_EXISTS',
  });
}

// supabase's free email sender only allows a few emails an hour
function emailError(error: AuthError) {
  if (error.code === 'over_email_send_rate_limit') {
    return new HttpException(
      'Too many emails were sent. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
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
  ) {}

  // supabase checks the password, we just hand back the session
  async login({ email, password }: LoginDto) {
    const { data, error } = await this.client().auth.signInWithPassword({
      email,
      password,
    });

    // same answer for wrong email + wrong password
    if (error?.code === 'invalid_credentials') {
      throw new UnauthorizedException();
    }
    if (error) throw error;

    return tokens(data.session);
  }

  async verifySignupEmail(email: string, token: string) {
    const { data, error } = await this.client().auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error || !data.session) throw new UnauthorizedException();
    return tokens(data.session);
  }

  async refreshSession(refreshToken: string) {
    const { data, error } = await this.client().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session) throw new UnauthorizedException();
    return tokens(data.session);
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
  async signup({ fullName, email, password }: SignupDto) {
    // existing members who haven't activated yet count too
    if (await this.findPersonByEmail(email)) throw emailAlreadyExists();

    const { data, error } = await this.client().auth.signUp({
      email,
      password,
    });
    if (
      error?.code === 'user_already_exists' ||
      error?.code === 'email_exists'
    ) {
      throw emailAlreadyExists();
    }
    if (error?.code === 'weak_password') {
      throw new BadRequestException('password is too weak.');
    }
    if (error) throw error;
    if (!data.user || data.user.identities?.length === 0) throw emailAlreadyExists();

    try {
      await this.prisma.person.create({
        data: {
          authUserId: data.user.id,
          fullName: fullName.trim(),
          // registration emails go to email_personal
          emailPersonal: email.toLowerCase(),
        },
      });
    } catch (personError) {
      // no person = the account is useless, so undo it
      await this.deleteAccount(data.user.id);
      if (
        personError instanceof Prisma.PrismaClientKnownRequestError &&
        personError.code === UNIQUE_VIOLATION
      ) {
        throw emailAlreadyExists();
      }
      throw personError;
    }

    // With email confirmation enabled, Supabase returns a user but no session.
    // The frontend verifies the OTP before it can submit an application.
    return data.session ? tokens(data.session) : { emailVerificationRequired: true };
  }

  // step 1: email them a link to choose a password
  async requestSetupLink({ email }: RequestSetupLinkDto) {
    const person = await this.findPersonByEmail(email);
    if (!person) throw new NotFoundException();

    // linked already = invite expired or password forgotten, a reset email does the same job
    if (person.authUserId) {
      const { error } = await this.client().auth.resetPasswordForEmail(email, {
        redirectTo: this.setupPageUrl(),
      });
      if (error) throw emailError(error);
      return;
    }

    const { data, error } = await this.admin().inviteUserByEmail(email, {
      redirectTo: this.setupPageUrl(),
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

  // who's logged in + what the frontend needs to pick their pages
  async me(user: RequestUser) {
    // role dates are saudi calendar days
    const today = new Date(
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }),
    );

    const person = await this.prisma.person.findUniqueOrThrow({
      where: { personId: user.personId },
      select: {
        fullName: true,
        member: {
          select: {
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
      },
    });

    // an inactive member sees the same as a non-member
    const member = user.memberId ? person.member : null;

    return {
      personId: user.personId,
      memberId: user.memberId,
      fullName: person.fullName,
      email: user.email ?? null,
      committees:
        member?.committees.map(({ role, committee }) => ({
          code: committee.committeeCode,
          name: committee.committeeName,
          position: role,
        })) ?? [],
      roles: [...new Set(member?.roleAssignments.map((r) => r.roleCode))],
    };
  }

  // either email column, any letter case
  private findPersonByEmail(email: string) {
    return this.prisma.person.findFirst({
      where: {
        OR: [
          { emailPersonal: { equals: email, mode: 'insensitive' } },
          { emailUniversity: { equals: email, mode: 'insensitive' } },
        ],
      },
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
  private setupPageUrl() {
    return this.config.getOrThrow<string>('PASSWORD_SETUP_URL');
  }

  // made on first use so the app still starts without the supabase env vars
  private client() {
    this.supabase ??= this.connect('SUPABASE_PUBLISHABLE_KEY');
    return this.supabase;
  }

  // secret key client, only for deleting/inviting accounts, nobody logs in here
  private admin() {
    this.supabaseAdmin ??= this.connect('SUPABASE_SECRET_KEY');
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
