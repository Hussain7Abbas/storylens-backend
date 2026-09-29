import type { PrismaClient } from '@prisma/client';
import { HttpError } from '@/utils/errors';

export * from './catalog';
export { syncPermissions, type PermissionSyncResult } from './sync';

type RoleLookup = Pick<PrismaClient, 'role'>;

/** Id of a system role; migrations create them, so a missing one is a server error. */
export async function systemRoleId(prisma: RoleLookup, slug: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { slug }, select: { id: true } });
  if (!role) {
    throw new HttpError({ statusCode: 500, message: `System role "${slug}" is missing` });
  }
  return role.id;
}
