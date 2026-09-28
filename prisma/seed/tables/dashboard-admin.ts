import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '@/env';
import { SYSTEM_ROLES, systemRoleId } from '@/lib/permissions';

/**
 * Makes `DASHBOARD_ADMIN_EMAIL` a dashboard super admin (the only seeded
 * dashboard access). An existing account with that email keeps its reader
 * access and gains dashboard access; its password is left alone unless the
 * account is dashboard-only, which this resets. A new account is created
 * with `DASHBOARD_ADMIN_USERNAME` and `DASHBOARD_ADMIN_PASSWORD`.
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

  const adminRoleId = await systemRoleId(prisma, SYSTEM_ROLES.superAdmin);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isUser: true },
  });

  if (existing) {
    const resetPassword = !existing.isUser;
    const hashedPassword = resetPassword ? await bcrypt.hash(password, 12) : undefined;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: { isAdmin: true, adminRoleId, isGuest: false, emailVerified: true, password: hashedPassword },
      }),
      prisma.account.updateMany({
        where: { userId: existing.id, providerId: 'credential' },
        data: { password: hashedPassword },
      }),
    ]);
    console.log(
      '🌱',
      resetPassword
        ? `Reset dashboard-only account ${email}`
        : `Granted dashboard access to ${email}; it keeps its current password`,
    );
    return;
  }

  const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (taken) {
    throw new Error(`Username ${username} belongs to another account; choose another DASHBOARD_ADMIN_USERNAME`);
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      email,
      username,
      name: 'Super Admin',
      password: hashedPassword,
      emailVerified: true,
      isGuest: false,
      isUser: false,
      isAdmin: true,
      adminRoleId,
      accounts: {
        create: { accountId: email, providerId: 'credential', password: hashedPassword },
      },
    },
  });
}
