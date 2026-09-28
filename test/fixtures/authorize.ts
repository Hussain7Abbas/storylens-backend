import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { HttpError } from '@/utils/errors';

type SessionUser = { id: string; portal: 'admin' | 'user'; isUser: boolean; isAdmin: boolean; permissions: string[] };
const sessions: Record<string, SessionUser> = {
  reader: { id: 'reader', portal: 'user', isUser: true, isAdmin: false, permissions: ['GET /api/user/things/:id'] },
  moderator: {
    id: 'moderator',
    portal: 'user',
    isUser: true,
    isAdmin: false,
    permissions: ['GET /api/user/things/:id', 'user:moderate'],
  },
  admin: { id: 'admin', portal: 'admin', isUser: false, isAdmin: true, permissions: ['GET /api/admin/things/'] },
  // One account with both kinds of access, signed in through each API.
  bothOnReader: { id: 'both', portal: 'user', isUser: true, isAdmin: true, permissions: ['GET /api/user/things/:id'] },
  bothOnDashboard: { id: 'both', portal: 'admin', isUser: true, isAdmin: true, permissions: ['GET /api/admin/things/'] },
  // Dashboard access was revoked after the token was issued.
  revokedAdmin: { id: 'revoked', portal: 'admin', isUser: true, isAdmin: false, permissions: ['GET /api/admin/things/'] },
};
mock.module('@/setup', () => ({
  setup: new Elysia({ name: 'setup' }).derive({ as: 'scoped' }, ({ headers }) => ({
    currentUser: sessions[headers.authorization?.replace('Bearer ', '') ?? ''] ?? null,
  })),
}));
const { assertOwnsResource, authorize, canModerate } = await import('@/middleware/authorize');
const { setup } = await import('@/setup');

const userThings = new Elysia({ prefix: '/things' })
  .use(setup)
  .get('/public', () => 'open')
  .use(authorize('user'))
  .get('/:id', ({ authedUser }) => authedUser.id)
  .post('/', () => 'created');
const adminThings = new Elysia({ prefix: '/things' }).use(setup).use(authorize('admin')).get('/', () => 'admin list');
const app = new Elysia()
  .error({ HttpError })
  .onError(({ error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.statusCode;
      return { message: error.message };
    }
  })
  .use(new Elysia({ prefix: '/api/user' }).use(userThings))
  .use(new Elysia({ prefix: '/api/admin' }).use(adminThings));

const call = (method: string, path: string, token?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );

describe('authorize', () => {
  it('leaves routes registered before it open', async () => {
    expect((await call('GET', '/api/user/things/public')).status).toBe(200);
  });
  it('requires a session', async () => {
    expect((await call('GET', '/api/user/things/1')).status).toBe(401);
  });
  it('allows a route whose permission the role holds', async () => {
    const response = await call('GET', '/api/user/things/1', 'reader');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('reader');
  });
  it('names the missing permission', async () => {
    const response = await call('POST', '/api/user/things/', 'reader');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: 'Missing permission: POST /api/user/things/' });
  });
  it('keeps each portal to its own accounts, whatever the permissions', async () => {
    expect((await call('GET', '/api/user/things/1', 'admin')).status).toBe(403);
    expect((await call('GET', '/api/admin/things/', 'reader')).status).toBe(403);
    expect((await call('GET', '/api/admin/things/', 'admin')).status).toBe(200);
  });
  it('lets one account use both APIs, each through a session issued for it', async () => {
    expect((await call('GET', '/api/user/things/1', 'bothOnReader')).status).toBe(200);
    expect((await call('GET', '/api/admin/things/', 'bothOnDashboard')).status).toBe(200);
    // A reader-portal token never opens the dashboard, even for a dashboard user.
    expect((await call('GET', '/api/admin/things/', 'bothOnReader')).status).toBe(403);
    expect((await call('GET', '/api/user/things/1', 'bothOnDashboard')).status).toBe(403);
  });
  it('rejects a session whose portal access was revoked', async () => {
    expect((await call('GET', '/api/admin/things/', 'revokedAdmin')).status).toBe(403);
  });
  it('lets moderators change what others created', () => {
    const asAuthed = (id: string) => ({ ...sessions[id], email: '', username: '', name: '', isGuest: false, role: null }) as Parameters<typeof canModerate>[0];
    expect(canModerate(asAuthed('moderator'))).toBe(true);
    expect(() => assertOwnsResource('someone-else', asAuthed('moderator'))).not.toThrow();
    expect(() => assertOwnsResource('reader', asAuthed('reader'))).not.toThrow();
    expect(() => assertOwnsResource('someone-else', asAuthed('reader'))).toThrow();
    expect(() => assertOwnsResource(null, asAuthed('reader'))).toThrow();
  });
});
