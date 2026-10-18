import { expect, test } from 'bun:test';
import { prisma } from '@/lib/db';
import { createSessionToken } from '@/lib/auth/session';
import { syncPermissions } from '@/lib/permissions';
import { AI_INSTRUCTION_CONFIG_KEYS, AI_INSTRUCTION_MAX_LENGTH, DEFAULT_AI_INSTRUCTIONS, getAiInstructions } from '@/lib/ai/instructions';
import { validateConfigValue } from '@/lib/billing/config';
import { app } from '@/server';
import { cleanup, live, makeActor } from './helpers/live-db';

test('shared instruction defaults, blank fallback and bounded config validation', async () => {
 const result = await getAiInstructions({ config: { findMany: async () => [] } } as unknown as Pick<typeof prisma, 'config'>);
 expect(result.prompts).toEqual(DEFAULT_AI_INSTRUCTIONS);
 expect(result.revisions).toEqual({ keywordPrompt: null, imagePrompt: null, chapterCoverPrompt: null, chapterContextPrompt: null, pageSummaryPrompt: null });
 for(const key of Object.values(AI_INSTRUCTION_CONFIG_KEYS)) {
  expect(validateConfigValue(key, '')).toBeNull();
  expect(validateConfigValue(key, 'x'.repeat(AI_INSTRUCTION_MAX_LENGTH))).toBeNull();
  expect(validateConfigValue(key, 'x'.repeat(AI_INSTRUCTION_MAX_LENGTH + 1))).toContain('20000');
 }
});

live('dashboard templates reach reader/guest generation, preserve secrets and reject stale saves', async () => {
 const marker = crypto.randomUUID();
 const users: string[] = [];
 let restrictedRoleId: string | undefined;
 const keys = Object.values(AI_INSTRUCTION_CONFIG_KEYS);
 try {
  await syncPermissions(prisma, app.routes);
  const role = await prisma.role.findUniqueOrThrow({ where: { slug: 'super-admin' } });
  const admin = await prisma.user.create({ data: { email: `ai-instructions-${marker}@example.invalid`, username: `ai-instructions-${marker}`, name: 'Prompt editor', password: 'unused', isUser: false, isAdmin: true, adminRoleId: role.id } });
  users.push(admin.id);
  const token = await createSessionToken(prisma, admin.id, 'admin');
  const request = async (method: string, path: string, body?: object, auth = token) => app.handle(new Request(`http://localhost/api${path}`, { method, headers: { Authorization: `Bearer ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const defaults = await request('GET', '/admin/ai-instructions/');
  expect(defaults.status).toBe(200);
  const initial = await defaults.json() as Awaited<ReturnType<typeof getAiInstructions>>;
  expect(initial.prompts).toEqual(DEFAULT_AI_INSTRUCTIONS);
  const reader = await makeActor('reader', marker);
  const guest = await makeActor('guest', marker);
  users.push(reader.id, guest.id);
  for (const field of Object.keys(AI_INSTRUCTION_CONFIG_KEYS) as (keyof typeof AI_INSTRUCTION_CONFIG_KEYS)[]) {
   const key = AI_INSTRUCTION_CONFIG_KEYS[field];
   const custom = `Custom ${field}\nKeep Arabic: ارسم المشهد`;
   const saved = await request('PUT', '/admin/configs/', { key, value: custom, baseUpdatedAt: initial.revisions[field] });
   expect(saved.status).toBe(200);
   const row = await saved.json() as { updatedAt: string };
   for(const actor of [reader, guest]) {
    const response = await request('GET', '/user/ai/instructions', undefined, actor.token);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data[field]).toBe(custom);
    expect(Object.keys(data).sort()).toEqual(Object.keys(AI_INSTRUCTION_CONFIG_KEYS).sort());
   }
   expect((await request('PUT', '/admin/configs/', { key, value: 'Overwrite', baseUpdatedAt: null })).status).toBe(409);
   expect((await request('PUT', '/admin/configs/', { key, value: 'x'.repeat(AI_INSTRUCTION_MAX_LENGTH + 1) })).status).toBe(400);
   const reset = await request('PUT', '/admin/configs/', { key, value: ' ', baseUpdatedAt: row.updatedAt });
   expect(reset.status).toBe(200);
   expect((await (await request('GET', '/user/ai/instructions', undefined, reader.token)).json())[field]).toBe(DEFAULT_AI_INSTRUCTIONS[field]);
  }
  expect((await request('PUT', '/admin/configs/', { key: keys[0], value: 'reader override' }, reader.token)).status).toBe(403);
  const restricted = await prisma.role.create({ data: { name: 'Cannot edit prompts', slug: `prompt-denied-${marker}`, portal: 'admin' } });
  restrictedRoleId = restricted.id;
  await prisma.user.update({ where: { id: admin.id }, data: { adminRoleId: restricted.id } });
  expect((await request('GET', '/admin/ai-instructions/')).status).toBe(403);
  expect((await request('PUT', '/admin/configs/', { key: keys[0], value: 'no permission' })).status).toBe(403);
 } finally {
  await prisma.config.deleteMany({ where: { key: { in: keys } } });
  await cleanup({ users });
  if (restrictedRoleId) await prisma.role.delete({ where: { id: restrictedRoleId } });
 }
});
