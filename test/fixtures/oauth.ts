import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { HttpError } from '@/utils/errors';
import { withRole } from './access';

type Row = { id: string; email: string; username: string; name: string; isUser: boolean; isAdmin: boolean; isGuest: boolean; userRoleId: string | null; adminRoleId?: string | null; password: string };
let users: Row[] = [];
let oauthUserId: string | null = null;
const moved: string[] = [];
let signedOut = 0;
const owned = (model: string) => ({
 updateMany: async ({ where }: { where: Record<string, string> }) => { moved.push(`${model}:${Object.values(where)[0]}`); return { count: 1 }; },
});
const fakePrisma = {
 user: {
  findUnique: async ({ where }: { where: { id?: string; username?: string } }) =>
   users.find(u => u.id === where.id || u.username === where.username) ?? null,
  findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
   const row = users.find(u => u.id === where.id); if (!row) throw new Error('missing'); return row;
  },
  delete: async ({ where }: { where: { id: string } }) => { users = users.filter(u => u.id !== where.id); moved.push(`delete:${where.id}`); return {}; },
 },
 novel: owned('novel'), keyword: owned('keyword'), keywordAlias: owned('keywordAlias'),
 keywordVersion: owned('keywordVersion'), replacement: owned('replacement'), file: owned('file'),
 session: {
  create: async () => ({}),
  findUnique: async ({ where }: { where: { token: string } }) => {
   const user = users.find(u => `${u.id}-token` === where.token);
   return user ? { expiresAt: new Date(Date.now() + 60_000), portal: 'user', user } : null;
  },
 },
 $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
};
mock.module('@/setup', () => ({ setup: new Elysia({ name: 'setup' })
 .decorate('prisma', fakePrisma)
 .derive({ as: 'scoped' }, () => ({ currentUser: null, t: ({ en }: { en: string; ar: string }) => en })) }));
mock.module('@/lib/auth', () => ({
 googleEnabled: true,
 auth: {
  api: {
   getSession: async () => (oauthUserId ? { user: { id: oauthUserId }, session: {} } : null),
   signOut: async () => { signedOut += 1; return { headers: new Headers([['set-cookie', 'better-auth.session_token=; Max-Age=0']]) }; },
  },
  handler: async () => new Response('better-auth', { status: 418 }),
 },
}));
const { accounts } = await import('@/routes/accounts');
const { betterAuthRoutes } = await import('@/routes/better-auth');
const { generateUniqueUsername } = await import('@/lib/auth/oauth');
const app = new Elysia().error({ HttpError }).onError(({ error, set }) => {
 if (error instanceof HttpError) { set.status = error.statusCode; return { message: error.message }; }
}).use(accounts).use(betterAuthRoutes);

const exchange = (body: unknown = {}) => app.handle(new Request('http://localhost/auth/oauth/session', {
 method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
beforeEach(() => {
 oauthUserId = null; moved.length = 0; signedOut = 0;
 users = [
  withRole({ id: 'google-user', email: 'jane@example.com', username: 'JaneReader', name: 'Jane Reader', isUser: true, isAdmin: false, isGuest: false, userRoleId: 'role-reader', password: 'x' }),
  withRole({ id: 'guest', email: 'g@guest.storylens.local', username: 'QuietOwl', name: 'QuietOwl', isUser: true, isAdmin: false, isGuest: true, userRoleId: 'role-guest', password: 'x' }),
  withRole({ id: 'other-user', email: 'o@example.com', username: 'Other', name: 'Other', isUser: true, isAdmin: false, isGuest: false, userRoleId: 'role-reader', password: 'x' }),
  withRole({ id: 'dashboard-user', email: 'd@example.com', username: 'Dash', name: 'Dash', isUser: false, isAdmin: true, isGuest: false, userRoleId: null, adminRoleId: null, password: 'x' }),
 ];
});
describe('OAuth session exchange', () => {
 it('reports configured providers', async () => {
  expect(await (await app.handle(new Request('http://localhost/auth/providers'))).json()).toEqual({ google: true });
 });
 it('requires an OAuth cookie session', async () => {
  expect((await exchange()).status).toBe(401); expect(signedOut).toBe(0);
 });
 it('returns a bearer session and ends the cookie session', async () => {
  oauthUserId = 'google-user';
  const response = await exchange();
  expect(response.status).toBe(200);
  const data = await response.json() as { user: { id: string }; token: string };
  expect(data.user.id).toBe('google-user'); expect(typeof data.token).toBe('string');
  expect(signedOut).toBe(1);
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  expect(moved).toEqual([]);
 });
 it('merges the browser guest into the account', async () => {
  oauthUserId = 'google-user';
  expect((await exchange({ guestToken: 'guest-token' })).status).toBe(200);
  expect(moved).toEqual(['novel:guest', 'keyword:guest', 'keywordAlias:guest', 'keywordVersion:guest', 'replacement:guest', 'file:guest', 'delete:guest']);
 });
 it('never merges a registered user', async () => {
  oauthUserId = 'google-user';
  expect((await exchange({ guestToken: 'other-user-token' })).status).toBe(200);
  expect(moved).toEqual([]); expect(users.map(u => u.id)).toContain('other-user');
 });
 it('refuses dashboard accounts', async () => {
  oauthUserId = 'dashboard-user';
  expect((await exchange({ guestToken: 'guest-token' })).status).toBe(403);
  expect(moved).toEqual([]);
 });
 it('keeps guarded and custom routes ahead of Better Auth', async () => {
  expect((await app.handle(new Request('http://localhost/auth/me'))).status).toBe(401);
  expect((await app.handle(new Request('http://localhost/auth/get-session'))).status).toBe(418);
 });
});
describe('OAuth usernames', () => {
 it('derives from the display name, not the email', async () => {
  expect(await generateUniqueUsername(fakePrisma as never, 'Mira Vale')).toBe('MiraVale');
 });
 it('pads short names and avoids taken ones', async () => {
  expect(await generateUniqueUsername(fakePrisma as never, 'Jo')).toBe('readerJo');
  expect(await generateUniqueUsername(fakePrisma as never, 'Jane Reader')).toMatch(/^JaneReader\d{4}$/);
 });
});
