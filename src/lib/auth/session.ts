import type { Portal, Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const roleWithPermissions = {
  select: {
    id: true,
    slug: true,
    name: true,
    permissions: { select: { key: true } },
  },
} as const;

/** Load a user with this to build its `AuthUserPayload`. */
export const authUserInclude = {
  userRole: roleWithPermissions,
  adminRole: roleWithPermissions,
} satisfies Prisma.UserInclude;

export type UserWithAccess = Prisma.UserGetPayload<{ include: typeof authUserInclude }>;

export type AuthUserPayload = {
  id: string;
  email: string;
  username: string;
  name: string;
  isGuest: boolean;
  /** May use the reader API (`/api/user`). */
  isUser: boolean;
  /** May use the dashboard API (`/api/admin`). */
  isAdmin: boolean;
  /** The API this payload (and its session) is for. */
  portal: Portal;
  /** The account's role on `portal`. */
  role: { id: string; slug: string; name: string } | null;
  /** Permission keys that role grants, e.g. `GET /api/user/novels/`. */
  permissions: string[];
};

export function hasPortalAccess(user: Pick<UserWithAccess, 'isUser' | 'isAdmin'>, portal: Portal): boolean {
  return portal === 'admin' ? user.isAdmin : user.isUser;
}

/** The user as seen by one API: that portal's role and permissions only. */
export function toAuthUser(user: UserWithAccess, portal: Portal): AuthUserPayload {
  const role = hasPortalAccess(user, portal)
    ? portal === 'admin'
      ? user.adminRole
      : user.userRole
    : null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    isGuest: user.isGuest,
    isUser: user.isUser,
    isAdmin: user.isAdmin,
    portal,
    role: role ? { id: role.id, slug: role.slug, name: role.name } : null,
    permissions: role?.permissions.map((permission) => permission.key) ?? [],
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

/** Issues a bearer token that only `portal`'s API accepts. */
export async function createSessionToken(
  prisma: PrismaClient,
  userId: string,
  portal: Portal,
): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      token,
      expiresAt,
      userId,
      portal,
    },
  });

  return token;
}

export type BearerSession = { user: UserWithAccess; portal: Portal };

export async function getSessionFromBearerToken(
  prisma: PrismaClient,
  token: string | undefined,
): Promise<BearerSession | null> {
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

  return { user: session.user, portal: session.portal };
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
