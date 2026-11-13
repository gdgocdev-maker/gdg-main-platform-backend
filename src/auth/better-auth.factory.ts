import { betterAuth } from 'better-auth';
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
    baseURL: process.env.BETTER_AUTH_URL ?? origin,
    basePath: '/api/auth',
    secret,
    trustedOrigins: [origin],
    database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
    advanced: { database: { generateId: () => randomUUID() }, defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' } },
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
    account: { modelName: 'AuthAccount', accountLinking: { enabled: true, trustedProviders: ['google'], allowDifferentEmails: false } },
    verification: { modelName: 'AuthVerification' },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashAuthPassword, verify: verifyAuthPassword },
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
