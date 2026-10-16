import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { prisma } from '@/lib/db';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

const marker = crypto.randomUUID();
const ids = { novels: [] as string[], users: [] as string[], categories: [] as string[], natures: [] as string[] };
let reader: Actor;
let moderator: Actor;
let novelId: string;
let categoryId: string;
let natureId: string;
type Keyword = { id: string; versions: { id: string; startingChapter: number; endingChapter: number | null }[] };

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  [reader, moderator] = await Promise.all([makeActor('reader', marker), makeActor('moderator', marker)]);
  ids.users.push(reader.id, moderator.id);
  const novel = await prisma.novel.create({ data: { nameEn: `Options ${marker}` } });
  novelId = novel.id;
  ids.novels.push(novelId);
  const styles = await makeStyles(marker);
  categoryId = styles.category.id;
  natureId = styles.nature.id;
  ids.categories.push(categoryId);
  ids.natures.push(natureId);
});
afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST === '1') await cleanup(ids);
});

function keywordBody(extra: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), versionId: crypto.randomUUID(), nameEn: `Keyword ${crypto.randomUUID()}`, novelId, categoryId, natureId, ...extra };
}

describe('initial keyword chapter range', () => {
  live('preserves the legacy default when the new fields are absent', async () => {
    const result = await call<Keyword>(reader, 'POST', '/keywords', keywordBody());
    expect(result.status).toBe(200);
    expect(result.body.versions[0]).toMatchObject({ startingChapter: 0, endingChapter: null });
  });
  live('lets readers create and replay their chosen initial range', async () => {
    const body = keywordBody({ startingChapter: 12, endingChapter: 24 });
    const first = await call<Keyword>(reader, 'POST', '/keywords', body);
    expect(first.status).toBe(200);
    expect(first.body.versions[0]).toMatchObject({ startingChapter: 12, endingChapter: 24 });
    const replay = await call<Keyword>(reader, 'POST', '/keywords', body);
    expect(replay.body).toEqual(first.body);
    expect(await prisma.keywordVersion.count({ where: { keywordId: body.id } })).toBe(1);
  });
  for (const extra of [{ startingChapter: -1 }, { startingChapter: 1.5 }, { startingChapter: 5, endingChapter: 4 }, { endingChapter: -1 }, { endingChapter: 2.5 }]) {
    live(`rejects invalid initial range ${JSON.stringify(extra)} without writing a keyword`, async () => {
      const body = keywordBody(extra);
      expect((await call(reader, 'POST', '/keywords', body)).status).toBe(422);
      expect(await prisma.keyword.count({ where: { id: body.id } })).toBe(0);
    });
  }
  live('keeps a finite ending chapter when a later version starts after it', async () => {
    const body = keywordBody({ startingChapter: 12, endingChapter: 24 });
    const created = await call<Keyword>(reader, 'POST', '/keywords', body);
    expect(created.status).toBe(200);
    const next = await call(reader, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: body.id, currentChapter: 30 });
    expect(next.status).toBe(200);
    expect((await prisma.keywordVersion.findUniqueOrThrow({ where: { id: body.versionId } })).endingChapter).toBe(24);
    const earlier = await call(reader, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: body.id, currentChapter: 10 });
    expect(earlier.status).toBe(400);
  });
});

describe('category highlight effects', () => {
  live('defaults old create payloads to NONE and preserves an effect during old-client edits', async () => {
    const id = crypto.randomUUID();
    ids.categories.push(id);
    const created = await call<{ effect: string; updatedAt: string }>(moderator, 'POST', '/keyword-categories', { id, nameEn: `Plain ${marker}`, color: '#112233' });
    expect(created.status).toBe(200);
    expect(created.body.effect).toBe('NONE');
    const effect = await call<{ effect: string; updatedAt: string }>(moderator, 'PUT', `/keyword-categories/${id}`, { baseUpdatedAt: created.body.updatedAt, effect: 'HEAT' });
    expect(effect.body.effect).toBe('HEAT');
    const oldEdit = await call<{ effect: string }>(moderator, 'PUT', `/keyword-categories/${id}`, { baseUpdatedAt: effect.body.updatedAt, color: '#445566' });
    expect(oldEdit.body.effect).toBe('HEAT');
  });
  for (const effect of ['NONE', 'SPARKLES', 'HEAT', 'SHAKING', 'GLITCHING']) {
    live(`stores and replays ${effect}`, async () => {
      const id = crypto.randomUUID();
      ids.categories.push(id);
      const body = { id, nameEn: `Effect ${effect} ${marker}`, color: '#112233', effect };
      const result = await call<{ effect: string }>(moderator, 'POST', '/keyword-categories', body);
      expect(result.status).toBe(200);
      expect(result.body.effect).toBe(effect);
      expect((await call(moderator, 'POST', '/keyword-categories', body)).body).toEqual(result.body);
    });
  }
  live('rejects unknown effects and retains moderator-only category writes', async () => {
    const body = { id: crypto.randomUUID(), nameEn: `Bad ${marker}`, color: '#112233', effect: 'UNKNOWN' };
    expect((await call(moderator, 'POST', '/keyword-categories', body)).status).toBe(422);
    expect((await call(reader, 'POST', '/keyword-categories', { ...body, effect: 'HEAT' })).status).toBe(403);
  });
});

describe('word VFX', () => {
  type Word = { id: string; wordVfx: string; updatedAt: string };
  for (const wordVfx of ['NONE', 'SPARKLES', 'HEAT', 'SHAKING', 'GLITCHING'] as const) {
    live(`stores and replays independent keyword and alias ${wordVfx}`, async () => {
      const body = keywordBody({ wordVfx });
      const created = await call<Word>(reader, 'POST', '/keywords', body);
      expect(created.status).toBe(200);
      expect(created.body.wordVfx).toBe(wordVfx);
      expect((await call(reader, 'POST', '/keywords', body)).body).toEqual(created.body);
      const aliasBody = { id: crypto.randomUUID(), keywordId: body.id, nameEn: `Alias ${marker}`, wordVfx };
      const alias = await call<Word>(reader, 'POST', '/keyword-aliases', aliasBody);
      expect(alias.status).toBe(200);
      expect(alias.body.wordVfx).toBe(wordVfx);
      expect((await call(reader, 'POST', '/keyword-aliases', aliasBody)).body).toEqual(alias.body);
      const updated = await call<Word>(reader, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: created.body.updatedAt, wordVfx: 'GLITCHING' });
      expect(updated.status).toBe(200);
      expect(updated.body.wordVfx).toBe('GLITCHING');
      expect((await prisma.keywordAlias.findUniqueOrThrow({ where: { id: aliasBody.id } })).wordVfx).toBe(wordVfx);
      const oldEdit = await call<Word>(reader, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: updated.body.updatedAt, matchingType: 'PARTIAL' });
      expect(oldEdit.status).toBe(200);
      expect(oldEdit.body.wordVfx).toBe('GLITCHING');
      const aliasEdit = await call<Word>(reader, 'PUT', `/keyword-aliases/${aliasBody.id}`, { baseUpdatedAt: alias.body.updatedAt, wordVfx: 'NONE' });
      expect(aliasEdit.status).toBe(200);
      expect(aliasEdit.body.wordVfx).toBe('NONE');
      const oldAliasEdit = await call<Word>(reader, 'PUT', `/keyword-aliases/${aliasBody.id}`, { baseUpdatedAt: aliasEdit.body.updatedAt, overrideStyle: true });
      expect(oldAliasEdit.body.wordVfx).toBe('NONE');
    });
  }
  live('defaults legacy words to NONE and rejects unsupported writes', async () => {
    const body = keywordBody();
    const created = await call<Word>(reader, 'POST', '/keywords', body);
    expect(created.body.wordVfx).toBe('NONE');
    expect((await call(reader, 'POST', '/keywords', keywordBody({ wordVfx: 'UNKNOWN' }))).status).toBe(422);
    const alias = await call<Word>(reader, 'POST', '/keyword-aliases', { id: crypto.randomUUID(), keywordId: body.id, nameEn: 'Legacy alias' });
    expect(alias.body.wordVfx).toBe('NONE');
    expect((await call(reader, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: created.body.updatedAt, wordVfx: 'UNKNOWN' })).status).toBe(422);
    expect((await call(reader, 'PUT', `/keyword-aliases/${alias.body.id}`, { baseUpdatedAt: alias.body.updatedAt, wordVfx: 'UNKNOWN' })).status).toBe(422);
    const other = await makeActor('reader', `${marker}-other`);
    ids.users.push(other.id);
    expect((await call(other, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: created.body.updatedAt, wordVfx: 'HEAT' })).status).toBe(403);
    expect((await call(other, 'PUT', `/keyword-aliases/${alias.body.id}`, { baseUpdatedAt: alias.body.updatedAt, wordVfx: 'HEAT' })).status).toBe(403);
  });
});

describe('word VFX colors', () => {
  type Word = { id: string; wordVfx: string; wordVfxColor: string | null; updatedAt: string };
  live('defaults to inherited color, persists custom tints and clears them independently', async () => {
    const body = keywordBody({ wordVfx: 'HEAT', wordVfxColor: '#A1b2C3' });
    const keyword = await call<Word>(reader, 'POST', '/keywords', body);
    expect(keyword.status).toBe(200);
    expect(keyword.body.wordVfxColor).toBe('#A1b2C3');
    const alias = await call<Word>(reader, 'POST', '/keyword-aliases', { id: crypto.randomUUID(), keywordId: body.id, nameEn: 'Color alias', wordVfx: 'SPARKLES' });
    expect(alias.status).toBe(200);
    expect(alias.body.wordVfxColor).toBeNull();
    const tint = await call<Word>(reader, 'PUT', `/keyword-aliases/${alias.body.id}`, { baseUpdatedAt: alias.body.updatedAt, wordVfxColor: '#abcdef' });
    expect(tint.status).toBe(200);
    expect(tint.body.wordVfxColor).toBe('#abcdef');
    const oldEdit = await call<Word>(reader, 'PUT', `/keyword-aliases/${alias.body.id}`, { baseUpdatedAt: tint.body.updatedAt, overrideStyle: true });
    expect(oldEdit.body.wordVfxColor).toBe('#abcdef');
    const clear = await call<Word>(reader, 'PUT', `/keyword-aliases/${alias.body.id}`, { baseUpdatedAt: oldEdit.body.updatedAt, wordVfxColor: null });
    expect(clear.status).toBe(200);
    expect(clear.body.wordVfxColor).toBeNull();
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: body.id } })).wordVfxColor).toBe('#A1b2C3');
    const inherited = await call<Word>(reader, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: keyword.body.updatedAt, wordVfxColor: null });
    expect(inherited.status).toBe(200);
    expect(inherited.body.wordVfxColor).toBeNull();
  });
  for (const wordVfxColor of ['', 'red', '#123', '#12345678', 'url(https://example.org)', '#12345z', '#123456\n']) {
    live(`rejects invalid VFX color ${wordVfxColor}`, async () => {
      expect((await call(reader, 'POST', '/keywords', keywordBody({ wordVfx: 'HEAT', wordVfxColor }))).status).toBe(422);
      const created = await call<Word>(reader, 'POST', '/keywords', keywordBody());
      const alias = await call<Word>(reader, 'POST', '/keyword-aliases', { id: crypto.randomUUID(), keywordId: created.body.id, nameEn: 'Invalid color alias' });
      expect((await call(reader, 'PUT', `/keywords/${created.body.id}`, { baseUpdatedAt: created.body.updatedAt, wordVfxColor })).status).toBe(422);
      expect((await call(reader, 'PUT', `/keyword-aliases/${alias.body.id}`, { baseUpdatedAt: alias.body.updatedAt, wordVfxColor })).status).toBe(422);
    });
  }
});
