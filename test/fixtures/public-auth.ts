import { beforeEach, describe, expect, it, mock } from 'bun:test';
import bcrypt from 'bcryptjs';
import { Elysia } from 'elysia';
import { HttpError } from '@/utils/errors';
import { fakeRoles, sessionUser, withRole } from './access';

type Row = { id: string; email: string; username: string; name: string; isUser: boolean; isAdmin: boolean; isGuest: boolean; userRoleId: string | null; adminRoleId?: string | null; password: string; emailVerified?: boolean };
const guest: Row = { id: 'guest-id', email: 'guest@guest.storylens.local', username: 'guest', name: 'guest', isUser: true, isAdmin: false, isGuest: true, userRoleId: 'role-guest', password: '' };
type VerificationRow = { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date };
let users: Row[] = [];
let sessions = 0;
let verifications: VerificationRow[] = [];
let sent: { to: string; text: string }[] = [];
let deliver = true;
type VerificationWhere = { id?: string; identifier?: string; value?: string };
const matches = (row: VerificationRow, where: VerificationWhere) =>
 (where.id === undefined || row.id === where.id) && (where.identifier === undefined || row.identifier === where.identifier) && (where.value === undefined || row.value === where.value);
const fakePrisma = {
 $transaction: async (arg: unknown) => typeof arg === 'function' ? arg(fakePrisma) : Promise.all(arg as Promise<unknown>[]),
 role: fakeRoles,
 verification: {
  findFirst: async ({ where }: { where: VerificationWhere }) => verifications.filter(v => matches(v, where)).at(-1) ?? null,
  create: async ({ data }: { data: Omit<VerificationRow, 'id'> }) => { const row = { id: crypto.randomUUID(), ...data }; verifications.push(row); return row; },
  updateMany: async ({ where, data }: { where: VerificationWhere; data: { value: string } }) => {
   const rows = verifications.filter(v => matches(v, where)); rows.forEach(v => { v.value = data.value; }); return { count: rows.length };
  },
  deleteMany: async ({ where }: { where: VerificationWhere }) => {
   const before = verifications.length; verifications = verifications.filter(v => !matches(v, where)); return { count: before - verifications.length };
  },
 },
 user: {
  findUnique: async ({ where }: { where: { email?: string; username?: string; id?: string } }) =>
   users.find(u => (where.email && u.email === where.email) || (where.username && u.username === where.username) || (where.id && u.id === where.id)) ?? null,
  create: async ({ data }: { data: Omit<Row, 'id'> & { accounts?: unknown } }) => {
   const { accounts: _accounts, ...fields } = data; const row = withRole({ id: `user-${users.length}`, ...fields }); users.push(row); return row;
  },
  update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
   const row = users.find(u => u.id === where.id);
   if (!row) throw new Error('missing user');
   Object.assign(row, data); return withRole(row);
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
 // No billing config: the trial gift is 0, so registration grants nothing here (the live tests cover gifts).
 config: { findMany: async () => [] },
};
mock.module('@/lib/email', () => ({ sendEmail: async (message: { to: string; text: string }) => { if (deliver) sent.push(message); return deliver; } }));
mock.module('@/setup', () => ({ setup: new Elysia({ name: 'setup' })
 .decorate('prisma', fakePrisma)
 .derive({ as: 'scoped' }, ({ headers }) => ({
  currentUser: headers.authorization === 'Bearer guest-token' ? sessionUser(guest) : null,
  t: ({ en }: { en: string; ar: string }) => en,
 })) }));
const { accounts } = await import('@/routes/accounts');
const app = new Elysia().error({ HttpError }).onError(({ error, set }) => {
 if (error instanceof HttpError) { set.status = error.statusCode; return { message: error.message }; }
}).use(accounts);

function codeFrom(index: number): string {
 const code = sent[index]?.text.match(/\b\d{6}\b/)?.[0];
 if (!code) throw new Error(`no code in email ${index}`);
 return code;
}
function post(path: string, body: unknown, token?: string) {
 return app.handle(new Request(`http://localhost/auth/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
 }));
}
beforeEach(async () => {
 sessions = 0;
 verifications = [];
 sent = [];
 deliver = true;
 users = [
  withRole({ ...guest }),
  withRole({ id: 'reader-id', email: 'reader@example.com', username: 'reader', name: 'Reader', isUser: true, isAdmin: false, isGuest: false, userRoleId: 'role-reader', password: await bcrypt.hash('reader-pass', 4) }),
  withRole({ id: 'admin-id', email: 'admin@example.com', username: 'admin', name: 'Admin', isUser: false, isAdmin: true, isGuest: false, userRoleId: null, adminRoleId: null, password: await bcrypt.hash('admin-pass', 4) }),
 ];
});
describe('sign-in and registration without a session', () => {
 it('signs in with no bearer token', async () => {
  const response = await post('login', { email: 'Reader@example.com', password: 'reader-pass' });
  expect(response.status).toBe(200);
  const data = await response.json() as { user: { id: string }; token: string };
  expect(data.user.id).toBe('reader-id'); expect(typeof data.token).toBe('string');
 });
 it('keeps dashboard accounts out of reader sign-in', async () => {
  const response = await post('login', { email: 'admin@example.com', password: 'admin-pass' });
  expect(response.status).toBe(403);
  expect(sessions).toBe(0);
 });
 it('rejects a wrong password with 401', async () => {
  expect((await post('login', { email: 'reader@example.com', password: 'nope' })).status).toBe(401);
  expect(sessions).toBe(0);
 });
 it('emails a code and creates no user until it is verified', async () => {
  const response = await post('register', { email: 'New@example.com', password: 'new-password', username: 'newbie' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ email: 'new@example.com', resendAfterSeconds: 60 });
  expect(users.find(u => u.email === 'new@example.com')).toBeUndefined();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.to).toBe('new@example.com');
  expect(verifications[0]?.value).not.toContain(codeFrom(0));
  expect(verifications[0]?.value).not.toContain('new-password');
  expect(sessions).toBe(0);
 });
 it('registers a new user with no bearer token once the code matches', async () => {
  await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' });
  const response = await post('register/verify', { email: 'NEW@example.com', code: codeFrom(0) });
  expect(response.status).toBe(200);
  const data = await response.json() as { user: { email: string; isGuest: boolean; role: { slug: string } }; token: string };
  expect(data.user).toMatchObject({ email: 'new@example.com', isGuest: false, role: { slug: 'reader' } });
  const created = users.find(u => u.email === 'new@example.com');
  expect(created).toMatchObject({ username: 'newbie', emailVerified: true });
  expect(await bcrypt.compare('new-password', created?.password ?? '')).toBe(true);
  expect(sessions).toBe(1);
  expect(verifications).toHaveLength(0);
 });
 it('upgrades the guest in place when its token is sent', async () => {
  await post('register', { email: 'upgraded@example.com', password: 'new-password', username: 'guest' }, 'guest-token');
  const response = await post('register/verify', { email: 'upgraded@example.com', code: codeFrom(0) }, 'guest-token');
  expect(response.status).toBe(200);
  const data = await response.json() as { user: { id: string; isGuest: boolean; role: { slug: string } } };
  expect(data.user).toMatchObject({ id: 'guest-id', isGuest: false, role: { slug: 'reader' } });
  expect(users).toHaveLength(3);
 });
 it('rejects wrong codes and locks out after five attempts', async () => {
  await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' });
  const wrong = codeFrom(0) === '000000' ? '111111' : '000000';
  for (let attempt = 1; attempt <= 5; attempt++) {
   const response = await post('register/verify', { email: 'new@example.com', code: wrong });
   expect(response.status).toBe(400);
   expect((await response.json() as { message: string }).message).toBe(attempt < 5 ? `Incorrect code. ${5 - attempt} attempts left.` : 'Too many incorrect attempts. Request a new code.');
  }
  expect((await post('register/verify', { email: 'new@example.com', code: codeFrom(0) })).status).toBe(400);
  expect(users.find(u => u.email === 'new@example.com')).toBeUndefined();
 });
 it('accepts a code only once', async () => {
  await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' });
  expect((await post('register/verify', { email: 'new@example.com', code: codeFrom(0) })).status).toBe(200);
  const again = await post('register/verify', { email: 'new@example.com', code: codeFrom(0) });
  expect(again.status).toBe(400);
  expect(users.filter(u => u.email === 'new@example.com')).toHaveLength(1);
 });
 it('rejects an expired code', async () => {
  await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' });
  const row = verifications[0];
  if (row) row.expiresAt = new Date(Date.now() - 1);
  const response = await post('register/verify', { email: 'new@example.com', code: codeFrom(0) });
  expect(response.status).toBe(400);
  expect((await response.json() as { message: string }).message).toBe('This code has expired. Request a new one.');
 });
 it('throttles resends, then replaces the old code', async () => {
  await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' });
  expect((await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' })).status).toBe(429);
  const row = verifications[0];
  if (row) row.createdAt = new Date(Date.now() - 61_000);
  expect((await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' })).status).toBe(200);
  expect(verifications).toHaveLength(1);
  if (codeFrom(0) !== codeFrom(1)) {
   expect((await post('register/verify', { email: 'new@example.com', code: codeFrom(0) })).status).toBe(400);
  }
  expect((await post('register/verify', { email: 'new@example.com', code: codeFrom(1) })).status).toBe(200);
 });
 it('rejects taken emails before sending a code', async () => {
  const response = await post('register', { email: 'reader@example.com', password: 'new-password', username: 'other' });
  expect(response.status).toBe(400);
  expect(sent).toHaveLength(0);
 });
 it('rechecks availability when the code is verified', async () => {
  await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' });
  users.push(withRole({ id: 'racer', email: 'racer@example.com', username: 'newbie', name: 'Racer', isUser: true, isAdmin: false, isGuest: false, userRoleId: 'role-reader', password: '' }));
  const response = await post('register/verify', { email: 'new@example.com', code: codeFrom(0) });
  expect(response.status).toBe(400);
  expect((await response.json() as { message: string }).message).toBe('Username already taken');
 });
 it('reports a failed delivery and allows an immediate retry', async () => {
  deliver = false;
  expect((await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' })).status).toBe(502);
  expect(verifications).toHaveLength(0);
  deliver = true;
  expect((await post('register', { email: 'new@example.com', password: 'new-password', username: 'newbie' })).status).toBe(200);
 });
 it('validates the code format', async () => {
  expect((await post('register/verify', { email: 'new@example.com', code: '12ab56' })).status).toBe(422);
 });
 it('still guards profile reads', async () => {
  const response = await app.handle(new Request('http://localhost/auth/me'));
  expect(response.status).toBe(401);
 });
});
