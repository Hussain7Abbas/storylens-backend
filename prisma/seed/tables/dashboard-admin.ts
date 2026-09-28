import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '@/env';
import { SYSTEM_ROLES, systemRoleId } from '@/lib/permissions';

/**
 * Creates or resets the dashboard's super admin (the only seeded account).
 * Other dashboard accounts are created from the dashboard itself.
 */
export async function seedDashboardAdmin(prisma: PrismaClient) {
  console.log('🌱', 'Seeding dashboard super admin');

  const username = env.DASHBOARD_ADMIN_USERNAME;
  const password = env.DASHBOARD_ADMIN_PASSWORD;
  const email = env.DASHBOARD_ADMIN_EMAIL?.toLowerCase();

  if (!username || !password || !email) {
    throw new Error(
      'DASHBOARD_ADMIN_USERNAME, DASHBOARD_ADMIN_PASSWORD, and DASHBOARD_ADMIN_EMAIL must be set',
    );
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { id: true, portal: true },
  });
  if (existing && existing.portal !== 'admin') {
    throw new Error(
      `A reader account already uses ${email} or ${username}; choose another dashboard email and username`,
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const roleId = await systemRoleId(prisma, SYSTEM_ROLES.superAdmin);
  const data = {
    email,
    username,
    password: hashedPassword,
    emailVerified: true,
    portal: 'admin' as const,
    isGuest: false,
    roleId,
  };

  await prisma.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data })
      : await tx.user.create({ data: { ...data, name: 'Super Admin' } });

    const account = await tx.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
    });
    if (account) {
      await tx.account.update({
        where: { id: account.id },
        data: { accountId: email, password: hashedPassword },
      });
    } else {
      await tx.account.create({
        data: { accountId: email, providerId: 'credential', userId: user.id, password: hashedPassword },
      });
    }
  });
}
