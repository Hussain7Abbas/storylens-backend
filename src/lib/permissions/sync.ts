import type { PrismaClient } from '@prisma/client';
import { collectPermissions, defaultRoleSlugs, SYSTEM_ROLES } from './catalog';

type RouteLike = Parameters<typeof collectPermissions>[0][number];

export type PermissionSyncResult = {
  created: string[];
  removed: string[];
  total: number;
};

/**
 * Makes the Permission table match the API routes. New permissions go to the
 * system roles that `defaultRoleSlugs` names; existing grants are left as the
 * dashboard set them. Removed endpoints lose their permission rows, and the
 * super admin role is always given every admin permission.
 */
export async function syncPermissions(
  prisma: PrismaClient,
  routes: RouteLike[],
): Promise<PermissionSyncResult> {
  const definitions = collectPermissions(routes);
  const keys = definitions.map((definition) => definition.key);

  return prisma.$transaction(async (tx) => {
    const [existing, systemRoles] = await Promise.all([
      tx.permission.findMany({ select: { key: true } }),
      tx.role.findMany({
        where: { slug: { in: Object.values(SYSTEM_ROLES) } },
        select: { id: true, slug: true },
      }),
    ]);
    const existingKeys = new Set(existing.map((permission) => permission.key));
    const roleIdBySlug = new Map(systemRoles.map((role) => [role.slug, role.id]));
    const created: string[] = [];

    for (const definition of definitions) {
      if (existingKeys.has(definition.key)) {
        await tx.permission.update({
          where: { key: definition.key },
          data: {
            portal: definition.portal,
            group: definition.group,
            method: definition.method,
            path: definition.path,
            description: definition.description,
          },
        });
        continue;
      }

      const roleIds = defaultRoleSlugs(definition)
        .map((slug) => roleIdBySlug.get(slug))
        .filter((id): id is string => Boolean(id));

      await tx.permission.create({
        data: {
          ...definition,
          roles: { connect: roleIds.map((id) => ({ id })) },
        },
      });
      created.push(definition.key);
    }

    const stale = existing.map((permission) => permission.key).filter((key) => !keys.includes(key));
    if (stale.length > 0) {
      await tx.permission.deleteMany({ where: { key: { in: stale } } });
    }

    const superAdminId = roleIdBySlug.get(SYSTEM_ROLES.superAdmin);
    if (superAdminId) {
      const adminPermissions = await tx.permission.findMany({
        where: { portal: 'admin' },
        select: { id: true },
      });
      await tx.role.update({
        where: { id: superAdminId },
        data: { permissions: { set: adminPermissions } },
      });
    }

    return { created, removed: stale, total: definitions.length };
  }, { timeout: 60_000 });
}
