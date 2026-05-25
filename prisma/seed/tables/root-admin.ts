import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createCredentialAccount } from '@/lib/auth/session';
import { env } from '@/env';

export async function seedRootAdmin(prisma: PrismaClient) {
  console.log('🌱', 'Seeding root admin');

  const username = env.ROOT_USERNAME;
  const password = env.ROOT_PASSWORD;
  const email = env.ROOT_EMAIL;

  if (!username || !password || !email) {
    throw new Error('ROOT_USERNAME, ROOT_PASSWORD, and ROOT_EMAIL must be set');
  }

  const hashedPassword = bcrypt.hashSync(password, 12);

  const user = await prisma.user.upsert({
    where: { username },
    update: {
      role: 'admin',
      email,
      password: hashedPassword,
      emailVerified: true,
    },
    create: {
      email,
      username,
      password: hashedPassword,
      name: 'Root Admin',
      role: 'admin',
      emailVerified: true,
    },
  });

  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  });

  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: {
        accountId: email,
        password: hashedPassword,
      },
    });
    return;
  }

  await createCredentialAccount(prisma, user.id, email, password);
}
