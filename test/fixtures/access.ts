// Shared role fixtures for the mocked-Prisma account tests. The accounts module
// is mounted without the `/api/user` prefix there, so route keys start at `/auth`.
const guestKeys = ['GET /auth/me', 'PUT /auth/me', 'POST /auth/logout', 'GET /auth/check-username/:username'];
const readerKeys = [
  ...guestKeys,
  'POST /auth/change-password',
  'POST /auth/change-password/verify',
  'POST /auth/change-email',
  'POST /auth/change-email/verify',
];

type RoleFixture = { id: string; slug: string; name: string; permissions: { key: string }[] };

export const roles: Record<string, RoleFixture> = {
  'role-guest': { id: 'role-guest', slug: 'guest', name: 'Guest', permissions: guestKeys.map((key) => ({ key })) },
  'role-reader': { id: 'role-reader', slug: 'reader', name: 'Reader', permissions: readerKeys.map((key) => ({ key })) },
  'role-moderator': {
    id: 'role-moderator',
    slug: 'moderator',
    name: 'Moderator',
    permissions: [...readerKeys, 'user:moderate'].map((key) => ({ key })),
  },
};

export const fakeRoles = {
  findUnique: async ({ where }: { where: { slug?: string; id?: string } }) =>
    Object.values(roles).find((role) => role.slug === where.slug || role.id === where.id) ?? null,
};

/** Attaches the role relation that `authUserInclude` loads. */
export function withRole<T extends { roleId?: string | null }>(row: T): T & { role: RoleFixture | null } {
  return Object.assign(row, { role: row.roleId ? (roles[row.roleId] ?? null) : null });
}

/** The `currentUser` that the real setup derives for a row. */
export function sessionUser(row: {
  id: string;
  email: string;
  username: string;
  name: string;
  portal?: 'admin' | 'user';
  isGuest?: boolean;
  roleId?: string | null;
}) {
  const role = row.roleId ? roles[row.roleId] : undefined;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    name: row.name,
    portal: row.portal ?? 'user',
    isGuest: row.isGuest ?? false,
    role: role ? { id: role.id, slug: role.slug, name: role.name } : null,
    permissions: role?.permissions.map((permission) => permission.key) ?? [],
  };
}
