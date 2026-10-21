import type { PrismaClient } from '@prisma/client';
import { canModerate } from '@/middleware/authorize';
import { HttpError } from '@/utils/errors';
import { chapterContextSchema, type ChapterContext } from './schema';
import { inactiveEntities, mentionRecords, parseStoredContext } from './storage';

/** Replace an existing JSON property without admitting prototype or array-shape writes. */
export function replaceContextProperty(
  context: ChapterContext,
  path: (string | number)[],
  value: unknown,
): unknown {
  const result: unknown = structuredClone(context);
  let parent = result;
  for (const [index, key] of path.entries()) {
    if (
      !parent ||
      typeof parent !== 'object' ||
      !Object.hasOwn(parent, key) ||
      (Array.isArray(parent)
        ? typeof key !== 'number' || key < 0 || key >= parent.length
        : typeof key !== 'string') ||
      ['__proto__', 'prototype', 'constructor'].includes(String(key))
    )
      throw new HttpError({
        statusCode: 422,
        message: 'Choose an existing chapter context property',
      });
    if (index === path.length - 1) Reflect.set(parent, key, value);
    else parent = Reflect.get(parent, key);
  }
  return result;
}

export function editContextProperty(
  prisma: PrismaClient,
  params: { novelId: string; chapterNumber: number },
  authedUser: Parameters<typeof canModerate>[0] & { id: string; isGuest: boolean },
  body: { baseUpdatedAt: string; path: (string | number)[]; value: unknown },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261017, hashtext(${`${params.novelId}:${params.chapterNumber}`}))`;
    const where = { novelId: params.novelId, number: params.chapterNumber };
    const row = await tx.chapter.findUnique({ where: { novelId_number: where } });
    const stored = parseStoredContext(row?.context);
    if (!row || !stored)
      throw new HttpError({ statusCode: 404, message: 'Chapter context not found' });
    if (
      authedUser.isGuest ||
      (row.contextCreatedById !== authedUser.id && !canModerate(authedUser))
    )
      throw new HttpError({
        statusCode: 403,
        message: 'Only the context publisher or a moderator can edit it',
      });
    if (row.contextLeaseExpiresAt && row.contextLeaseExpiresAt.getTime() > Date.now())
      throw new HttpError({
        statusCode: 409,
        message: 'Wait for chapter context generation to finish before editing',
      });
    if (row.updatedAt.getTime() !== new Date(body.baseUpdatedAt).getTime())
      throw new HttpError({
        statusCode: 409,
        message: 'Chapter context changed. Reload it before saving your edit.',
      });
    const candidate = replaceContextProperty(stored, body.path, body.value);
    const parsed = chapterContextSchema.safeParse(candidate);
    if (!parsed.success || JSON.stringify(candidate).length > 180000)
      throw new HttpError({
        statusCode: 422,
        message: 'Invalid structured chapter context',
      });
    const mentions = mentionRecords(parsed.data);
    const ids = [
      ...new Set(mentions.flatMap((item) => (item.keywordId ? [item.keywordId] : []))),
    ];
    if (
      (await tx.keyword.count({
        where: { novelId: params.novelId, id: { in: ids } },
      })) !== ids.length
    )
      throw new HttpError({
        statusCode: 422,
        message: 'Context entities must belong to this novel',
      });
    const changed = await tx.chapter.updateMany({
      where: { ...where, updatedAt: new Date(body.baseUpdatedAt) },
      data: { context: parsed.data },
    });
    if (!changed.count)
      throw new HttpError({
        statusCode: 409,
        message: 'Chapter context changed. Reload it before saving your edit.',
      });
    await tx.chapterMention.deleteMany({ where: { chapterId: row.id } });
    if (mentions.length)
      await tx.chapterMention.createMany({
        data: mentions.map((mention) => ({
          ...mention,
          chapterId: row.id,
          novelId: params.novelId,
          chapterNumber: params.chapterNumber,
        })),
      });
    const saved = await tx.chapter.findUniqueOrThrow({ where: { id: row.id } });
    return {
      context: parsed.data,
      contentHash: saved.contextHash,
      generating: false,
      updatedAt: saved.updatedAt,
      canEdit: true,
      inactiveEntities: await inactiveEntities(tx, params.novelId, params.chapterNumber),
    };
  });
}
