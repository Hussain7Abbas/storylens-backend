import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { prisma } from '@/lib/db';
import { currentCursor, FEED_SETTLE_MS, pruneFeed, readFeed } from '@/lib/sync/feed';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

type Feed = {
  novel?: { id: string };
  keywords: { id: string; nameEn: string | null }[];
  aliases: { id: string }[];
  versions: { id: string }[];
  replacements: { id: string; to: string }[];
  biases: { id: string }[];
  deleted: { entity: string; id: string }[];
  cursor: number;
  hasMore: boolean;
};

const marker = crypto.randomUUID().slice(0, 8);
const ids = { novels: [] as string[], users: [] as string[], categories: [] as string[], natures: [] as string[] };
let reader: Actor;
let novelId: string;
let categoryId: string;
let natureId: string;
const translate = ({ en }: { en: string; ar: string }) => en;
// Tests read the feed as if every change had settled.
const later = () => new Date(Date.now() + FEED_SETTLE_MS + 1000);

async function feedSince(since: number, limit?: number) {
  const page = await readFeed(prisma, { novelId }, since, limit ?? 1000, translate, later());
  return page;
}

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  reader = await makeActor('reader', marker);
  ids.users.push(reader.id);
  const novel = await prisma.novel.create({ data: { nameEn: `Feed ${marker}` } });
  novelId = novel.id;
  ids.novels.push(novelId);
  const styles = await makeStyles(marker);
  categoryId = styles.category.id;
  natureId = styles.nature.id;
  ids.categories.push(categoryId);
  ids.natures.push(natureId);
});

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await cleanup(ids);
});

describe('change feed', () => {
  live('records writes, cascades and bulk updates and serves them after a cursor', async () => {
    const start = await currentCursor(prisma, later());
    const keyword = { id: crypto.randomUUID(), versionId: crypto.randomUUID(), nameEn: `K ${marker}`, novelId, categoryId, natureId };
    await call(reader, 'POST', '/keywords', keyword);
    const alias = await call<{ id: string }>(reader, 'POST', '/keyword-aliases', { id: crypto.randomUUID(), keywordId: keyword.id, nameEn: `A ${marker}` });
    const first = { id: crypto.randomUUID(), novelId, from: `x-${marker}`, to: `y-${marker}` };
    await call(reader, 'POST', '/replacements', first);
    // The chain rewrite updates `first` through `updateMany`.
    await call(reader, 'POST', '/replacements', { id: crypto.randomUUID(), novelId, from: `y-${marker}`, to: `z-${marker}` });

    const page = await feedSince(start);
    expect(page.ids.keyword).toEqual([keyword.id]);
    expect(page.ids.keywordVersion).toEqual([keyword.versionId]);
    expect(page.ids.keywordAlias).toEqual([alias.body.id]);
    expect(page.ids.replacement).toContain(first.id);
    expect(page.hasMore).toBe(false);

    const response = await call<Feed>(reader, 'GET', `/sync/novels/${novelId}/changes?since=${start}`);
    expect(response.status).toBe(200);
    // Unsettled changes are returned, but the cursor does not move past them.
    expect(response.body.keywords.map((row) => row.id)).toEqual([keyword.id]);
    expect(response.body.replacements.find((row) => row.id === first.id)?.to).toBe(`z-${marker}`);
    expect(response.body.cursor).toBe(start);

    // A keyword delete cascades to its alias and version.
    const cursor = page.cursor;
    await call(reader, 'DELETE', `/keywords/${keyword.id}`);
    const afterDelete = await feedSince(cursor);
    expect(afterDelete.ids.keyword).toEqual([keyword.id]);
    const deleted = await call<Feed>(reader, 'GET', `/sync/novels/${novelId}/changes?since=${cursor}`);
    expect(deleted.body.deleted).toContainEqual({ entity: 'keyword', id: keyword.id });
  });

  live('pages through more changes than the limit in order', async () => {
    const start = await currentCursor(prisma, later());
    const created: string[] = [];
    for (let index = 0; index < 5; index++) {
      const id = crypto.randomUUID();
      created.push(id);
      await call(reader, 'POST', '/replacements', { id, novelId, from: `page-${index}-${marker}`, to: `to-${index}-${marker}` });
    }
    const seen: string[] = [];
    let cursor = start;
    for (let guard = 0; guard < 10; guard++) {
      const page = await feedSince(cursor, 2);
      seen.push(...page.ids.replacement);
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(created);
    const last = await prisma.syncChange.findFirstOrThrow({ orderBy: { seq: 'desc' } });
    expect(cursor).toBe(Number(last.seq));
  });

  live('answers 410 CURSOR_EXPIRED for a pruned cursor and keeps the newest row', async () => {
    await prisma.syncChange.create({ data: { entity: 'novel', entityId: novelId, novelId, op: 'update' } });
    await prisma.syncChange.create({ data: { entity: 'novel', entityId: novelId, novelId, op: 'update' } });
    const latest = await prisma.syncChange.findFirstOrThrow({ orderBy: { seq: 'desc' } });
    // Prune as if 100 days had passed: everything but the newest row goes.
    await pruneFeed(prisma, new Date(Date.now() + 100 * 24 * 60 * 60 * 1000));
    expect(await prisma.syncChange.count()).toBe(1);
    const expired = await call<{ code: string }>(reader, 'GET', `/sync/novels/${novelId}/changes?since=0`);
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('CURSOR_EXPIRED');
    const fresh = await call(reader, 'GET', `/sync/novels/${novelId}/changes?since=${Number(latest.seq) - 1}`);
    expect(fresh.status).toBe(200);
  });

  live('serves lookups and catalogue changes, including deletions', async () => {
    const start = await currentCursor(prisma, later());
    const category = await prisma.keywordCategory.create({ data: { nameEn: `Feed cat ${marker}`, color: '#000000' } });
    await prisma.keywordCategory.delete({ where: { id: category.id } });
    const novel = await prisma.novel.create({ data: { nameEn: `Feed new ${marker}` } });
    ids.novels.push(novel.id);

    const lookups = await readFeed(prisma, { entities: ['keywordCategory', 'keywordNature'] }, start, 1000, translate, later());
    expect(lookups.ids.keywordCategory).toEqual([category.id]);
    const catalogue = await readFeed(prisma, { entities: ['novel'] }, start, 1000, translate, later());
    expect(catalogue.ids.novel).toContain(novel.id);

    const lookupsResponse = await call<{ deleted: { entity: string; id: string }[] }>(reader, 'GET', `/sync/lookups/changes?since=${start}`);
    expect(lookupsResponse.body.deleted).toContainEqual({ entity: 'keywordCategory', id: category.id });
    const catalogueResponse = await call<{ novels: { id: string }[] }>(reader, 'GET', `/sync/catalogue/changes?since=${start}`);
    expect(catalogueResponse.body.novels.map((row) => row.id)).toContain(novel.id);
    const cursorOnly = await call<{ cursor: number; novels: unknown[] }>(reader, 'GET', '/sync/catalogue/changes');
    expect(cursorOnly.body.novels).toEqual([]);
    expect(typeof cursorOnly.body.cursor).toBe('number');
  });
});
