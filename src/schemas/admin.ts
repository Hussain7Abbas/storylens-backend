import { t } from 'elysia';

export const portalSchema = t.Union([t.Literal('admin'), t.Literal('user')]);

/** Flat `?page=&pageSize=&search=` query used by dashboard lists. */
export const adminListQuery = {
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  search: t.Optional(t.String({ maxLength: 200 })),
};

export function pageArgs(query: { page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export const roleSummarySchema = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
});

export const authUserSchema = t.Object({
  id: t.String(),
  email: t.String(),
  username: t.String(),
  name: t.String(),
  isGuest: t.Boolean(),
  isUser: t.Boolean(),
  isAdmin: t.Boolean(),
  portal: portalSchema,
  role: t.Nullable(roleSummarySchema),
  permissions: t.Array(t.String()),
});

export const sessionResponseSchema = t.Object({
  user: authUserSchema,
  token: t.String(),
});

export const adminUserSchema = t.Object({
  id: t.String(),
  email: t.String(),
  emailVerified: t.Boolean(),
  username: t.String(),
  name: t.String(),
  image: t.Nullable(t.String()),
  isGuest: t.Boolean(),
  isUser: t.Boolean(),
  lensBalance: t.Number(),
  userRoleId: t.Nullable(t.String()),
  userRole: t.Nullable(roleSummarySchema),
  isAdmin: t.Boolean(),
  adminRoleId: t.Nullable(t.String()),
  adminRole: t.Nullable(roleSummarySchema),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const permissionSchema = t.Object({
  id: t.String(),
  key: t.String(),
  portal: portalSchema,
  group: t.String(),
  method: t.Nullable(t.String()),
  path: t.Nullable(t.String()),
  description: t.Nullable(t.String()),
});

export const roleSchema = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
  portal: portalSchema,
  isSystem: t.Boolean(),
  createdAt: t.Date(),
  updatedAt: t.Date(),
  userCount: t.Number(),
  permissionIds: t.Array(t.String()),
});

export const successSchema = t.Object({ success: t.Boolean() });
