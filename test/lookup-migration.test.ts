import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { prisma } from '@/lib/db';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';
const marker = crypto.randomUUID();
const ids = { novels: [] as string[], users: [] as string[], categories: [] as string[], natures: [] as string[] };
let moderator: Actor, reader: Actor;
beforeAll(async () => {
 if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
 [moderator, reader] = await Promise.all([makeActor('moderator', marker), makeActor('reader', marker)]);
 ids.users.push(moderator.id, reader.id);
});
afterAll(async () => { if (process.env.STORYLENS_LIVE_DB_TEST === '1') await cleanup(ids); });

for (const kind of ['category', 'nature'] as const) {
 const path = kind === 'category' ? '/keyword-categories' : '/keyword-natures';
 const field = kind === 'category' ? 'categoryId' : 'natureId';
 describe(`${kind} migration on delete`, () => {
  live('requires a valid replacement for used rows and migrates every version and alias atomically', async () => {
   const source = await makeStyles(`${marker}-source-${kind}`), target = await makeStyles(`${marker}-target-${kind}`);
   ids.categories.push(source.category.id, target.category.id); ids.natures.push(source.nature.id, target.nature.id);
   const sourceId = source[kind].id, targetId = target[kind].id;
   const novel = await prisma.novel.create({ data: { nameEn: `Lookup migration ${kind} ${marker}` } }); ids.novels.push(novel.id);
   const body = { id: crypto.randomUUID(), versionId: crypto.randomUUID(), nameEn: `Term ${kind}`, novelId: novel.id, categoryId: source.category.id, natureId: source.nature.id };
   expect((await call(reader, 'POST', '/keywords', body)).status).toBe(200);
   expect((await call(reader, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: body.id, currentChapter: 5, categoryId: source.category.id, natureId: source.nature.id })).status).toBe(200);
   const aliasId = crypto.randomUUID();
   expect((await call(reader, 'POST', '/keyword-aliases', { id: aliasId, keywordId: body.id, nameEn: 'Alias', overrideStyle: true, categoryId: source.category.id, natureId: source.nature.id })).status).toBe(200);
   const usage = await call<{ _count: { keywordVersions: number; keywordAliases: number } }>(moderator, 'GET', `${path}/${sourceId}`);
   expect(usage.body._count).toEqual({ keywordVersions: 2, keywordAliases: 1 });
   expect((await call(moderator, 'DELETE', `${path}/${sourceId}`)).status).toBe(400);
   expect((await call(moderator, 'DELETE', `${path}/${sourceId}?replacementId=${sourceId}`)).status).toBe(422);
   expect((await call(moderator, 'DELETE', `${path}/${sourceId}?replacementId=${crypto.randomUUID()}`)).status).toBe(404);
   expect((await call(reader, 'DELETE', `${path}/${sourceId}?replacementId=${targetId}`)).status).toBe(403);
   expect(await prisma.keywordVersion.count({ where: { keywordId: body.id, [field]: sourceId } })).toBe(2);
   const removed = await call(moderator, 'DELETE', `${path}/${sourceId}?replacementId=${targetId}`);
   expect(removed.status).toBe(200);
   const versions = await prisma.keywordVersion.findMany({ where: { keywordId: body.id } });
   expect(versions).toHaveLength(2); expect(versions.every(row => row[field] === targetId)).toBe(true);
   expect(versions.every(row => row[kind === 'category' ? 'natureId' : 'categoryId'] === source[kind === 'category' ? 'nature' : 'category'].id)).toBe(true);
   expect((await prisma.keywordAlias.findUniqueOrThrow({ where: { id: aliasId } }))[field]).toBe(targetId);
   expect((await call(moderator, 'GET', `${path}/${sourceId}`)).status).toBe(404);
   expect((await call(reader, 'GET', `${path}/${targetId}`)).status).toBe(200);
  });
  live('continues to delete an unused lookup without a replacement', async () => {
   const styles = await makeStyles(`${marker}-unused-${kind}`); ids.categories.push(styles.category.id); ids.natures.push(styles.nature.id);
   expect((await call(moderator, 'DELETE', `${path}/${styles[kind].id}`)).status).toBe(200);
  });
 });
}

live('defaults the category swap to false and preserves it across legacy partial edits', async () => {
 const id = crypto.randomUUID(); ids.categories.push(id);
 const created = await call<{ switchPositionWithNature: boolean; updatedAt: string }>(moderator, 'POST', '/keyword-categories', { id, nameEn: `Swap ${marker}`, color: '#123456' });
 expect(created.body.switchPositionWithNature).toBe(false);
 const updated = await call<{ switchPositionWithNature: boolean; updatedAt: string }>(moderator, 'PUT', `/keyword-categories/${id}`, { baseUpdatedAt: created.body.updatedAt, switchPositionWithNature: true });
 expect(updated.status).toBe(200); expect(updated.body.switchPositionWithNature).toBe(true);
 const legacy = await call<{ switchPositionWithNature: boolean }>(moderator, 'PUT', `/keyword-categories/${id}`, { baseUpdatedAt: updated.body.updatedAt, color: '#112233' });
 expect(legacy.body.switchPositionWithNature).toBe(true);
 const { createSessionToken } = await import('@/lib/auth/session');
 const role = await prisma.role.findUniqueOrThrow({ where: { slug: 'super-admin' } });
 await prisma.user.update({ where: { id: moderator.id }, data: { isAdmin: true, adminRoleId: role.id } });
 const token = await createSessionToken(prisma, moderator.id, 'admin');
 const { app } = await import('@/server');
 const row = await prisma.keywordCategory.findUniqueOrThrow({ where: { id } });
 const response = await app.handle(new Request(`http://localhost/api/admin/keyword-categories/${id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUpdatedAt: row.updatedAt.toISOString(), switchPositionWithNature: false }) }));
 expect(response.status).toBe(200); expect((await response.json()).switchPositionWithNature).toBe(false);
});
