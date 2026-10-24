import { Prisma, type PrismaClient } from '@prisma/client';
import type { ContextChapter, ContextTracking, EntityLastSeen } from './schema';
import { parseStoredContext } from './storage';

/** One published predecessor only, plus small last-seen pointers for explicitly present entities. */
export async function contextTracking(
  db: PrismaClient,
  novelId: string,
  chapterNumber: number,
  entityKeys: string[],
): Promise<ContextTracking> {
  const row = await db.chapter.findFirst({
    where: {
      novelId,
      number: { lt: chapterNumber },
      context: { path: ['schemaVersion'], equals: 1 },
      OR: [
        { contextLeaseExpiresAt: null },
        { contextLeaseExpiresAt: { lte: new Date() } },
      ],
    },
    orderBy: { number: 'desc' },
    select: { number: true, context: true },
  });
  const context = parseStoredContext(row?.context);
  const lastSeen = await db.$queryRaw<EntityLastSeen[]>`
  SELECT * FROM (
    SELECT DISTINCT ON ("entityKey") "entityKey", "name", "keywordId", "chapterNumber" AS "lastSeenChapter"
    FROM "ChapterMention" WHERE "novelId"=${novelId} AND "chapterNumber"<${chapterNumber}
     AND ("keywordId" IS NULL OR "entityKey" IN (${Prisma.join(entityKeys.length ? entityKeys : [''])}))
    ORDER BY "entityKey", "chapterNumber" DESC
  ) latest
  ORDER BY ("entityKey" IN (${Prisma.join(entityKeys.length ? entityKeys : [''])})) DESC,
    "lastSeenChapter" DESC, "entityKey" ASC LIMIT 4000`;
  return {
    previous: row && context ? { chapterNumber: row.number, context } : null,
    lastSeen,
  };
}

/** Bulk reads are scoped to one novel and strictly earlier chapters; no reservations or future data. */
export async function bulkContexts(
  db: PrismaClient,
  novelId: string,
  beforeChapter: number,
  chapterNumbers: number[],
  entityKeys: string[] = [],
): Promise<ContextChapter[]> {
  if (!chapterNumbers.length) return [];
  const rows = await db.chapter.findMany({
    where: {
      novelId,
      number: { in: [...new Set(chapterNumbers)], lt: beforeChapter },
      OR: [
        { contextLeaseExpiresAt: null },
        { contextLeaseExpiresAt: { lte: new Date() } },
      ],
    },
    select: { number: true, context: true },
    orderBy: { number: 'asc' },
  });
  return rows.flatMap((row) => {
    const context = parseStoredContext(row.context);
    if (!context) return [];
    const relevant = !entityKeys.length
      ? context
      : {
          ...context,
          summary: context.summary.slice(0, 400),
          scenes: context.scenes
            .map((scene) => ({
              ...scene,
              entities: scene.entities.filter((entity) =>
                entityKeys.includes(entity.entityKey),
              ),
            }))
            .filter((scene) => scene.entities.length),
          stateChanges: context.stateChanges.filter((change) =>
            entityKeys.includes(change.entityKey),
          ),
        };
    return [{ chapterNumber: row.number, context: relevant }];
  });
}
