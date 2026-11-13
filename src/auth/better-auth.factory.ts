import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { openAPI } from 'better-auth/plugins';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ResendAuthEmailService } from './email/resend-auth-email.service.js';
import { hashAuthPassword, verifyAuthPassword } from './password.js';

// Constructed by NestJS with the existing PrismaService; no second connection pool.
export function createBetterAuth(prisma: PrismaService, email: ResendAuthEmailService) {
  const origin = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  return betterAuth({
    appName: 'GDG on Campus UJ',
    logger: { disabled: true }, // Provider diagnostics can contain OAuth state or email addresses.
    plugins: [openAPI({ disableDefaultReference: true })],
    baseURL: process.env.BETTER_AUTH_URL ?? origin,
    basePath: '/api/auth',
    secret,
    trustedOrigins: [origin],
    database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
    advanced: { ipAddress: { ipAddressHeaders: ['x-gdg-client-ip'] }, database: { generateId: () => randomUUID() }, defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' } },
    user: {
      modelName: 'AuthUser',
      additionalFields: { locale: { type: 'string', required: false, defaultValue: 'en' } },
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, url }) => {
          await email.send({ to: user.email, kind: 'email-change', locale: ('locale' in user && user.locale === 'ar') ? 'ar' : 'en', url });
        },
      },
    },
    session: { modelName: 'AuthSession', cookieCache: { enabled: false } },
    account: { modelName: 'AuthAccount', accountLinking: { enabled: true, trustedProviders: [], allowDifferentEmails: false } },
    verification: { modelName: 'AuthVerification' },
    rateLimit: { enabled: true, storage: 'database', modelName: 'BetterAuthRateLimit', window: 60, max: 100, customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
      '/send-verification-email': { window: 60, max: 2 },
    } },
    databaseHooks: {
      user: { update: { before: async (user) => {
        if (!user.email) return;
        const owner = await prisma.person.findFirst({ where: { emailPersonal: { equals: user.email, mode: 'insensitive' } }, select: { authUserId: true } });
        const current = await prisma.authUser.findUnique({ where: { email: user.email.toLowerCase() }, select: { id: true } });
        if (owner && owner.authUserId !== current?.id) throw new APIError('CONFLICT', { message: 'Email address is already associated with an application profile.' });
      }, after: async (user) => {
        // Recovery links issued to a previous address must not survive an email change.
        await prisma.authVerification.deleteMany({ where: { value: user.id } });
      } } },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => {
        // A successfully consumed recovery token proves ownership of the destination inbox.
        await prisma.authUser.updateMany({ where: { id: user.id, email: user.email }, data: { emailVerified: true } });
      },
      password: { hash: hashAuthPassword, verify: async (input) => {
        const valid = await verifyAuthPassword(input);
        if (valid && Buffer.byteLength(input.password, 'utf8') <= 72 && /^\$2[aby]\$/.test(input.hash)) {
          const upgraded = await hashAuthPassword(input.password);
          // Compare-and-swap avoids overwriting a concurrent password reset.
          await prisma.authAccount.updateMany({ where: { providerId: 'credential', password: input.hash }, data: { password: upgraded } });
        }
        return valid;
      } },
      sendResetPassword: async ({ user, url }) => {
        await email.send({ to: user.email, kind: 'reset', locale: ('locale' in user && user.locale === 'ar') ? 'ar' : 'en', url });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await email.send({ to: user.email, kind: 'verification', locale: ('locale' in user && user.locale === 'ar') ? 'ar' : 'en', url });
      },
      afterEmailVerification: async user => {
        await email.send({ to: user.email, kind: 'welcome', locale: ('locale' in user && user.locale === 'ar') ? 'ar' : 'en', url: `${origin}/${('locale' in user && user.locale === 'ar') ? 'ar' : 'en'}/login` });
      },
    },
    socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    } : {},
  });
}
