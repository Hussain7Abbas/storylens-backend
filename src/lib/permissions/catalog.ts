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

/**
 * Descriptions shown in the dashboard's role editor for reader endpoints.
 * Dashboard endpoints use their route's `detail.summary` instead.
 */
export const USER_ENDPOINT_DESCRIPTIONS: Record<string, string> = {
  'GET /api/user/auth/me': 'View own profile',
  'PUT /api/user/auth/me': 'Update own username and display name',
  'POST /api/user/auth/logout': 'Sign out',
  'GET /api/user/auth/check-username/:username': 'Check whether a username is free',
  'POST /api/user/auth/change-password': 'Request a password change code',
  'POST /api/user/auth/change-password/verify': 'Confirm a password change',
  'POST /api/user/auth/change-email': 'Request an email change code',
  'POST /api/user/auth/change-email/verify': 'Confirm an email change',
  'POST /api/user/ai/chapter-selectors': 'Detect chapter selectors with AI',
  'GET /api/user/novels/': 'List novels',
  'GET /api/user/novels/:id': 'View a novel with its chapters',
  'POST /api/user/novels/': 'Add a novel',
  'PUT /api/user/novels/:id': 'Update a novel (readers: slugs, an empty context and missing name translations)',
  'PUT /api/user/novels/:id/context': 'Set a novel’s AI context (readers: only while empty)',
  'DELETE /api/user/novels/:id': 'Delete a novel',
  'GET /api/user/chapters/novel/:novelId': 'List a novel’s chapters',
  'GET /api/user/chapters/:id': 'View a chapter',
  'POST /api/user/chapters/': 'Add a chapter',
  'PUT /api/user/chapters/:id': 'Update a chapter',
  'DELETE /api/user/chapters/:id': 'Delete a chapter',
  'GET /api/user/keywords/': 'List keywords',
  'GET /api/user/keywords/:id': 'View a keyword',
  'POST /api/user/keywords/': 'Add a keyword',
  'PUT /api/user/keywords/:id': 'Update a keyword (readers: own only)',
  'DELETE /api/user/keywords/:id': 'Delete a keyword (readers: own only)',
  'GET /api/user/keyword-aliases/': 'List keyword aliases',
  'POST /api/user/keyword-aliases/': 'Add a keyword alias',
  'PUT /api/user/keyword-aliases/:id': 'Update a keyword alias (readers: aliases they added or on their keywords)',
  'DELETE /api/user/keyword-aliases/:id': 'Delete a keyword alias (readers: aliases they added or on their keywords)',
  'GET /api/user/keyword-versions/': 'List keyword versions',
  'POST /api/user/keyword-versions/': 'Add a keyword version',
  'PUT /api/user/keyword-versions/:id': 'Update a keyword version (readers: versions they added or on their keywords)',
  'DELETE /api/user/keyword-versions/:id': 'Delete a keyword version (readers: versions they added or on their keywords)',
  'GET /api/user/sync/protocol': 'Read the sync protocol version',
  'GET /api/user/sync/novels/:id/changes': "Read a novel's changes since a sync cursor",
  'GET /api/user/sync/lookups/changes': 'Read category and nature changes since a sync cursor',
  'GET /api/user/sync/catalogue/changes': 'Read novel catalogue changes since a sync cursor',
  'GET /api/user/keywords-chapters/:id': 'View a keyword–chapter link',
  'GET /api/user/keywords-chapters/chapter/:chapterId': 'List keywords linked to a chapter',
  'GET /api/user/keywords-chapters/keyword/:keywordId': 'List chapters linked to a keyword',
  'POST /api/user/keywords-chapters/': 'Link a keyword to a chapter',
  'DELETE /api/user/keywords-chapters/:id': 'Unlink a keyword from a chapter',
  'GET /api/user/replacements/': 'List replacements',
  'GET /api/user/replacements/:id': 'View a replacement',
  'POST /api/user/replacements/': 'Add a replacement',
  'PUT /api/user/replacements/:id': 'Update a replacement (readers: own only)',
  'DELETE /api/user/replacements/:id': 'Delete a replacement (readers: own only)',
  'GET /api/user/keyword-categories/': 'List keyword categories',
  'GET /api/user/keyword-categories/:id': 'View a keyword category',
  'POST /api/user/keyword-categories/': 'Add a keyword category',
  'PUT /api/user/keyword-categories/:id': 'Update a keyword category',
  'DELETE /api/user/keyword-categories/:id': 'Delete a keyword category',
  'GET /api/user/keyword-natures/': 'List keyword natures',
  'GET /api/user/keyword-natures/:id': 'View a keyword nature',
  'POST /api/user/keyword-natures/': 'Add a keyword nature',
  'PUT /api/user/keyword-natures/:id': 'Update a keyword nature',
  'DELETE /api/user/keyword-natures/:id': 'Delete a keyword nature',
  'GET /api/user/website-selectors/': 'List website selectors',
  'GET /api/user/website-selectors/:website': 'Look up a website’s chapter selectors',
  'POST /api/user/website-selectors/': 'Add website selectors',
  'PUT /api/user/website-selectors/:website': 'Update website selectors',
  'DELETE /api/user/website-selectors/:website': 'Delete website selectors',
  'GET /api/user/website-novel-biases/': 'List website novel biases',
  'POST /api/user/website-novel-biases/': 'Set a website novel bias',
  'DELETE /api/user/website-novel-biases/:id': 'Delete a website novel bias',
  'POST /api/user/files/upload': 'Upload an image or video',
};

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

function describe(key: string, method: string, rest: string[], summary: string | undefined): string {
  if (summary) return summary;
  const known = USER_ENDPOINT_DESCRIPTIONS[key];
  if (known) return known;

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
      description: describe(key, method, rest, routeSummary(route)),
    });
  }

  for (const { level: _level, ...capability } of CAPABILITY_DEFINITIONS) {
    byKey.set(capability.key, capability);
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
