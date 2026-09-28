import type { PrismaClient } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { auth, googleEnabled } from '@/lib/auth';
import { mergeGuestInto } from '@/lib/auth/oauth';
import {
  authUserInclude,
  createCredentialAccount,
  createSessionToken,
  deleteSessionToken,
  getSessionFromBearerToken,
  toAuthUser,
  verifyCredentialPassword,
} from '@/lib/auth/session';
import { SYSTEM_ROLES, systemRoleId } from '@/lib/permissions';
import {
  consumeRegistration,
  discardRegistration,
  REGISTRATION_RESEND_COOLDOWN_MS,
  registrationCodeEmail,
  stageRegistration,
} from '@/lib/auth/registration';
import {
  ACCOUNT_CHANGE_RESEND_COOLDOWN_MS,
  type AccountChange,
  type AccountChangeKind,
  accountChangeCodeEmail,
  type ConsumeChangeResult,
  consumeAccountChange,
  discardAccountChange,
  emailChangedNotice,
  stageAccountChange,
} from '@/lib/auth/account-change';
import { sendEmail } from '@/lib/email';
import { setup } from '@/setup';
import { authorize } from '@/middleware/authorize';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';
import bcrypt from 'bcryptjs';

type Translate = (text: { en: string; ar: string }) => string;

// Only a guest upgrades in place, so only its own row is not a conflict.
function guestId(user: { id: string; isGuest: boolean } | null): string | undefined {
  return user?.isGuest ? user.id : undefined;
}

// A guest registering may keep its own username; any other match is taken.
async function assertRegistrationAvailable(
  prisma: PrismaClient,
  { email, username }: { email: string; username: string },
  currentUserId: string | undefined,
  translate: Translate,
): Promise<void> {
  const existingEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingEmail && existingEmail.id !== currentUserId) {
    throw new HttpError({
      message: translate({
        en: 'Email already registered',
        ar: 'البريد الإلكتروني مسجل بالفعل',
      }),
    });
  }

  const existingUsername = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });

  if (existingUsername && existingUsername.id !== currentUserId) {
    throw new HttpError({
      message: translate({
        en: 'Username already taken',
        ar: 'اسم المستخدم مأخوذ بالفعل',
      }),
    });
  }
}

type Member = { id: string; email: string; isGuest: boolean };

// Guests have no verified email, so only registered accounts change credentials.
function requireMember<T extends Member>(currentUser: T | null | undefined): T {
  if (!currentUser) {
    throw new HttpError({ statusCode: 401, message: 'Authentication required' });
  }
  if (currentUser.isGuest) {
    throw new HttpError({ statusCode: 403, message: 'A registered account is required' });
  }
  return currentUser;
}

// Accounts without reader access (dashboard-only) can't use the reader API;
// a dashboard user can grant it from the Users page.
function assertReaderPortal(user: { isUser: boolean }, translate: Translate): void {
  if (!user.isUser) {
    throw new HttpError({
      statusCode: 403,
      message: translate({
        en: 'This account does not have reader access',
        ar: 'لا يملك هذا الحساب صلاحية القارئ',
      }),
    });
  }
}

async function assertEmailAvailable(
  prisma: PrismaClient,
  email: string,
  currentUserId: string,
  translate: Translate,
): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing && existing.id !== currentUserId) {
    throw new HttpError({
      message: translate({
        en: 'Email already registered',
        ar: 'البريد الإلكتروني مسجل بالفعل',
      }),
    });
  }
}

// Stages the change and emails its code to `to`.
async function sendAccountChangeCode(
  prisma: PrismaClient,
  member: Member,
  to: string,
  change: AccountChange,
  translate: Translate,
) {
  const staged = await stageAccountChange(prisma, member.id, change);

  if (staged.status === 'cooldown') {
    throw new HttpError({
      statusCode: 429,
      message: translate({
        en: `Please wait ${staged.retryAfterSeconds} seconds before requesting another code`,
        ar: `يرجى الانتظار ${staged.retryAfterSeconds} ثانية قبل طلب رمز آخر`,
      }),
    });
  }

  const sent = await sendEmail(accountChangeCodeEmail(to, staged.code, change.kind, translate));
  if (!sent) {
    // Drop the unusable code so the cooldown does not block a retry.
    await discardAccountChange(prisma, member.id, change.kind);
    throw new HttpError({
      statusCode: 502,
      message: translate({
        en: 'Could not send the verification email. Please try again later.',
        ar: 'تعذر إرسال رسالة التحقق. يرجى المحاولة لاحقًا.',
      }),
    });
  }

  return {
    email: to,
    expiresAt: staged.expiresAt.toISOString(),
    resendAfterSeconds: ACCOUNT_CHANGE_RESEND_COOLDOWN_MS / 1000,
  };
}

function verifiedChange<K extends AccountChangeKind>(
  result: ConsumeChangeResult<K>,
  translate: Translate,
): Extract<AccountChange, { kind: K }> {
  if (result.status === 'expired') {
    throw new HttpError({
      message: translate({
        en: 'This code has expired. Request a new one.',
        ar: 'انتهت صلاحية هذا الرمز. اطلب رمزًا جديدًا.',
      }),
    });
  }

  if (result.status === 'invalid') {
    throw new HttpError({
      message:
        result.attemptsLeft > 0
          ? translate({
              en: `Incorrect code. ${result.attemptsLeft} attempts left.`,
              ar: `رمز غير صحيح. المحاولات المتبقية: ${result.attemptsLeft}.`,
            })
          : translate({
              en: 'Too many incorrect attempts. Request a new code.',
              ar: 'محاولات خاطئة كثيرة. اطلب رمزًا جديدًا.',
            }),
    });
  }

  return result.change;
}

// Reader accounts for the extension, website account pages and desktop
// client, mounted at `/api/user/auth`. Dashboard accounts use `admin/auth.ts`.
export const accounts = new Elysia({
  prefix: '/auth',
  tags: ['Auth'],
})
  .use(setup)

  // Guest account creation (extension calls this on first open)
  .post(
    '/guest',
    async ({ prisma, body }) => {
      const username = sanitize(body.username);

      const existing = await prisma.user.findUnique({
        where: { username },
      });

      if (existing) {
        throw new HttpError({
          message: 'Username already taken',
        });
      }

      const guestEmail = `${username.toLowerCase()}@guest.storylens.local`;
      const plainPassword = crypto.randomUUID();

      const user = await prisma.user.create({
        data: {
          email: guestEmail,
          username,
          password: await bcrypt.hash(plainPassword, 12),
          name: username,
          isUser: true,
          isGuest: true,
          userRoleId: await systemRoleId(prisma, SYSTEM_ROLES.guest),
        },
        include: authUserInclude,
      });

      await createCredentialAccount(prisma, user.id, guestEmail, plainPassword);
      const token = await createSessionToken(prisma, user.id, 'user');

      return {
        user: toAuthUser(user, 'user'),
        token,
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 30 }),
      }),
    },
  )

  // Sign-in and registration must work without a session: signing out on the
  // website clears it. Registration takes two steps: `/register` checks the
  // details and emails a code, and `/register/verify` creates the account (or
  // upgrades the guest whose token it receives) once the code matches.
  .post(
    '/register',
    async ({ currentUser, prisma, body, t: translate }) => {
      const email = sanitize(body.email).toLowerCase();
      const username = sanitize(body.username);

      await assertRegistrationAvailable(prisma, { email, username }, guestId(currentUser), translate);

      const staged = await stageRegistration(prisma, {
        email,
        username,
        name: body.name ? sanitize(body.name) : username,
        passwordHash: await bcrypt.hash(body.password, 12),
      });

      if (staged.status === 'cooldown') {
        throw new HttpError({
          statusCode: 429,
          message: translate({
            en: `Please wait ${staged.retryAfterSeconds} seconds before requesting another code`,
            ar: `يرجى الانتظار ${staged.retryAfterSeconds} ثانية قبل طلب رمز آخر`,
          }),
        });
      }

      const sent = await sendEmail(registrationCodeEmail(email, staged.code, translate));
      if (!sent) {
        // Drop the unusable code so the cooldown does not block a retry.
        await discardRegistration(prisma, email);
        throw new HttpError({
          statusCode: 502,
          message: translate({
            en: 'Could not send the verification email. Please try again later.',
            ar: 'تعذر إرسال رسالة التحقق. يرجى المحاولة لاحقًا.',
          }),
        });
      }

      return {
        email,
        expiresAt: staged.expiresAt.toISOString(),
        resendAfterSeconds: REGISTRATION_RESEND_COOLDOWN_MS / 1000,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8, maxLength: 72 }),
        username: t.String({ minLength: 3, maxLength: 30 }),
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      }),
    },
  )

  // Confirm the emailed code; returns a session like login.
  .post(
    '/register/verify',
    async ({ currentUser, prisma, body, t: translate }) => {
      const email = sanitize(body.email).toLowerCase();
      const result = await consumeRegistration(prisma, email, body.code);

      if (result.status === 'expired') {
        throw new HttpError({
          message: translate({
            en: 'This code has expired. Request a new one.',
            ar: 'انتهت صلاحية هذا الرمز. اطلب رمزًا جديدًا.',
          }),
        });
      }

      if (result.status === 'invalid') {
        throw new HttpError({
          message:
            result.attemptsLeft > 0
              ? translate({
                  en: `Incorrect code. ${result.attemptsLeft} attempts left.`,
                  ar: `رمز غير صحيح. المحاولات المتبقية: ${result.attemptsLeft}.`,
                })
              : translate({
                  en: 'Too many incorrect attempts. Request a new code.',
                  ar: 'محاولات خاطئة كثيرة. اطلب رمزًا جديدًا.',
                }),
        });
      }

      const { registration } = result;
      // The email or username may have been taken while the code was pending.
      await assertRegistrationAvailable(prisma, registration, guestId(currentUser), translate);

      const data = {
        email: registration.email,
        username: registration.username,
        password: registration.passwordHash,
        name: registration.name,
        isUser: true,
        isGuest: false,
        userRoleId: await systemRoleId(prisma, SYSTEM_ROLES.reader),
        emailVerified: true,
      };

      if (currentUser?.isGuest) {
        const user = await prisma.$transaction(async (tx) => {
          const upgraded = await tx.user.update({
            where: { id: currentUser.id },
            data,
            include: authUserInclude,
          });

          const account = await tx.account.findFirst({
            where: { userId: upgraded.id, providerId: 'credential' },
          });

          if (account) {
            await tx.account.update({
              where: { id: account.id },
              data: { accountId: data.email, password: data.password },
            });
          } else {
            await tx.account.create({
              data: {
                accountId: data.email,
                providerId: 'credential',
                userId: upgraded.id,
                password: data.password,
              },
            });
          }

          return upgraded;
        });

        const token = await createSessionToken(prisma, user.id, 'user');
        return { user: toAuthUser(user, 'user'), token };
      }

      const user = await prisma.user.create({
        data: {
          ...data,
          accounts: {
            create: {
              accountId: data.email,
              providerId: 'credential',
              password: data.password,
            },
          },
        },
        include: authUserInclude,
      });

      const token = await createSessionToken(prisma, user.id, 'user');
      return { user: toAuthUser(user, 'user'), token };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        code: t.String({ pattern: '^[0-9]{6}$' }),
      }),
    },
  )

  // Login with email and password
  .post(
    '/login',
    async ({ prisma, body, t: translate }) => {
      const email = body.email.toLowerCase();

      const user = await prisma.user.findUnique({
        where: { email },
        include: authUserInclude,
      });

      if (!user) {
        throw new HttpError({
          statusCode: 401,
          message: translate({
            en: 'Invalid email or password',
            ar: 'بريد إلكتروني أو كلمة مرور غير صالحة',
          }),
        });
      }

      const valid = await verifyCredentialPassword(prisma, user.id, body.password);
      if (!valid) {
        throw new HttpError({
          statusCode: 401,
          message: translate({
            en: 'Invalid email or password',
            ar: 'بريد إلكتروني أو كلمة مرور غير صالحة',
          }),
        });
      }

      assertReaderPortal(user, translate);

      const token = await createSessionToken(prisma, user.id, 'user');

      return {
        user: toAuthUser(user, 'user'),
        token,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 1 }),
      }),
    },
  )

  // Which OAuth providers the website may offer.
  .get('/providers', () => ({ google: googleEnabled }))

  // Exchange the Better Auth cookie session left by an OAuth callback for a
  // bearer session the extension can store, then end the cookie session.
  // A guest token from the same browser merges that guest into the account.
  .post(
    '/oauth/session',
    async ({ prisma, body, request, set, t: translate }) => {
      const oauth = await auth.api.getSession({ headers: request.headers });
      if (!oauth) {
        throw new HttpError({
          statusCode: 401,
          message: translate({
            en: 'Sign-in session expired. Please try again.',
            ar: 'انتهت جلسة تسجيل الدخول. يرجى المحاولة مجددًا.',
          }),
        });
      }

      const guest = (await getSessionFromBearerToken(prisma, body.guestToken))?.user;
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: oauth.user.id },
        include: authUserInclude,
      });
      assertReaderPortal(user, translate);

      if (guest?.isGuest && guest.id !== oauth.user.id) {
        await mergeGuestInto(prisma, guest.id, oauth.user.id);
      }

      const token = await createSessionToken(prisma, user.id, 'user');

      const signOut = await auth.api.signOut({
        headers: request.headers,
        returnHeaders: true,
      });
      const cookies = signOut.headers.getSetCookie();
      if (cookies.length > 0) set.headers['set-cookie'] = cookies;

      return { user: toAuthUser(user, 'user'), token };
    },
    {
      body: t.Object({
        guestToken: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )

  // Every route below needs a reader session and its route permission.
  .use(authorize('user'))

  // Get current user profile
  .get(
    '/me',
    async ({ currentUser, prisma, t: translate }) => {
      if (!currentUser) {
        throw new HttpError({
          statusCode: 401,
          message: translate({
            en: 'Authentication required',
            ar: 'مطلوب التحقق من الهوية',
          }),
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: currentUser.id },
        include: authUserInclude,
      });

      if (!user) {
        throw new HttpError({
          statusCode: 404,
          message: translate({
            en: 'User not found',
            ar: 'المستخدم غير موجود',
          }),
        });
      }

      return { ...toAuthUser(user, 'user'), createdAt: user.createdAt };
    },
    {},
  )

  // End this session (the bearer token stops working).
  .post('/logout', async ({ prisma, bearer }) => {
    if (bearer) await deleteSessionToken(prisma, bearer);
    return { success: true };
  })

  // Update current user profile (username, name)
  .put(
    '/me',
    async ({ currentUser, prisma, body, t: translate }) => {
      if (!currentUser) {
        throw new HttpError({
          statusCode: 401,
          message: translate({
            en: 'Authentication required',
            ar: 'مطلوب التحقق من الهوية',
          }),
        });
      }

      const data: Record<string, string> = {};

      if (body.username) {
        const username = sanitize(body.username);
        const existing = await prisma.user.findUnique({
          where: { username },
          select: { id: true },
        });

        if (existing && existing.id !== currentUser.id) {
          throw new HttpError({
            message: translate({
              en: 'Username already taken',
              ar: 'اسم المستخدم مأخوذ بالفعل',
            }),
          });
        }

        data.username = username;
      }

      if (body.name) {
        data.name = sanitize(body.name);
      }

      const user = await prisma.user.update({
        where: { id: currentUser.id },
        data,
        include: authUserInclude,
      });

      return toAuthUser(user, 'user');
    },
    {
      body: t.Object({
        username: t.Optional(t.String({ minLength: 3, maxLength: 30 })),
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      }),
    },
  )

  // Password changes take two steps: `/change-password` checks the current
  // password and emails a code to the account address, and
  // `/change-password/verify` applies the new password once the code matches.
  .post(
    '/change-password',
    async ({ currentUser, prisma, body, t: translate }) => {
      const member = requireMember(currentUser);
      const valid = await verifyCredentialPassword(prisma, member.id, body.currentPassword);
      if (!valid) {
        throw new HttpError({
          statusCode: 400,
          message: translate({
            en: 'Current password is incorrect',
            ar: 'كلمة المرور الحالية غير صحيحة',
          }),
        });
      }

      const passwordHash = await bcrypt.hash(body.newPassword, 12);
      return sendAccountChangeCode(prisma, member, member.email, { kind: 'password', passwordHash }, translate);
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 8, maxLength: 72 }),
      }),
    },
  )

  // Change both credential stores atomically; retain the current session.
  .post(
    '/change-password/verify',
    async ({ currentUser, prisma, body, t: translate }) => {
      const member = requireMember(currentUser);
      const result = await consumeAccountChange(prisma, member.id, 'password', body.code);
      const { passwordHash: password } = verifiedChange(result, translate);

      await prisma.$transaction([
        prisma.user.update({ where: { id: member.id }, data: { password } }),
        prisma.account.updateMany({ where: { userId: member.id, providerId: 'credential' }, data: { password } }),
      ]);
      return { success: true };
    },
    {
      body: t.Object({
        code: t.String({ pattern: '^[0-9]{6}$' }),
      }),
    },
  )

  // Email changes send the code to the new address, proving it belongs to the
  // reader; `/change-email/verify` then moves the account to it.
  .post(
    '/change-email',
    async ({ currentUser, prisma, body, t: translate }) => {
      const member = requireMember(currentUser);
      const email = sanitize(body.email).toLowerCase();

      if (email === member.email) {
        throw new HttpError({
          message: translate({
            en: 'This is already your email address',
            ar: 'هذا هو بريدك الإلكتروني الحالي بالفعل',
          }),
        });
      }
      await assertEmailAvailable(prisma, email, member.id, translate);

      return sendAccountChangeCode(prisma, member, email, { kind: 'email', email }, translate);
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
      }),
    },
  )

  .post(
    '/change-email/verify',
    async ({ currentUser, prisma, body, t: translate }) => {
      const member = requireMember(currentUser);
      const result = await consumeAccountChange(prisma, member.id, 'email', body.code);
      const { email } = verifiedChange(result, translate);
      // The address may have been registered while the code was pending.
      await assertEmailAvailable(prisma, email, member.id, translate);

      const [user] = await prisma.$transaction([
        prisma.user.update({
          where: { id: member.id },
          data: { email, emailVerified: true },
          include: authUserInclude,
        }),
        prisma.account.updateMany({
          where: { userId: member.id, providerId: 'credential' },
          data: { accountId: email },
        }),
      ]);

      // Best effort: the change already succeeded.
      await sendEmail(emailChangedNotice(member.email, email, translate));

      return toAuthUser(user, 'user');
    },
    {
      body: t.Object({
        code: t.String({ pattern: '^[0-9]{6}$' }),
      }),
    },
  )

  // Check username availability
  .get(
    '/check-username/:username',
    async ({ prisma, params: { username } }) => {
      const existing = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });

      return { available: !existing };
    },
    {
      params: t.Object({
        username: t.String({ minLength: 3, maxLength: 30 }),
      }),
    },
  );
