import type { Portal, Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Elysia, t } from 'elysia';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { authorize } from '@/middleware/authorize';
import { adminListQuery, adminUserSchema, pageArgs, portalSchema, successSchema } from '@/schemas/admin';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

const roleSummary = { select: { id: true, slug: true, name: true } } as const;

const userSelect = {
  id: true,
  email: true,
  emailVerified: true,
  username: true,
  name: true,
  image: true,
  isGuest: true,
  isUser: true,
  userRoleId: true,
  userRole: roleSummary,
  isAdmin: true,
  adminRoleId: true,
  adminRole: roleSummary,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type Db = Pick<PrismaClient, 'user' | 'role'>;

/** Which APIs an account may use, and its role on each. */
type Access = {
  isUser: boolean;
  userRoleId: string | null;
  isAdmin: boolean;
  adminRoleId: string | null;
};

function notFound(): never {
  throw new HttpError({ statusCode: 404, message: 'User not found' });
}

async function assertRoleForPortal(prisma: Db, roleId: string, portal: Portal): Promise<void> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { portal: true } });
  if (!role) {
    throw new HttpError({ statusCode: 404, message: 'Role not found' });
  }
  if (role.portal !== portal) {
    throw new HttpError({
      message: portal === 'admin' ? 'Choose a dashboard role for dashboard access' : 'Choose a reader role for reader access',
    });
  }
}

/** Every account uses at least one API, with a role of that API's portal. */
async function assertAccess(prisma: Db, access: Access): Promise<void> {
  if (!access.isUser && !access.isAdmin) {
    throw new HttpError({ message: 'Give the account reader access, dashboard access, or both' });
  }
  if (access.isUser) {
    if (!access.userRoleId) throw new HttpError({ message: 'Reader access needs a reader role' });
    await assertRoleForPortal(prisma, access.userRoleId, 'user');
  }
  if (access.isAdmin) {
    if (!access.adminRoleId) throw new HttpError({ message: 'Dashboard access needs a dashboard role' });
    await assertRoleForPortal(prisma, access.adminRoleId, 'admin');
  }
}

async function assertUnique(
  prisma: Db,
  { email, username }: { email?: string; username?: string },
  userId?: string,
): Promise<void> {
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing && existing.id !== userId) {
      throw new HttpError({ statusCode: 409, message: 'Email already registered' });
    }
  }
  if (username) {
    const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (existing && existing.id !== userId) {
      throw new HttpError({ statusCode: 409, message: 'Username already taken' });
    }
  }
}

/** The dashboard must always keep one super admin who can sign in. */
async function assertKeepsSuperAdmin(prisma: Db, userId: string, next: Access | null): Promise<void> {
  const superAdminId = (await prisma.role.findUnique({ where: { slug: SYSTEM_ROLES.superAdmin }, select: { id: true } }))?.id;
  if (!superAdminId) return;

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, adminRoleId: true },
  });
  const isSuperAdmin = current?.isAdmin && current.adminRoleId === superAdminId;
  const staysSuperAdmin = next?.isAdmin && next.adminRoleId === superAdminId;
  if (!isSuperAdmin || staysSuperAdmin) return;

  const superAdmins = await prisma.user.count({ where: { isAdmin: true, adminRoleId: superAdminId } });
  if (superAdmins <= 1) {
    throw new HttpError({ statusCode: 409, message: 'The last super admin cannot be removed' });
  }
}

const accessBody = {
  isUser: t.Boolean(),
  userRoleId: t.Optional(t.Nullable(t.String())),
  isAdmin: t.Boolean(),
  adminRoleId: t.Optional(t.Nullable(t.String())),
};

export const adminUsers = new Elysia({ prefix: '/users', tags: ['Admin: Users'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/',
    async ({ prisma, query }) => {
      const search = query.search?.trim();
      const where: Prisma.UserWhereInput = {
        AND: [
          query.access === 'admin' ? { isAdmin: true } : {},
          query.access === 'user' ? { isUser: true } : {},
          query.roleId ? { OR: [{ userRoleId: query.roleId }, { adminRoleId: query.roleId }] } : {},
          query.guests === undefined ? {} : { isGuest: query.guests },
          search
            ? {
                OR: [
                  { email: { contains: search, mode: 'insensitive' } },
                  { username: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      };

      const [data, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: userSelect,
          orderBy: { createdAt: 'desc' },
          ...pageArgs(query),
        }),
        prisma.user.count({ where }),
      ]);
      return { data, total };
    },
    {
      query: t.Object({
        ...adminListQuery,
        access: t.Optional(portalSchema),
        roleId: t.Optional(t.String()),
        guests: t.Optional(t.BooleanString()),
      }),
      response: { 200: t.Object({ data: t.Array(adminUserSchema), total: t.Number() }) },
      detail: { summary: 'List users' },
    },
  )

  .get(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
      if (!user) notFound();
      return user;
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: adminUserSchema },
      detail: { summary: 'View a user' },
    },
  )

  // The only way to grant dashboard access to a new account; reader-only
  // accounts may also be created here, already verified.
  .post(
    '/',
    async ({ prisma, body }) => {
      const email = sanitize(body.email).toLowerCase();
      const username = sanitize(body.username);
      const access: Access = {
        isUser: body.isUser,
        userRoleId: body.isUser ? (body.userRoleId ?? null) : null,
        isAdmin: body.isAdmin,
        adminRoleId: body.isAdmin ? (body.adminRoleId ?? null) : null,
      };
      await assertUnique(prisma, { email, username });
      await assertAccess(prisma, access);

      const password = await bcrypt.hash(body.password, 12);
      return prisma.user.create({
        data: {
          email,
          username,
          name: sanitize(body.name),
          password,
          emailVerified: true,
          isGuest: false,
          ...access,
          accounts: {
            create: { accountId: email, providerId: 'credential', password },
          },
        },
        select: userSelect,
      });
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        username: t.String({ minLength: 3, maxLength: 30 }),
        name: t.String({ minLength: 1, maxLength: 100 }),
        password: t.String({ minLength: 8, maxLength: 72 }),
        ...accessBody,
      }),
      response: { 200: adminUserSchema },
      detail: { summary: 'Create a user' },
    },
  )

  .put(
    '/:id',
    async ({ prisma, authedUser, params: { id }, body }) => {
      const existing = await prisma.user.findUnique({ where: { id } });
      if (!existing) notFound();

      const isUser = body.isUser ?? existing.isUser;
      const isAdmin = body.isAdmin ?? existing.isAdmin;
      const access: Access = {
        isUser,
        userRoleId: isUser ? (body.userRoleId === undefined ? existing.userRoleId : body.userRoleId) : null,
        isAdmin,
        adminRoleId: isAdmin ? (body.adminRoleId === undefined ? existing.adminRoleId : body.adminRoleId) : null,
      };

      const adminAccessChanged = access.isAdmin !== existing.isAdmin || access.adminRoleId !== existing.adminRoleId;
      if (adminAccessChanged && id === authedUser.id) {
        throw new HttpError({ statusCode: 409, message: 'You cannot change your own dashboard access or role' });
      }
      await assertAccess(prisma, access);
      if (adminAccessChanged) await assertKeepsSuperAdmin(prisma, id, access);

      const email = body.email ? sanitize(body.email).toLowerCase() : undefined;
      const username = body.username ? sanitize(body.username) : undefined;
      await assertUnique(prisma, { email, username }, id);

      const password = body.password ? await bcrypt.hash(body.password, 12) : undefined;

      const [user] = await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: {
            email,
            username,
            name: body.name ? sanitize(body.name) : undefined,
            password,
            ...access,
            // Dashboard access or a password makes an anonymous install a real account.
            isGuest: access.isAdmin || password ? false : undefined,
          },
          select: userSelect,
        }),
        prisma.account.updateMany({
          where: { userId: id, providerId: 'credential' },
          data: { accountId: email, password },
        }),
        // A new password ends every session of the account. Access changes
        // apply at once without this: each request re-checks access and role.
        prisma.session.deleteMany({
          where: password ? { userId: id } : { id: '' },
        }),
      ]);
      return user;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        email: t.Optional(t.String({ format: 'email' })),
        username: t.Optional(t.String({ minLength: 3, maxLength: 30 })),
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        password: t.Optional(t.String({ minLength: 8, maxLength: 72 })),
        isUser: t.Optional(t.Boolean()),
        userRoleId: t.Optional(t.Nullable(t.String())),
        isAdmin: t.Optional(t.Boolean()),
        adminRoleId: t.Optional(t.Nullable(t.String())),
      }),
      response: { 200: adminUserSchema },
      detail: { summary: 'Update a user' },
    },
  )

  .delete(
    '/:id/sessions',
    async ({ prisma, params: { id } }) => {
      await prisma.session.deleteMany({ where: { userId: id } });
      return { success: true };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: successSchema },
      detail: { summary: 'Sign a user out everywhere' },
    },
  )

  .delete(
    '/:id',
    async ({ prisma, authedUser, params: { id } }) => {
      if (id === authedUser.id) {
        throw new HttpError({ statusCode: 409, message: 'You cannot delete your own account' });
      }
      const user = await prisma.user.findUnique({ where: { id }, select: userSelect });
      if (!user) notFound();
      await assertKeepsSuperAdmin(prisma, id, null);

      await prisma.user.delete({ where: { id } });
      return user;
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: adminUserSchema },
      detail: { summary: 'Delete a user' },
    },
  );
