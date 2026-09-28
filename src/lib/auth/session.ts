import type { Portal, Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Load a user with this to build its `AuthUserPayload`. */
export const authUserInclude = {
  role: {
    select: {
      id: true,
      slug: true,
      name: true,
      permissions: { select: { key: true } },
    },
  },
} satisfies Prisma.UserInclude;

export type UserWithAccess = Prisma.UserGetPayload<{ include: typeof authUserInclude }>;

export type AuthUserPayload = {
  id: string;
  email: string;
  username: string;
  name: string;
  portal: Portal;
  isGuest: boolean;
  role: { id: string; slug: string; name: string } | null;
  /** Permission keys granted by the role, e.g. `GET /api/user/novels/`. */
  permissions: string[];
};

export function toAuthUser(user: UserWithAccess): AuthUserPayload {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    portal: user.portal,
    isGuest: user.isGuest,
    role: user.role ? { id: user.role.id, slug: user.role.slug, name: user.role.name } : null,
    permissions: user.role?.permissions.map((permission) => permission.key) ?? [],
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
): Promise<UserWithAccess | null> {
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: authUserInclude } },
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

export async function deleteSessionToken(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}
