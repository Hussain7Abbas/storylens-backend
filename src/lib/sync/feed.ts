import type { PrismaClient } from '@prisma/client';
import { HttpError } from '@/utils/errors';

/** Protocol version of this release's sync contract; the extension refuses to sync below it. */
export const SYNC_PROTOCOL_VERSION = 2;

export const FEED_ENTITIES = [
  'novel',
  'keyword',
  'keywordAlias',
  'keywordVersion',
  'replacement',
  'websiteNovelBias',
  'keywordCategory',
  'keywordNature',
] as const;
export type FeedEntity = (typeof FEED_ENTITIES)[number];

/** Feed rows are kept this long; an older cursor answers 410 `CURSOR_EXPIRED`. */
export const FEED_RETENTION_DAYS = 90;

/**
 * Sequence values are taken at insert time but become visible at commit, so a
 * slow transaction can commit a lower `seq` after a higher one was read. Cursors
 * never move past changes younger than this; those rows are sent again next time
 * (applying rows is idempotent).
 */
export const FEED_SETTLE_MS = 60_000;

export const FEED_DEFAULT_LIMIT = 1000;

type FeedScope = { novelId: string } | { entities: FeedEntity[] };

export type FeedPage = {
  /** Latest change of each entity in the page, by entity. */
  ids: Record<FeedEntity, string[]>;
  cursor: number;
  hasMore: boolean;
};

function scopeWhere(scope: FeedScope) {
  return 'novelId' in scope ? { novelId: scope.novelId } : { entity: { in: scope.entities } };
}

/** The cursor a full pull starts from: every change before it is in that pull. */
export async function currentCursor(prisma: PrismaClient, now = new Date()): Promise<number> {
  const settleFrom = new Date(now.getTime() - FEED_SETTLE_MS);
  const unsettled = await prisma.syncChange.findFirst({
    where: { at: { gt: settleFrom } },
    orderBy: { seq: 'asc' },
    select: { seq: true },
  });
  if (unsettled) return Number(unsettled.seq) - 1;
  const latest = await prisma.syncChange.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });
  return latest ? Number(latest.seq) : 0;
}

/**
 * Reads one page of changes after `since`. Throws 410 `CURSOR_EXPIRED` when
 * changes after the cursor were already pruned, so the client pulls in full.
 */
export async function readFeed(
  prisma: PrismaClient,
  scope: FeedScope,
  since: number,
  limit: number,
  t: (messages: { en: string; ar: string }) => string,
  now = new Date(),
): Promise<FeedPage> {
  const oldest = await prisma.syncChange.findFirst({ orderBy: { seq: 'asc' }, select: { seq: true } });
  if (oldest && since < Number(oldest.seq) - 1) {
    throw new HttpError({
      statusCode: 410,
      code: 'CURSOR_EXPIRED',
      message: t({ en: 'Sync cursor expired; download the data again', ar: 'انتهت صلاحية مؤشر المزامنة؛ نزّل البيانات مجددًا' }),
    });
  }

  const rows = await prisma.syncChange.findMany({
    where: { ...scopeWhere(scope), seq: { gt: BigInt(since) } },
    orderBy: { seq: 'asc' },
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const settleFrom = now.getTime() - FEED_SETTLE_MS;
  const firstUnsettled = page.find((row) => row.at.getTime() > settleFrom);

  const ids = Object.fromEntries(FEED_ENTITIES.map((entity) => [entity, new Set<string>()])) as Record<
    FeedEntity,
    Set<string>
  >;
  for (const row of page) {
    if ((FEED_ENTITIES as readonly string[]).includes(row.entity)) ids[row.entity as FeedEntity].add(row.entityId);
  }

  const last = page.at(-1);
  const lastSeq = last ? Number(last.seq) : since;
  const cursor = firstUnsettled ? Math.max(since, Number(firstUnsettled.seq) - 1) : lastSeq;

  return {
    ids: Object.fromEntries(FEED_ENTITIES.map((entity) => [entity, [...ids[entity]]])) as Record<FeedEntity, string[]>,
    cursor,
    // A held-back cursor would return the same unsettled rows again; stop until they settle.
    hasMore: !firstUnsettled && rows.length > limit,
  };
}

/** IDs that changed but no longer exist, as `{ entity, id }`. */
export function deletedIds(entity: FeedEntity, changed: string[], found: { id: string }[]) {
  const present = new Set(found.map((row) => row.id));
  return changed.filter((id) => !present.has(id)).map((id) => ({ entity, id }));
}

/**
 * Deletes feed rows older than the retention window, always keeping the newest
 * row so an expired cursor can still be recognized.
 */
export async function pruneFeed(prisma: PrismaClient, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - FEED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const latest = await prisma.syncChange.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });
  if (!latest) return 0;
  const { count } = await prisma.syncChange.deleteMany({ where: { at: { lt: cutoff }, seq: { lt: latest.seq } } });
  return count;
}
