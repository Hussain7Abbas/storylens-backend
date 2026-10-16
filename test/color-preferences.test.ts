import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { prisma } from '@/lib/db';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

let guest: Actor;
let reader: Actor;
let moderator: Actor;
let styles: Awaited<ReturnType<typeof makeStyles>>;
const ids = { users: [] as string[], categories: [] as string[], natures: [] as string[] };
beforeAll(async () => {
 if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
 const marker = crypto.randomUUID();
 [guest, reader, moderator] = await Promise.all([makeActor('guest', marker), makeActor('reader', marker), makeActor('moderator', marker)]);
 ids.users.push(guest.id, reader.id, moderator.id);
 styles = await makeStyles(marker);
 ids.categories.push(styles.category.id); ids.natures.push(styles.nature.id);
});
afterAll(async () => { if (process.env.STORYLENS_LIVE_DB_TEST === '1') await cleanup(ids); });
type Colors = { category: Record<string, string>; nature: Record<string, string> };
describe('account personal colors', () => {
 live('lets guests, readers and moderators save their own colors without changing original colors', async () => {
  for (const actor of [guest, reader, moderator]) {
   for (const kind of ['category', 'nature'] as const) {
    const id = styles[kind].id;
    const saved = await call(actor, 'PUT', `/color-preferences/${kind}/${id}`, { color: '#abcdef' });
    expect(saved.status).toBe(200);
    const anotherDevice = await call<Colors>(actor, 'GET', '/color-preferences');
    expect(anotherDevice.body[kind][id]).toBe('#abcdef');
   }
  }
  expect((await prisma.keywordCategory.findUniqueOrThrow({ where: { id: styles.category.id } })).color).toBe('#112233');
  expect((await prisma.keywordNature.findUniqueOrThrow({ where: { id: styles.nature.id } })).color).toBe('#445566');
 });
 live('isolates owners and clearing, including repeated clears', async () => {
  const path = `/color-preferences/category/${styles.category.id}`;
  await call(guest, 'PUT', path, { color: '#123456' });
  await call(reader, 'PUT', path, { color: '#654321' });
  expect((await call<Colors>(guest, 'GET', '/color-preferences')).body.category[styles.category.id]).toBe('#123456');
  expect((await call<Colors>(reader, 'GET', '/color-preferences')).body.category[styles.category.id]).toBe('#654321');
  for (let i = 0; i < 2; i++) expect((await call(guest, 'PUT', path, { color: null })).status).toBe(200);
  expect((await call<Colors>(guest, 'GET', '/color-preferences')).body.category[styles.category.id]).toBeUndefined();
  expect((await call<Colors>(reader, 'GET', '/color-preferences')).body.category[styles.category.id]).toBe('#654321');
 });
 live('rejects original-color edits from guests and readers; allows moderators', async () => {
  for (const [kind, path] of [['category', 'keyword-categories'], ['nature', 'keyword-natures']] as const) {
   const row = styles[kind];
   for (const actor of [guest, reader]) expect((await call(actor, 'PUT', `/${path}/${row.id}`, { color: '#ff0000', baseUpdatedAt: row.updatedAt.toISOString() })).status).toBe(403);
   expect((await call(moderator, 'PUT', `/${path}/${row.id}`, { color: '#fedcba', baseUpdatedAt: row.updatedAt.toISOString() })).status).toBe(200);
  }
 });
 live('validates colors, kind, lookup existence, and requires a session', async () => {
  const path = `/color-preferences/category/${styles.category.id}`;
  expect((await call(null, 'GET', '/color-preferences')).status).toBe(401);
  expect((await call(guest, 'PUT', path, { color: 'red' })).status).toBe(422);
  expect((await call(guest, 'PUT', `/color-preferences/other/${styles.category.id}`, { color: '#123456' })).status).toBe(422);
  expect((await call(guest, 'PUT', `/color-preferences/category/${crypto.randomUUID()}`, { color: '#123456' })).status).toBe(404);
  expect((await call(guest, 'PUT', `/color-preferences/category/${crypto.randomUUID()}`, { color: null })).status).toBe(200);
 });
 live('merges synced guest preferences into a member without replacing the member colors', async () => {
  const { mergeGuestInto } = await import('@/lib/auth/oauth');
  await call(guest, 'PUT', `/color-preferences/category/${styles.category.id}`, { color: '#010203' });
  await call(reader, 'PUT', `/color-preferences/category/${styles.category.id}`, { color: '#aabbcc' });
  await call(reader, 'PUT', `/color-preferences/nature/${styles.nature.id}`, { color: null });
  await call(guest, 'PUT', `/color-preferences/nature/${styles.nature.id}`, { color: '#030201' });
  await mergeGuestInto(prisma, guest.id, reader.id);
  const result = await call<Colors>(reader, 'GET', '/color-preferences');
  expect(result.body.category[styles.category.id]).toBe('#aabbcc');
  expect(result.body.nature[styles.nature.id]).toBe('#030201');
  expect(await prisma.userCategoryColor.count({ where: { userId: guest.id } })).toBe(0);
 });

});
