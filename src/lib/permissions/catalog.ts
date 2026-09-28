import type { Portal } from '@prisma/client';

export const PORTAL_PREFIX: Record<Portal, string> = {
  admin: '/api/admin',
  user: '/api/user',
};

/** Slugs of the roles created by migrations; the API depends on them. */
export const SYSTEM_ROLES = {
  superAdmin: 'super-admin',
  guest: 'guest',
  reader: 'reader',
  moderator: 'moderator',
} as const;

/** Default user-portal access level, from least to most privileged. */
export type AccessLevel = 'guest' | 'reader' | 'moderator';

const ROLES_BY_LEVEL: Record<AccessLevel, string[]> = {
  guest: [SYSTEM_ROLES.guest, SYSTEM_ROLES.reader, SYSTEM_ROLES.moderator],
  reader: [SYSTEM_ROLES.reader, SYSTEM_ROLES.moderator],
  moderator: [SYSTEM_ROLES.moderator],
};

export type PermissionDefinition = {
  key: string;
  portal: Portal;
  group: string;
  method: string | null;
  path: string | null;
  description: string;
};

/**
 * Permissions that are not an endpoint but change what an endpoint allows.
 * `user:moderate` replaces the old admin role inside user-portal routes.
 */
export const CAPABILITIES = {
  moderate: 'user:moderate',
} as const;

const CAPABILITY_DEFINITIONS: Array<PermissionDefinition & { level: AccessLevel }> = [
  {
    key: CAPABILITIES.moderate,
    portal: 'user',
    group: 'moderation',
    method: null,
    path: null,
    description:
      "Moderate shared data: edit or delete other readers' keywords and replacements, set version chapter ranges, rename novels and replace a filled novel context.",
    level: 'moderator',
  },
];

export function permissionKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Endpoints anyone may call, including signed-out visitors. */
export const PUBLIC_ENDPOINTS = new Set<string>([
  'POST /api/user/auth/guest',
  'POST /api/user/auth/register',
  'POST /api/user/auth/register/verify',
  'POST /api/user/auth/login',
  'GET /api/user/auth/providers',
  'POST /api/user/auth/oauth/session',
  'POST /api/admin/auth/login',
]);

/** User-portal writes a guest may make (everything else that writes needs a reader). */
const GUEST_WRITES = new Set<string>([
  'PUT /api/user/auth/me',
  'POST /api/user/auth/logout',
  'POST /api/user/ai/chapter-selectors',
]);

/** User-portal endpoints that only moderators get by default (the old admin guard). */
const MODERATOR_ENDPOINTS = new Set<string>([
  'DELETE /api/user/novels/:id',
  'POST /api/user/chapters/',
  'PUT /api/user/chapters/:id',
  'DELETE /api/user/chapters/:id',
  'POST /api/user/keyword-categories/',
  'PUT /api/user/keyword-categories/:id',
  'DELETE /api/user/keyword-categories/:id',
  'POST /api/user/keyword-natures/',
  'PUT /api/user/keyword-natures/:id',
  'DELETE /api/user/keyword-natures/:id',
  'POST /api/user/keywords-chapters/',
  'DELETE /api/user/keywords-chapters/:id',
  'POST /api/user/website-novel-biases/',
  'DELETE /api/user/website-novel-biases/:id',
  'GET /api/user/website-selectors/',
  'POST /api/user/website-selectors/',
  'PUT /api/user/website-selectors/:website',
  'DELETE /api/user/website-selectors/:website',
]);

export function portalOf(path: string): Portal | null {
  if (path === PORTAL_PREFIX.admin || path.startsWith(`${PORTAL_PREFIX.admin}/`)) return 'admin';
  if (path === PORTAL_PREFIX.user || path.startsWith(`${PORTAL_PREFIX.user}/`)) return 'user';
  return null;
}

/** Access level that the system roles get for a new user-portal permission. */
export function defaultAccessLevel(key: string, method: string): AccessLevel {
  if (MODERATOR_ENDPOINTS.has(key)) return 'moderator';
  if (method === 'GET' || GUEST_WRITES.has(key)) return 'guest';
  return 'reader';
}

/** System roles that receive a permission when it first appears. */
export function defaultRoleSlugs(permission: Pick<PermissionDefinition, 'key' | 'portal' | 'method'>): string[] {
  if (permission.portal === 'admin') return [SYSTEM_ROLES.superAdmin];

  const capability = CAPABILITY_DEFINITIONS.find((item) => item.key === permission.key);
  if (capability) return ROLES_BY_LEVEL[capability.level];

  return ROLES_BY_LEVEL[defaultAccessLevel(permission.key, permission.method ?? 'GET')];
}

const METHOD_VERBS: Record<string, string> = {
  GET: 'View',
  POST: 'Create',
  PUT: 'Update',
  PATCH: 'Update',
  DELETE: 'Delete',
};

function humanize(segment: string): string {
  return segment.replace(/^:/, 'by ').replace(/-/g, ' ');
}

function describe(method: string, rest: string[], summary: string | undefined): string {
  if (summary) return summary;

  const verb = METHOD_VERBS[method] ?? method;
  const [group, ...tail] = rest;
  const words = [humanize(group ?? 'root'), ...tail.map(humanize)].join(' › ');
  return `${verb} ${words}`;
}

type RouteLike = {
  method: string;
  path: string;
  hooks?: { detail?: { summary?: string; hide?: boolean } } | Record<string, unknown>;
};

function routeSummary(route: RouteLike): string | undefined {
  const detail = (route.hooks as { detail?: { summary?: unknown } } | undefined)?.detail;
  return typeof detail?.summary === 'string' ? detail.summary : undefined;
}

/**
 * Every permission the API needs: one per `/api/{portal}` endpoint that is not
 * public, plus the capability keys.
 */
export function collectPermissions(routes: RouteLike[]): PermissionDefinition[] {
  const byKey = new Map<string, PermissionDefinition>();

  for (const route of routes) {
    const method = route.method.toUpperCase();
    if (method === 'OPTIONS' || method === 'HEAD') continue;

    const portal = portalOf(route.path);
    if (!portal) continue;

    const key = permissionKey(method, route.path);
    if (PUBLIC_ENDPOINTS.has(key)) continue;

    const rest = route.path
      .slice(PORTAL_PREFIX[portal].length)
      .split('/')
      .filter(Boolean);

    byKey.set(key, {
      key,
      portal,
      group: rest[0] ?? 'root',
      method,
      path: route.path,
      description: describe(method, rest, routeSummary(route)),
    });
  }

  for (const { level: _level, ...capability } of CAPABILITY_DEFINITIONS) {
    byKey.set(capability.key, capability);
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
