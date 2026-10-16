import { Prisma, type PrismaClient } from '@prisma/client';
import {
  chapterContextSchema,
  type ChapterContext,
  type InactiveEntity,
  type ContinuityContext,
} from './schema';

export function parseStoredContext(value: unknown): ChapterContext | null {
  const parsed = chapterContextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export async function inactiveEntities(
  db: PrismaClient,
  novelId: string,
  chapterNumber: number,
): Promise<InactiveEntity[]> {
  const rows = await db.$queryRaw<
    { entityKey: string; name: string; keywordId: string | null; chapterNumber: number }[]
  >`
    SELECT DISTINCT ON ("entityKey") "entityKey", "name", "keywordId", "chapterNumber"
    FROM "ChapterMention" WHERE "novelId" = ${novelId} AND "chapterNumber" <= ${chapterNumber}
    AND "chapterNumber" >= ${Math.max(0, chapterNumber - 15)}
    ORDER BY "entityKey", "chapterNumber" DESC LIMIT 200`;
  return rows
    .filter((row) => row.chapterNumber < chapterNumber && chapterNumber - row.chapterNumber < 15)
    .map((row) => ({
      entityKey: row.entityKey,
      name: row.name,
      keywordId: row.keywordId,
      lastMentionedChapter: row.chapterNumber,
      missingChapters: chapterNumber - row.chapterNumber,
    }));
}
export function mentionRecords(context: ChapterContext) {
  const entities = new Map(
    context.scenes.flatMap((scene) =>
      scene.entities.map((entity) => [entity.entityKey, entity] as const),
    ),
  );
  return [...entities.values()].map((entity) => {
    const state: Record<string, { value: string | null; sceneId: string; evidence: string }> = {};
    // Scene order, not model array order, determines the last change in a chapter.
    for (const scene of context.scenes)
      for (const change of context.stateChanges.filter(
        (change) => change.sceneId === scene.id && change.entityKey === entity.entityKey,
      ))
        state[change.field] = {
          value: change.value,
          sceneId: change.sceneId,
          evidence: change.evidence,
        };
    return { entityKey: entity.entityKey, keywordId: entity.keywordId, name: entity.name, state };
  });
}
export async function imageContinuity(
  db: PrismaClient,
  novelId: string,
  chapterNumber: number,
  entityKeys: string[],
): Promise<ContinuityContext> {
  const chapters = await db.chapter.findMany({
    where: {
      novelId,
      number: { gte: Math.max(0, chapterNumber - 2), lte: Math.min(2147483647, chapterNumber + 2) },
      context: { not: Prisma.DbNull },
    },
    select: { number: true, context: true },
    orderBy: { number: 'asc' },
  });
  const result: ContinuityContext = { chapters: [], lastMentions: [], persistentState: [] };
  for (const chapter of chapters) {
    const context = parseStoredContext(chapter.context);
    if (context) result.chapters.push({ chapterNumber: chapter.number, context });
  }
  if (!entityKeys.length) return result;
  const mentions = await db.$queryRaw<
    { entityKey: string; name: string; chapterNumber: number; context: unknown }[]
  >`
    SELECT DISTINCT ON (m."entityKey") m."entityKey", m.name, m."chapterNumber", c.context
    FROM "ChapterMention" m JOIN "Chapter" c ON c.id=m."chapterId"
    WHERE m."novelId"=${novelId} AND m."chapterNumber"<${chapterNumber}
      AND m."entityKey" IN (${Prisma.join(entityKeys)})
    ORDER BY m."entityKey", m."chapterNumber" DESC`;
  for (const mention of mentions) {
    const context = parseStoredContext(mention.context);
    if (context) {
      const relevant = {
        ...context,
        scenes: context.scenes
          .map((scene) => ({
            ...scene,
            entities: scene.entities.filter((entity) => entity.entityKey === mention.entityKey),
          }))
          .filter((scene) => scene.entities.length),
        stateChanges: context.stateChanges.filter(
          (change) => change.entityKey === mention.entityKey,
        ),
      };
      result.lastMentions.push({
        entityKey: mention.entityKey,
        name: mention.name,
        chapterNumber: mention.chapterNumber,
        context: relevant,
      });
    }
  }
  result.persistentState = await db.$queryRaw<ContinuityContext['persistentState']>`
    SELECT DISTINCT ON (m."entityKey", fact.key) m."entityKey", m."chapterNumber", fact.key AS field, fact.value
    FROM "ChapterMention" m CROSS JOIN LATERAL jsonb_each(m.state) fact
    WHERE m."novelId" = ${novelId} AND m."chapterNumber" < ${chapterNumber}
      AND m."entityKey" IN (${Prisma.join(entityKeys)})
    ORDER BY m."entityKey", fact.key, m."chapterNumber" DESC LIMIT 2000`;
  return result;
}
