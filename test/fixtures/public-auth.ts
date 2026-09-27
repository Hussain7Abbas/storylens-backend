import { beforeEach, describe, expect, it, mock } from 'bun:test';
import bcrypt from 'bcryptjs';
import { Elysia } from 'elysia';
import { HttpError } from '@/utils/errors';

type Row = { id: string; email: string; username: string; name: string; role: string; password: string };
const guest: Row = { id: 'guest-id', email: 'guest@guest.storylens.local', username: 'guest', name: 'guest', role: 'guest', password: '' };
let users: Row[] = [];
let sessions = 0;
const fakePrisma = {
 user: {
  findUnique: async ({ where }: { where: { email?: string; username?: string; id?: string } }) =>
   users.find(u => (where.email && u.email === where.email) || (where.username && u.username === where.username) || (where.id && u.id === where.id)) ?? null,
  create: async ({ data }: { data: Omit<Row, 'id'> }) => { const row = { id: `user-${users.length}`, ...data }; users.push(row); return row; },
  update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
   const row = users.find(u => u.id === where.id);
   if (!row) throw new Error('missing user');
   Object.assign(row, data); return row;
  },
 },
 account: {
  findFirst: async ({ where }: { where: { userId: string } }) => {
   const row = users.find(u => u.id === where.userId);
   return row ? { id: `account-${row.id}`, password: row.password } : null;
  },
  update: async () => ({}),
  create: async () => ({}),
 },
 session: { create: async () => { sessions += 1; return {}; } },
};
mock.module('@/setup', () => ({ setup: new Elysia({ name: 'setup' })
 .decorate('prisma', fakePrisma)
 .derive({ as: 'scoped' }, ({ headers }) => ({
  currentUser: headers.authorization === 'Bearer guest-token' ? { ...guest } : null,
  t: ({ en }: { en: string; ar: string }) => en,
 })) }));
const { accounts } = await import('@/routes/accounts');
const app = new Elysia().error({ HttpError }).onError(({ error, set }) => {
 if (error instanceof HttpError) { set.status = error.statusCode; return { message: error.message }; }
}).use(accounts);

function post(path: string, body: unknown, token?: string) {
 return app.handle(new Request(`http://localhost/auth/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
 }));
}
beforeEach(async () => {
 sessions = 0;
 users = [
  { ...guest },
  { id: 'reader-id', email: 'reader@example.com', username: 'reader', name: 'Reader', role: 'user', password: await bcrypt.hash('reader-pass', 4) },
 ];
});
describe('sign-in and registration without a session', () => {
 it('signs in with no bearer token', async () => {
  const response = await post('login', { email: 'Reader@example.com', password: 'reader-pass' });
  expect(response.status).toBe(200);
  const data = await response.json() as { user: { id: string }; token: string };
  expect(data.user.id).toBe('reader-id'); expect(typeof data.token).toBe('string');
 });
 it('rejects a wrong password with 401', async () => {
  expect((await post('login', { email: 'reader@example.com', password: 'nope' })).status).toBe(401);
  expect(sessions).toBe(0);
 });
 it('registers a new user with no bearer token', async () => {
  const response = await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' });
  expect(response.status).toBe(200);
  expect(users.find(u => u.email === 'new@example.com')?.role).toBe('user');
 });
 it('upgrades the guest in place when its token is sent', async () => {
  const response = await post('register', { email: 'upgraded@example.com', password: 'new-password', username: 'guest' }, 'guest-token');
  expect(response.status).toBe(200);
  const data = await response.json() as { user: { id: string; role: string } };
  expect(data.user).toMatchObject({ id: 'guest-id', role: 'user' });
  expect(users).toHaveLength(2);
 });
 it('still guards profile reads', async () => {
  const response = await app.handle(new Request('http://localhost/auth/me'));
  expect(response.status).toBe(401);
 });
});
