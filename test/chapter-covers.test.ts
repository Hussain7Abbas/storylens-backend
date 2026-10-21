import { afterAll, beforeAll, expect } from 'bun:test';
import { prisma } from '@/lib/db';
import { call, cleanup, live, makeActor, type Actor } from './helpers/live-db';

const marker = `cover-${crypto.randomUUID().slice(0, 8)}`;
const ids = { users: [] as string[], novels: [] as string[] };
let reader: Actor, other: Actor, guest: Actor, moderator: Actor;
let novelId: string;
const files: string[] = [];
type Cover = { image: { id: string; url: string } | null; generating: boolean; imagePrompt: string | null; promptUpdatedAt: string | null; canEditPrompt: boolean; canRestart: boolean; token?: string | null };
const path = (chapter = 5) => `/chapter-covers/${novelId}/${chapter}`;
beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  [reader, other, guest, moderator] = await Promise.all([makeActor('reader', marker), makeActor('reader', marker), makeActor('guest', marker), makeActor('moderator', marker)]);
  ids.users.push(reader.id, other.id, guest.id, moderator.id);
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
  expect((await call<Cover>(guest, 'GET', path())).body).toMatchObject({ image: null, generating: false });
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

live('a refreshed reader can restart their reservation without allowing stale or foreign attempts to take over', async () => {
  const url = `/chapter-artwork/${novelId}/23`;
  const first = await call<Cover>(reader, 'POST', `${url}/claim`);
  const refreshed = await call<Cover>(reader, 'GET', url);
  expect(refreshed.body).toMatchObject({ generating: true, canRestart: true });
  expect(refreshed.body).not.toHaveProperty('token');
  expect(refreshed.body).not.toHaveProperty('coverLeaseToken');
  // Old clients and ordinary claims keep the original single-reservation behavior.
  expect((await call<Cover>(reader, 'POST', `${url}/claim`)).body.token).toBeNull();
  const restart = { restartIfUpdatedAt: refreshed.body.promptUpdatedAt };
  for (const actor of [other, moderator, guest]) {
    expect((await call<Cover>(actor, 'GET', url)).body.canRestart).toBe(false);
    const denied = await call<Cover>(actor, 'POST', `${url}/claim`, restart);
    expect(denied.body.token).toBeFalsy();
  }
  const attempts = await Promise.all([1, 2].map(() => call<Cover>(reader, 'POST', `${url}/claim`, restart)));
  expect(attempts.filter(result => result.body.token)).toHaveLength(1);
  const next = attempts.find(result => result.body.token)?.body;
  expect(next?.token).toBeString();
  expect(next?.token).not.toBe(first.body.token);
  expect(next?.promptUpdatedAt).not.toBe(refreshed.body.promptUpdatedAt);
  await call(reader, 'DELETE', `${url}/claim`, { token: first.body.token });
  expect((await call<Cover>(reader, 'GET', url)).body.generating).toBe(true);
  const staleImage = await imageFor(reader);
  expect((await call(reader, 'PUT', url, { token: first.body.token, imageId: staleImage.id })).status).toBe(409);
  expect((await call<Cover>(reader, 'POST', `${url}/claim`, restart)).body.token).toBeNull();
  const image = await imageFor(reader);
  expect((await call(reader, 'PUT', url, { token: next?.token, imageId: image.id })).status).toBe(200);
  expect((await call<Cover>(reader, 'GET', url)).body).toMatchObject({ generating: false, canRestart: false, image: { id: image.id } });
});

live('restarting an interrupted replacement retains the published image and prompt', async () => {
  const url = path(24);
  const first = await call<Cover>(reader, 'POST', `${url}/claim`);
  const image = await imageFor(reader);
  await call(reader, 'PUT', url, { token: first.body.token, imageId: image.id, imagePrompt: 'A red moon above the bridge.' });
  const replacing = await call<Cover>(reader, 'POST', `${url}/claim`, { regenerate: true });
  const restarted = await call<Cover>(reader, 'POST', `${url}/claim`, { restartIfUpdatedAt: replacing.body.promptUpdatedAt });
  expect(restarted.body.token).toBeString();
  expect(restarted.body.token).not.toBe(replacing.body.token);
  expect(restarted.body).toMatchObject({ generating: true, imagePrompt: 'A red moon above the bridge.', image: { id: image.id } });
  await call(reader, 'DELETE', `${url}/claim`, { token: replacing.body.token });
  const replacement = await imageFor(reader);
  expect((await call(reader, 'PUT', url, { token: replacing.body.token, imageId: replacement.id })).status).toBe(409);
  expect((await call(reader, 'PUT', url, { token: restarted.body.token, imageId: replacement.id })).status).toBe(200);
});


live('explicit regeneration keeps existing artwork, enforces ownership and serializes replacements', async () => {
  const chapter = 7;
  const first = await call<Cover>(reader, 'POST', `${path(chapter)}/claim`);
  const oldImage = await imageFor(reader);
  await call(reader, 'PUT', path(chapter), { token: first.body.token, imageId: oldImage.id });
  expect((await call<Cover>(reader, 'POST', `${path(chapter)}/claim`)).body.token).toBeNull();
  expect((await call(other, 'POST', `${path(chapter)}/claim`, { regenerate: true })).status).toBe(403);
  const claims = await Promise.all([1, 2].map(() => call<Cover>(reader, 'POST', `${path(chapter)}/claim`, { regenerate: true })));
  expect(claims.filter(result => result.body.token)).toHaveLength(1);
  const token = claims.find(result => result.body.token)?.body.token;
  const during = await call<Cover>(guest, 'GET', path(chapter));
  expect(during.body.image?.id).toBe(oldImage.id);
  expect(during.body.generating).toBe(true);
  await call(reader, 'DELETE', `${path(chapter)}/claim`, { token });
  expect((await call<Cover>(guest, 'GET', path(chapter))).body).toMatchObject({ image: { id: oldImage.id, url: oldImage.url }, generating: false });
  const next = await call<Cover>(reader, 'POST', `${path(chapter)}/claim`, { regenerate: true });
  const replacement = await imageFor(reader);
  expect((await call(reader, 'PUT', path(chapter), { token, imageId: replacement.id })).status).toBe(409);
  expect((await call(reader, 'PUT', path(chapter), { token: next.body.token, imageId: replacement.id })).status).toBe(200);
  expect((await call<Cover>(guest, 'GET', path(chapter))).body.image?.id).toBe(replacement.id);
});


live('artwork stores the image description, shares it after reload, and protects prompt-only edits', async () => {
  const url = `/chapter-artwork/${novelId}/21`;
  const claim = await call<Cover>(reader, 'POST', `${url}/claim`);
  const image = await imageFor(reader);
  const prompt = 'A scout in blue robes beneath a red moon.';
  const saved = await call<Cover>(reader, 'PUT', url, { token: claim.body.token, imageId: image.id, imagePrompt: prompt });
  expect(saved.status).toBe(200);
  expect(saved.body).toMatchObject({ imagePrompt: prompt, canEditPrompt: true, generating: false });
  expect(saved.body.promptUpdatedAt).toBeString();
  const publicRead = await call<Cover>(guest, 'GET', url);
  expect(publicRead.body).toMatchObject({ imagePrompt: prompt, canEditPrompt: false });
  expect(publicRead.body).not.toHaveProperty('coverLeaseToken');
  expect(publicRead.body).not.toHaveProperty('context');
  const edit = { imagePrompt: 'A scout in green robes. <plain text>', baseUpdatedAt: saved.body.promptUpdatedAt };
  expect((await call(other, 'PUT', `${url}/prompt`, edit)).status).toBe(403);
  expect((await call(guest, 'PUT', `${url}/prompt`, edit)).status).toBe(403);
  const updates = await Promise.all([1, 2].map(() => call<Cover>(reader, 'PUT', `${url}/prompt`, edit)));
  expect(updates.map(result => result.status).sort()).toEqual([200, 409]);
  const updated = await call<Cover>(reader, 'GET', url);
  expect(updated.body.imagePrompt).toBe(edit.imagePrompt);
  expect(updated.body.image).toEqual(saved.body.image);
  expect(updated.body.promptUpdatedAt).not.toBe(saved.body.promptUpdatedAt);
  // An upload replay must not replace a later prompt edit.
  await call(reader, 'PUT', url, { token: claim.body.token, imageId: image.id, imagePrompt: prompt });
  expect((await call<Cover>(reader, 'GET', url)).body.imagePrompt).toBe(edit.imagePrompt);
  expect((await call<Cover>(moderator, 'GET', url)).body.canEditPrompt).toBe(true);
  const cleared = await call<Cover>(moderator, 'PUT', `${url}/prompt`, { imagePrompt: '  ', baseUpdatedAt: updated.body.promptUpdatedAt });
  expect(cleared.status).toBe(200);
  expect(cleared.body.imagePrompt).toBeNull();
  expect((await call(reader, 'PUT', `${url}/prompt`, { imagePrompt: 'x'.repeat(180001), baseUpdatedAt: cleared.body.promptUpdatedAt })).status).toBe(422);
  expect((await call(reader, 'PUT', `${url}/prompt`, { imagePrompt: 'new', baseUpdatedAt: 'invalid' })).status).toBe(422);
  expect((await call(reader, 'PUT', `/chapter-artwork/${novelId}/99/prompt`, edit)).status).toBe(404);
});

live('prompt edits cannot race generation and old clients do not carry a previous image prompt into a new image', async () => {
  const url = `/chapter-artwork/${novelId}/22`;
  const first = await call<Cover>(reader, 'POST', `${url}/claim`);
  const image = await imageFor(reader);
  await call(reader, 'PUT', url, { token: first.body.token, imageId: image.id, imagePrompt: 'The first image.' });
  const replacement = await call<Cover>(reader, 'POST', `${url}/claim`, { regenerate: true });
  expect(replacement.body.imagePrompt).toBe('The first image.');
  expect((await call(reader, 'PUT', `${url}/prompt`, { imagePrompt: 'Conflicting edit', baseUpdatedAt: replacement.body.promptUpdatedAt })).status).toBe(409);
  const next = await imageFor(reader);
  const legacy = await call<Cover>(reader, 'PUT', url, { token: replacement.body.token, imageId: next.id });
  expect(legacy.status).toBe(200);
  expect(legacy.body.imagePrompt).toBeNull();
  expect(legacy.body.image?.id).toBe(next.id);
});
