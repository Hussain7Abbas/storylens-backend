import { afterAll, beforeAll, expect } from 'bun:test';
import { prisma } from '@/lib/db';
import { call, cleanup, live, makeActor, type Actor } from './helpers/live-db';

const marker = `cover-${crypto.randomUUID().slice(0, 8)}`;
const ids = { users: [] as string[], novels: [] as string[] };
let reader: Actor, other: Actor, guest: Actor;
let novelId: string;
const files: string[] = [];
type Cover = { image: { id: string; url: string } | null; generating: boolean; token?: string | null };
const path = (chapter = 5) => `/chapter-covers/${novelId}/${chapter}`;
beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  [reader, other, guest] = await Promise.all([makeActor('reader', marker), makeActor('reader', marker), makeActor('guest', marker)]);
  ids.users.push(reader.id, other.id, guest.id);
  novelId = (await prisma.novel.create({ data: { nameEn: marker, slugs: [marker] } })).id;
  ids.novels.push(novelId);
});
afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await cleanup(ids);
  await prisma.file.deleteMany({ where: { id: { in: files } } });
});
async function imageFor(actor: Actor) {
  const id = crypto.randomUUID(); files.push(id);
  return prisma.file.create({ data: { id, userId: actor.id, type: 'Image', url: `https://images.example.invalid/${id}.jpg`, provider_image_id: id, delete_url: 'https://images.example.invalid/delete' } });
}

live('covers are shared, guests can read, and only one concurrent reader claims a missing chapter', async () => {
  expect((await call<Cover>(guest, 'GET', path())).body).toEqual({ image: null, generating: false });
  const claims = await Promise.all([reader, other].map(actor => call<Cover>(actor, 'POST', `${path()}/claim`)));
  expect(claims.map(result => result.status)).toEqual([200, 200]);
  expect(claims.filter(result => result.body.token)).toHaveLength(1);
  const owner = claims[0]?.body.token ? reader : other;
  const token = claims.find(result => result.body.token)?.body.token;
  const stolen = await imageFor(owner === reader ? other : reader);
  expect((await call(owner, 'PUT', path(), { token, imageId: stolen.id })).status).toBe(403);
  expect((await call(owner === reader ? other : reader, 'DELETE', `${path()}/claim`, { token })).status).toBe(200);
  expect((await call<Cover>(reader, 'GET', path())).body.generating).toBe(true);
  const image = await imageFor(owner);
  expect((await call(owner, 'PUT', path(), { token: crypto.randomUUID(), imageId: image.id })).status).toBe(409);
  const saved = await call<Cover>(owner, 'PUT', path(), { token, imageId: image.id });
  expect(saved.status).toBe(200);
  expect(saved.body.image).toEqual({ id: image.id, url: image.url });
  expect((await call<Cover>(guest, 'GET', path())).body.image).toEqual(saved.body.image);
  expect((await call<Cover>(other, 'POST', `${path()}/claim`)).body.token).toBeNull();
  expect((await call<Cover>(owner, 'PUT', path(), { token, imageId: image.id })).status).toBe(200);
  expect((await call(guest, 'POST', `${path()}/claim`)).status).toBe(403);
});

live('cancelled and expired reservations can be reclaimed without late writes replacing the next claim', async () => {
  const first = await call<Cover>(reader, 'POST', `${path(6)}/claim`);
  await call(reader, 'DELETE', `${path(6)}/claim`, { token: first.body.token });
  const second = await call<Cover>(other, 'POST', `${path(6)}/claim`);
  expect(second.body.token).toBeString();
  await prisma.chapter.update({ where: { novelId_number: { novelId, number: 6 } }, data: { coverLeaseExpiresAt: new Date(0) } });
  const third = await call<Cover>(reader, 'POST', `${path(6)}/claim`);
  expect(third.body.token).toBeString();
  const image = await imageFor(other);
  expect((await call(other, 'PUT', path(6), { token: second.body.token, imageId: image.id })).status).toBe(409);
  expect((await call(reader, 'GET', path(-1))).status).toBe(422);
  expect((await call(reader, 'GET', path(1.5))).status).toBe(422);
});
