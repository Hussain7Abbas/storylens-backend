import type { PrismaClient, User } from '@prisma/client';
import bcrypt from 'bcryptjs';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUserPayload = Pick<
  User,
  'id' | 'email' | 'username' | 'name' | 'role'
>;

export function toAuthUser(user: User): AuthUserPayload {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    role: user.role,
  };
}

export async function createCredentialAccount(
  prisma: PrismaClient,
  userId: string,
  email: string,
  plainPassword: string,
): Promise<void> {
  const hashedPassword = await bcrypt.hash(plainPassword, 12);

  await prisma.account.create({
    data: {
      accountId: email,
      providerId: 'credential',
      userId,
      password: hashedPassword,
    },
  });
}

export async function createSessionToken(
  prisma: PrismaClient,
  userId: string,
): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      token,
      expiresAt,
      userId,
    },
  });

  return token;
}

export async function getUserFromBearerToken(
  prisma: PrismaClient,
  token: string | undefined,
): Promise<User | null> {
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date()) {
    return null;
  }

  return session.user;
}

export async function verifyCredentialPassword(
  prisma: PrismaClient,
  userId: string,
  plainPassword: string,
): Promise<boolean> {
  const account = await prisma.account.findFirst({
    where: {
      userId,
      providerId: 'credential',
    },
  });

  if (account?.password) {
    return bcrypt.compare(plainPassword, account.password);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return false;
  }

  return bcrypt.compare(plainPassword, user.password);
}
