import { Elysia, t } from 'elysia';
import { auth, googleEnabled } from '@/lib/auth';
import { mergeGuestInto } from '@/lib/auth/oauth';
import {
  createCredentialAccount,
  createSessionToken,
  getUserFromBearerToken,
  toAuthUser,
  verifyCredentialPassword,
} from '@/lib/auth/session';
import { setup } from '@/setup';
import { shouldBeGuest } from '@/middleware/authorize';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';
import bcrypt from 'bcryptjs';

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
          role: 'guest',
        },
      });

      await createCredentialAccount(prisma, user.id, guestEmail, plainPassword);
      const token = await createSessionToken(prisma, user.id);

      return {
        user: toAuthUser(user),
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
  // website clears it. Register still upgrades a guest when a token is sent.
  // Register (upgrade guest to user with email+password)
  .post(
    '/register',
    async ({ currentUser, prisma, body, t: translate }) => {
      const email = sanitize(body.email).toLowerCase();
      const username = sanitize(body.username);

      const existingEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingEmail && existingEmail.id !== currentUser?.id) {
        throw new HttpError({
          message: translate({
            en: 'Email already registered',
            ar: 'البريد الإلكتروني مسجل بالفعل',
          }),
        });
      }

      const existingUsername = await prisma.user.findUnique({
        where: { username },
      });

      if (existingUsername && existingUsername.id !== currentUser?.id) {
        throw new HttpError({
          message: translate({
            en: 'Username already taken',
            ar: 'اسم المستخدم مأخوذ بالفعل',
          }),
        });
      }

      const hashedPassword = await bcrypt.hash(body.password, 12);

      if (currentUser?.role === 'guest') {
        const user = await prisma.user.update({
          where: { id: currentUser.id },
          data: {
            email,
            username,
            password: hashedPassword,
            name: body.name ? sanitize(body.name) : username,
            role: 'user',
            emailVerified: false,
          },
        });

        const account = await prisma.account.findFirst({
          where: { userId: user.id, providerId: 'credential' },
        });

        if (account) {
          await prisma.account.update({
            where: { id: account.id },
            data: {
              accountId: email,
              password: hashedPassword,
            },
          });
        } else {
          await createCredentialAccount(prisma, user.id, email, body.password);
        }

        const token = await createSessionToken(prisma, user.id);

        return {
          user: toAuthUser(user),
          token,
        };
      }

      const user = await prisma.user.create({
        data: {
          email,
          username,
          password: hashedPassword,
          name: body.name ? sanitize(body.name) : username,
          role: 'user',
        },
      });

      await createCredentialAccount(prisma, user.id, email, body.password);
      const token = await createSessionToken(prisma, user.id);

      return {
        user: toAuthUser(user),
        token,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8 }),
        username: t.String({ minLength: 3, maxLength: 30 }),
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
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

      const token = await createSessionToken(prisma, user.id);

      return {
        user: toAuthUser(user),
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

      const guest = await getUserFromBearerToken(prisma, body.guestToken);
      if (guest?.role === 'guest' && guest.id !== oauth.user.id) {
        await mergeGuestInto(prisma, guest.id, oauth.user.id);
      }

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: oauth.user.id },
      });
      const token = await createSessionToken(prisma, user.id);

      const signOut = await auth.api.signOut({
        headers: request.headers,
        returnHeaders: true,
      });
      const cookies = signOut.headers.getSetCookie();
      if (cookies.length > 0) set.headers['set-cookie'] = cookies;

      return { user: toAuthUser(user), token };
    },
    {
      body: t.Object({
        guestToken: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )

  // Better Auth (OAuth sign-in, callbacks, cookie sessions). Unguarded because
  // OAuth starts signed out; static routes above and below take precedence.
  .all('/*', async ({ request }) => auth.handler(request), {
    detail: {
      hide: true,
    },
  })

  // Get current user profile
  .use(shouldBeGuest())
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
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          role: true,
          createdAt: true,
        },
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

      return user;
    },
    {},
  )

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
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          role: true,
        },
      });

      return user;
    },
    {
      body: t.Object({
        username: t.Optional(t.String({ minLength: 3, maxLength: 30 })),
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      }),
    },
  )

  // Change both credential stores atomically; retain the current session.
  .post(
    '/change-password',
    async ({ currentUser, prisma, body, t: translate }) => {
      if (!currentUser) {
        throw new HttpError({ statusCode: 401, message: 'Authentication required' });
      }
      if (currentUser.role === 'guest') {
        throw new HttpError({ statusCode: 403, message: 'User role required' });
      }
      const valid = await verifyCredentialPassword(prisma, currentUser.id, body.currentPassword);
      if (!valid) {
        throw new HttpError({
          statusCode: 400,
          message: translate({
            en: 'Current password is incorrect',
            ar: 'كلمة المرور الحالية غير صحيحة',
          }),
        });
      }
      const password = await bcrypt.hash(body.newPassword, 12);
      await prisma.$transaction([
        prisma.user.update({ where: { id: currentUser.id }, data: { password } }),
        prisma.account.updateMany({ where: { userId: currentUser.id, providerId: 'credential' }, data: { password } }),
      ]);
      return { success: true };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 8, maxLength: 72 }),
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
