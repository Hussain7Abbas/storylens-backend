import bcrypt from 'bcryptjs';
import { Elysia, t } from 'elysia';
import {
  authUserInclude,
  createSessionToken,
  deleteSessionToken,
  toAuthUser,
  verifyCredentialPassword,
} from '@/lib/auth/session';
import { authorize } from '@/middleware/authorize';
import { authUserSchema, sessionResponseSchema, successSchema } from '@/schemas/admin';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

// Dashboard sign-in. There is no registration: dashboard accounts are created
// by other dashboard users (`POST /api/admin/users`) or the seed.
export const adminAuth = new Elysia({ prefix: '/auth', tags: ['Admin: Auth'] })
  .use(setup)

  .post(
    '/login',
    async ({ prisma, body }) => {
      const email = sanitize(body.email).toLowerCase();
      const user = await prisma.user.findUnique({
        where: { email },
        include: authUserInclude,
      });

      // Same answer for unknown emails, wrong passwords and reader accounts.
      const valid =
        user?.portal === 'admin' && (await verifyCredentialPassword(prisma, user.id, body.password));
      if (!user || !valid) {
        throw new HttpError({ statusCode: 401, message: 'Invalid email or password' });
      }

      const token = await createSessionToken(prisma, user.id);
      return { user: toAuthUser(user), token };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 1 }),
      }),
      response: { 200: sessionResponseSchema },
      detail: { summary: 'Sign in to the dashboard' },
    },
  )

  .use(authorize('admin'))

  .get('/me', ({ authedUser }) => authedUser, {
    response: { 200: authUserSchema },
    detail: { summary: 'View own dashboard account' },
  })

  .put(
    '/me',
    async ({ prisma, authedUser, body }) => {
      if (body.username) {
        const taken = await prisma.user.findUnique({
          where: { username: body.username },
          select: { id: true },
        });
        if (taken && taken.id !== authedUser.id) {
          throw new HttpError({ message: 'Username already taken' });
        }
      }

      const user = await prisma.user.update({
        where: { id: authedUser.id },
        data: {
          name: body.name ? sanitize(body.name) : undefined,
          username: body.username ? sanitize(body.username) : undefined,
        },
        include: authUserInclude,
      });
      return toAuthUser(user);
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        username: t.Optional(t.String({ minLength: 3, maxLength: 30 })),
      }),
      response: { 200: authUserSchema },
      detail: { summary: 'Update own dashboard profile' },
    },
  )

  // Dashboard accounts have no public email flow, so the current password
  // is the proof here; other sessions are signed out.
  .put(
    '/password',
    async ({ prisma, authedUser, bearer, body }) => {
      const valid = await verifyCredentialPassword(prisma, authedUser.id, body.currentPassword);
      if (!valid) {
        throw new HttpError({ message: 'Current password is incorrect' });
      }

      const password = await bcrypt.hash(body.newPassword, 12);
      await prisma.$transaction([
        prisma.user.update({ where: { id: authedUser.id }, data: { password } }),
        prisma.account.updateMany({
          where: { userId: authedUser.id, providerId: 'credential' },
          data: { password },
        }),
        prisma.session.deleteMany({
          where: { userId: authedUser.id, token: { not: bearer ?? '' } },
        }),
      ]);
      return { success: true };
    },
    {
      body: t.Object({
        currentPassword: t.String({ minLength: 1 }),
        newPassword: t.String({ minLength: 8, maxLength: 72 }),
      }),
      response: { 200: successSchema },
      detail: { summary: 'Change own dashboard password' },
    },
  )

  .post(
    '/logout',
    async ({ prisma, bearer }) => {
      if (bearer) await deleteSessionToken(prisma, bearer);
      return { success: true };
    },
    {
      response: { 200: successSchema },
      detail: { summary: 'Sign out of the dashboard' },
    },
  );
