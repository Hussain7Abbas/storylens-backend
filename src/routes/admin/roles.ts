import type { Portal, Prisma, PrismaClient } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { authorize } from '@/middleware/authorize';
import { portalSchema, roleSchema } from '@/schemas/admin';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

const roleInclude = {
  permissions: { select: { id: true } },
  _count: { select: { readers: true, admins: true } },
} satisfies Prisma.RoleInclude;

type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function toRole({ permissions, _count, ...role }: RoleRow) {
  return {
    ...role,
    userCount: _count.readers + _count.admins,
    permissionIds: permissions.map((permission) => permission.id),
  };
}

function notFound(): never {
  throw new HttpError({ statusCode: 404, message: 'Role not found' });
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'role';
}

async function uniqueSlug(prisma: Pick<PrismaClient, 'role'>, name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await prisma.role.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** A role may only hold permissions of its own portal. */
async function assertPermissions(
  prisma: Pick<PrismaClient, 'permission'>,
  permissionIds: string[],
  portal: Portal,
): Promise<void> {
  const unique = [...new Set(permissionIds)];
  const count = await prisma.permission.count({ where: { id: { in: unique }, portal } });
  if (count !== unique.length) {
    throw new HttpError({ message: `Every permission must exist and belong to the ${portal} portal` });
  }
}

export const adminRoles = new Elysia({ prefix: '/roles', tags: ['Admin: Roles'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/',
    async ({ prisma, query }) => {
      const roles = await prisma.role.findMany({
        where: { portal: query.portal },
        include: roleInclude,
        orderBy: [{ portal: 'asc' }, { isSystem: 'desc' }, { name: 'asc' }],
      });
      return { data: roles.map(toRole) };
    },
    {
      query: t.Object({ portal: t.Optional(portalSchema) }),
      response: { 200: t.Object({ data: t.Array(roleSchema) }) },
      detail: { summary: 'List roles' },
    },
  )

  .get(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const role = await prisma.role.findUnique({ where: { id }, include: roleInclude });
      if (!role) notFound();
      return toRole(role);
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: roleSchema },
      detail: { summary: 'View a role' },
    },
  )

  .post(
    '/',
    async ({ prisma, body }) => {
      await assertPermissions(prisma, body.permissionIds, body.portal);
      const name = sanitize(body.name);

      const role = await prisma.role.create({
        data: {
          name,
          slug: await uniqueSlug(prisma, name),
          description: body.description ? sanitize(body.description) : null,
          portal: body.portal,
          permissions: { connect: body.permissionIds.map((id) => ({ id })) },
        },
        include: roleInclude,
      });
      return toRole(role);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 60 }),
        description: t.Optional(t.String({ maxLength: 300 })),
        portal: portalSchema,
        permissionIds: t.Array(t.String()),
      }),
      response: { 200: roleSchema },
      detail: { summary: 'Create a role' },
    },
  )

  .put(
    '/:id',
    async ({ prisma, params: { id }, body }) => {
      const existing = await prisma.role.findUnique({ where: { id } });
      if (!existing) notFound();

      if (body.permissionIds) {
        if (existing.slug === SYSTEM_ROLES.superAdmin) {
          throw new HttpError({ statusCode: 409, message: 'The super admin role always has every permission' });
        }
        await assertPermissions(prisma, body.permissionIds, existing.portal);
      }

      const role = await prisma.role.update({
        where: { id },
        data: {
          name: body.name ? sanitize(body.name) : undefined,
          description: body.description === undefined ? undefined : sanitize(body.description) || null,
          permissions: body.permissionIds
            ? { set: body.permissionIds.map((permissionId) => ({ id: permissionId })) }
            : undefined,
        },
        include: roleInclude,
      });
      return toRole(role);
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
        description: t.Optional(t.String({ maxLength: 300 })),
        permissionIds: t.Optional(t.Array(t.String())),
      }),
      response: { 200: roleSchema },
      detail: { summary: 'Update a role' },
    },
  )

  .delete(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const role = await prisma.role.findUnique({ where: { id }, include: roleInclude });
      if (!role) notFound();
      if (role.isSystem) {
        throw new HttpError({ statusCode: 409, message: 'System roles cannot be deleted' });
      }
      const userCount = role._count.readers + role._count.admins;
      if (userCount > 0) {
        throw new HttpError({
          statusCode: 409,
          message: `Move this role's ${userCount} user(s) to another role first`,
        });
      }

      await prisma.role.delete({ where: { id } });
      return toRole(role);
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: roleSchema },
      detail: { summary: 'Delete a role' },
    },
  );
