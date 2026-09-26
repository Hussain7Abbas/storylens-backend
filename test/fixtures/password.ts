import { beforeEach, describe, expect, it, mock } from 'bun:test';
import bcrypt from 'bcryptjs';
import { Elysia } from 'elysia';
import { HttpError } from '@/utils/errors';

const user = { id: 'user-id', email: 'reader@example.com', username: 'reader', name: 'Reader', role: 'user' };
let currentRole = 'user';
let hashedPassword: string;
const writes: { target: string; password: string }[] = [];
const fakePrisma = {
 account: {
  findFirst: async () => ({ password: hashedPassword }),
  updateMany: async (args: { data: { password: string } }) => { writes.push({ target: 'account', password: args.data.password }); return { count: 1 }; },
 },
 user: {
  update: async (args: { data: { password: string } }) => { writes.push({ target: 'user', password: args.data.password }); return user; },
 },
 $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
};
mock.module('@/setup', () => ({ setup: new Elysia({ name: 'setup' })
 .decorate('prisma', fakePrisma)
 .derive({ as: 'scoped' }, ({ headers }) => ({
  currentUser: headers.authorization ? { ...user, role: currentRole } : null,
  t: ({ en }: { en: string; ar: string }) => en,
 })) }));
const { accounts } = await import('@/routes/accounts');
const app = new Elysia().error({ HttpError }).onError(({ error, set }) => {
 if (error instanceof HttpError) { set.status = error.statusCode; return { message: error.message }; }
}).use(accounts);

beforeEach(async () => {
 currentRole = 'user'; writes.length = 0; hashedPassword = await bcrypt.hash('old-password', 4);
});
function request(currentPassword = 'old-password', newPassword = 'new-password', authenticated = true) {
 return app.handle(new Request('http://localhost/auth/change-password', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-token' } : {}) },
  body: JSON.stringify({ currentPassword, newPassword }),
 }));
}
describe('change password', () => {
 it('updates both password stores for a registered user', async () => {
  const response = await request(); expect(response.status).toBe(200);
  expect(writes.map(write => write.target)).toEqual(['user', 'account']);
  const userWrite = writes.find(write => write.target === 'user');
  const accountWrite = writes.find(write => write.target === 'account');
  if (!userWrite || !accountWrite) throw new Error('Both password stores must be updated');
  expect(userWrite.password).toBe(accountWrite.password);
  expect(await bcrypt.compare('new-password', userWrite.password)).toBe(true);
 });
 it('supports admins', async () => { currentRole = 'admin'; expect((await request()).status).toBe(200); });
 it('rejects guests', async () => { currentRole = 'guest'; expect((await request()).status).toBe(403); expect(writes).toHaveLength(0); });
 it('requires authentication', async () => { expect((await request('old-password', 'new-password', false)).status).toBe(401); expect(writes).toHaveLength(0); });
 it('rejects an incorrect current password without writing', async () => { expect((await request('incorrect')).status).toBe(400); expect(writes).toHaveLength(0); });
 it('rejects short new passwords', async () => { expect((await request('old-password', 'short')).status).toBe(422); expect(writes).toHaveLength(0); });
});
