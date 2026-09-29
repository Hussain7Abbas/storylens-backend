import { describe, expect, it } from 'bun:test';
import {
  collectPermissions,
  defaultRoleSlugs,
  permissionKey,
  PUBLIC_ENDPOINTS,
  USER_ENDPOINT_DESCRIPTIONS,
} from '@/lib/permissions';
import { app } from '@/server';

const routes = app.routes.filter((route) => route.method !== 'OPTIONS' && route.method !== 'HEAD');
const routeKeys = new Set(routes.map((route) => permissionKey(route.method, route.path)));
const permissions = collectPermissions(app.routes);
const byKey = new Map(permissions.map((permission) => [permission.key, permission]));

// Infrastructure that is not part of either portal API.
const OUTSIDE_API = [/^\/$/, /^\/health\/(ready)?$/, /^\/auth\/\*$/, /^\/docs/, /^\/openapi\.json$/];

describe('permission catalog', () => {
  it('puts every API endpoint under /api/admin or /api/user', () => {
    const stray = routes
      .map((route) => route.path)
      .filter((path) => !path.startsWith('/api/admin/') && !path.startsWith('/api/user/'))
      .filter((path) => !OUTSIDE_API.some((pattern) => pattern.test(path)));
    expect(stray).toEqual([]);
  });

  it('has a permission for every endpoint that is not public', () => {
    const missing = [...routeKeys]
      .filter((key) => key.includes(' /api/'))
      .filter((key) => !PUBLIC_ENDPOINTS.has(key) && !byKey.has(key));
    expect(missing).toEqual([]);
  });

  it('describes every reader endpoint and every dashboard endpoint', () => {
    const undescribed = permissions
      .filter((permission) => permission.method)
      .filter((permission) =>
        permission.portal === 'user'
          ? !USER_ENDPOINT_DESCRIPTIONS[permission.key]
          : !routes.some(
              (route) =>
                permissionKey(route.method, route.path) === permission.key &&
                typeof (route.hooks as { detail?: { summary?: unknown } }).detail?.summary === 'string',
            ),
      )
      .map((permission) => permission.key);
    expect(undescribed).toEqual([]);
    expect(Object.keys(USER_ENDPOINT_DESCRIPTIONS).filter((key) => !routeKeys.has(key))).toEqual([]);
  });

  it('only lists public endpoints that exist', () => {
    expect([...PUBLIC_ENDPOINTS].filter((key) => !routeKeys.has(key))).toEqual([]);
  });

  it('keeps the dashboard without a registration endpoint', () => {
    expect([...routeKeys].filter((key) => key.includes('/api/admin/auth/register'))).toEqual([]);
    expect(routeKeys.has('POST /api/user/auth/register')).toBe(true);
  });

  it('gives admin permissions to the super admin only', () => {
    for (const permission of permissions.filter((item) => item.portal === 'admin')) {
      expect(defaultRoleSlugs(permission)).toEqual(['super-admin']);
    }
  });

  it('keeps the previous guest, reader and moderator defaults', () => {
    const roles = (key: string) => {
      const permission = byKey.get(key);
      if (!permission) throw new Error(`missing ${key}`);
      return defaultRoleSlugs(permission);
    };
    expect(roles('GET /api/user/novels/')).toEqual(['guest', 'reader', 'moderator']);
    expect(roles('PUT /api/user/auth/me')).toEqual(['guest', 'reader', 'moderator']);
    expect(roles('POST /api/user/keywords/')).toEqual(['reader', 'moderator']);
    expect(roles('POST /api/user/auth/change-password')).toEqual(['reader', 'moderator']);
    expect(roles('DELETE /api/user/novels/:id')).toEqual(['moderator']);
    expect(roles('GET /api/user/website-selectors/')).toEqual(['moderator']);
    expect(roles('user:moderate')).toEqual(['moderator']);
  });

  it('rejects signed-out calls to every protected endpoint', async () => {
    const protectedRoutes = routes.filter((route) => byKey.has(permissionKey(route.method, route.path)));
    const statuses = await Promise.all(
      protectedRoutes.map(async (route) => {
        const path = route.path.replace(/:[^/]+/g, '00000000-0000-4000-8000-000000000000');
        const response = await app.handle(new Request(`http://localhost${path}`, { method: route.method }));
        return `${route.method} ${route.path} ${response.status}`;
      }),
    );
    expect(statuses.filter((line) => !line.endsWith(' 401'))).toEqual([]);
  });
});
