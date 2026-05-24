import { Elysia, t } from 'elysia';
import { auth } from '@/lib/auth';
import {
  createCredentialAccount,
  createSessionToken,
  toAuthUser,
  verifyCredentialPassword,
} from '@/lib/auth/session';
import { setup } from '@/setup';
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
  )

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

  // BetterAuth handler (OAuth etc.) — must be last
  .all('/*', async ({ request }) => {
    return auth.handler(request);
  });
