import { beforeEach, describe, expect, it, mock } from 'bun:test';
import bcrypt from 'bcryptjs';
import { Elysia } from 'elysia';
import { HttpError } from '@/utils/errors';
import { sessionUser, withRole } from './access';

type Row = { id: string; email: string; username: string; name: string; isUser: boolean; isAdmin: boolean; isGuest: boolean; userRoleId: string | null; adminRoleId?: string | null; password: string; emailVerified?: boolean };
type VerificationRow = { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date };
type VerificationWhere = { id?: string; identifier?: string; value?: string };
const baseUser: Row = { id: 'user-id', email: 'reader@example.com', username: 'reader', name: 'Reader', isUser: true, isAdmin: false, isGuest: false, userRoleId: 'role-reader', password: '' };
let users: Row[] = [];
let currentRoleId = 'role-reader';
let hashedPassword: string;
let verifications: VerificationRow[] = [];
let sent: { to: string; text: string }[] = [];
let deliver = true;
const writes: { target: string; data: Record<string, unknown> }[] = [];
const matches = (row: VerificationRow, where: VerificationWhere) =>
 (where.id === undefined || row.id === where.id) && (where.identifier === undefined || row.identifier === where.identifier) && (where.value === undefined || row.value === where.value);
const fakePrisma = {
 $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
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
 account: {
  findFirst: async () => ({ password: hashedPassword }),
  updateMany: async (args: { data: Record<string, unknown> }) => { writes.push({ target: 'account', data: args.data }); return { count: 1 }; },
 },
 user: {
  findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
   users.find(u => (where.email && u.email === where.email) || (where.id && u.id === where.id)) ?? null,
  update: async (args: { where: { id: string }; data: Partial<Row> }) => {
   writes.push({ target: 'user', data: args.data });
   const row = users.find(u => u.id === args.where.id);
   if (!row) throw new Error('missing user');
   Object.assign(row, args.data); return withRole(row);
  },
 },
};
mock.module('@/lib/email', () => ({ sendEmail: async (message: { to: string; text: string }) => { if (deliver) sent.push(message); return deliver; } }));
mock.module('@/setup', () => ({ setup: new Elysia({ name: 'setup' })
 .decorate('prisma', fakePrisma)
 .derive({ as: 'scoped' }, ({ headers }) => ({
  currentUser: headers.authorization
   ? sessionUser({ ...(users[0] ?? baseUser), userRoleId: currentRoleId, isGuest: currentRoleId === 'role-guest' })
   : null,
  t: ({ en }: { en: string; ar: string }) => en,
 })) }));
const { accounts } = await import('@/routes/accounts');
const app = new Elysia().error({ HttpError }).onError(({ error, set }) => {
 if (error instanceof HttpError) { set.status = error.statusCode; return { message: error.message }; }
}).use(accounts);

beforeEach(async () => {
 currentRoleId = 'role-reader'; writes.length = 0; verifications = []; sent = []; deliver = true;
 users = [{ ...baseUser }, { ...baseUser, id: 'other-id', email: 'taken@example.com', username: 'other' }];
 hashedPassword = await bcrypt.hash('old-password', 4);
});
function post(path: string, body: unknown, authenticated = true) {
 return app.handle(new Request(`http://localhost/auth/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-token' } : {}) },
  body: JSON.stringify(body),
 }));
}
function codeFrom(index: number): string {
 const code = sent[index]?.text.match(/\b\d{6}\b/)?.[0];
 if (!code) throw new Error(`no code in email ${index}`);
 return code;
}
function wrongCode(code: string): string { return code === '000000' ? '000001' : '000000'; }
const requestPassword = (currentPassword = 'old-password', newPassword = 'new-password', authenticated = true) =>
 post('change-password', { currentPassword, newPassword }, authenticated);

describe('change password', () => {
 it('emails a code to the account address and changes nothing yet', async () => {
  const response = await requestPassword(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ email: 'reader@example.com', resendAfterSeconds: 60 });
  expect(sent.map(message => message.to)).toEqual(['reader@example.com']);
  expect(writes).toHaveLength(0);
  expect(verifications[0]?.value).not.toContain(codeFrom(0));
  expect(verifications[0]?.value).not.toContain('new-password');
 });
 it('updates both password stores after the code is verified', async () => {
  await requestPassword();
  const response = await post('change-password/verify', { code: codeFrom(0) }); expect(response.status).toBe(200);
  expect(writes.map(write => write.target)).toEqual(['user', 'account']);
  const [userWrite, accountWrite] = writes;
  expect(userWrite?.data.password).toBe(accountWrite?.data.password);
  expect(await bcrypt.compare('new-password', String(userWrite?.data.password))).toBe(true);
  expect((await post('change-password/verify', { code: codeFrom(0) })).status).toBe(400);
 });
 it('rejects a wrong code without writing', async () => {
  await requestPassword();
  const response = await post('change-password/verify', { code: wrongCode(codeFrom(0)) });
  expect(response.status).toBe(400); expect((await response.json()).message).toContain('4 attempts left');
  expect(writes).toHaveLength(0);
 });
 it('enforces the resend cooldown', async () => {
  await requestPassword(); expect((await requestPassword()).status).toBe(429); expect(sent).toHaveLength(1);
 });
 it('drops the code when the email cannot be sent', async () => {
  deliver = false; expect((await requestPassword()).status).toBe(502); expect(verifications).toHaveLength(0);
 });
 it('supports moderators', async () => { currentRoleId = 'role-moderator'; expect((await requestPassword()).status).toBe(200); });
 it('rejects guests', async () => { currentRoleId = 'role-guest'; expect((await requestPassword()).status).toBe(403); expect(sent).toHaveLength(0); });
 it('requires authentication', async () => { expect((await requestPassword('old-password', 'new-password', false)).status).toBe(401); expect(sent).toHaveLength(0); });
 it('rejects an incorrect current password without sending a code', async () => { expect((await requestPassword('incorrect')).status).toBe(400); expect(sent).toHaveLength(0); });
 it('rejects short new passwords', async () => { expect((await requestPassword('old-password', 'short')).status).toBe(422); expect(sent).toHaveLength(0); });
});

describe('change email', () => {
 it('emails a code to the new address and moves the account once verified', async () => {
  const response = await post('change-email', { email: 'New@Example.com' }); expect(response.status).toBe(200);
  expect(sent.map(message => message.to)).toEqual(['new@example.com']);
  expect(writes).toHaveLength(0);
  const verified = await post('change-email/verify', { code: codeFrom(0) }); expect(verified.status).toBe(200);
  expect(await verified.json()).toMatchObject({ email: 'new@example.com' });
  expect(writes).toEqual([
   { target: 'user', data: { email: 'new@example.com', emailVerified: true } },
   { target: 'account', data: { accountId: 'new@example.com' } },
  ]);
  expect(sent[1]?.to).toBe('reader@example.com');
 });
 it('rejects an address that belongs to another account', async () => {
  expect((await post('change-email', { email: 'taken@example.com' })).status).toBe(400); expect(sent).toHaveLength(0);
 });
 it('rejects the current address', async () => {
  expect((await post('change-email', { email: 'reader@example.com' })).status).toBe(400); expect(sent).toHaveLength(0);
 });
 it('does not accept a password-change code', async () => {
  await requestPassword();
  expect((await post('change-email/verify', { code: codeFrom(0) })).status).toBe(400);
  expect(writes).toHaveLength(0);
 });
 it('rechecks availability when the code is verified', async () => {
  await post('change-email', { email: 'new@example.com' });
  users.push({ ...baseUser, id: 'late-id', email: 'new@example.com', username: 'late' });
  expect((await post('change-email/verify', { code: codeFrom(0) })).status).toBe(400);
  expect(writes).toHaveLength(0);
 });
 it('rejects guests', async () => { currentRoleId = 'role-guest'; expect((await post('change-email', { email: 'new@example.com' })).status).toBe(403); });
 it('requires authentication', async () => { expect((await post('change-email', { email: 'new@example.com' }, false)).status).toBe(401); });
});
