import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { env } from '@/env';
import { SYSTEM_ROLES, systemRoleId } from '@/lib/permissions';
import { grantTrialGift } from '@/lib/billing/trial';
import { generateUniqueUsername } from './oauth';

export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

// Better Auth serves only OAuth sign-in here. Email/password accounts, profile
// edits, and password changes use the custom routes in `src/routes/accounts.ts`,
// so the matching Better Auth endpoints stay disabled.
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/auth',
  trustedOrigins: [new URL(env.WEBSITE_URL).origin],
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID ?? '',
          clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
        },
      }
    : {},
  disabledPaths: [
    '/sign-up/email',
    '/sign-in/email',
    '/update-user',
    '/change-email',
    '/change-password',
    '/set-password',
    '/delete-user',
    '/request-password-reset',
    '/reset-password',
    '/send-verification-email',
    '/verify-email',
    '/link-social',
    '/unlink-account',
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  user: {
    // Never accept these from request bodies; the create hook fills them.
    additionalFields: {
      username: {
        type: 'string',
        required: false,
        input: false,
      },
      isUser: {
        type: 'boolean',
        required: false,
        input: false,
        defaultValue: true,
      },
      isAdmin: {
        type: 'boolean',
        required: false,
        input: false,
        defaultValue: false,
      },
      isGuest: {
        type: 'boolean',
        required: false,
        input: false,
        defaultValue: false,
      },
      userRoleId: {
        type: 'string',
        required: false,
        input: false,
      },
      adminRoleId: {
        type: 'string',
        required: false,
        input: false,
      },
      password: {
        type: 'string',
        required: false,
        input: false,
        returned: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // OAuth sign-up: the Prisma model needs a unique username and a
        // password hash, and a provider-verified account is a registered
        // reader. Dashboard access is only granted from the dashboard.
        before: async (user) => ({
          data: {
            ...user,
            username: await generateUniqueUsername(prisma, user.name),
            isUser: true,
            isAdmin: false,
            isGuest: false,
            userRoleId: await systemRoleId(prisma, SYSTEM_ROLES.reader),
            password: await bcrypt.hash(crypto.randomUUID(), 12),
          },
        }),
        // A Google sign-up is a new registered reader: give the trial lenses.
        // Best effort, so a failure never blocks signing in.
        after: async (user) => {
          try {
            await prisma.$transaction((tx) => grantTrialGift(tx, user.id));
          } catch (error) {
            console.error(`TRIAL_GIFT_FAILED ${user.id}`, error);
          }
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
