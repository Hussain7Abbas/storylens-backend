import { imageDescriptionFields, imageDescriptionValue } from '@/lib/keywords/image-description';
import { deprecate } from '@/lib/compat/deprecation';
import { Elysia, t } from 'elysia';
import { authorize, canModerate } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

const params = t.Object({ novelId: t.String({ format: 'uuid' }), chapterNumber: t.Numeric({ minimum: 0, maximum: 2147483647, multipleOf: 1 }) });
const LEASE_MS = 30 * 60_000;
const coverResponse = t.Object({
  image: t.Nullable(t.Object({ id: t.String(), url: t.String() })), generating: t.Boolean(),
  imagePrompt: deprecate(t.Nullable(t.String()), { since: '2026-10-24', removeAfter: '2027-04-30', replacement: 'imageDescription' }),
  imageDescription: t.Nullable(t.String()), promptUpdatedAt: t.Nullable(t.Date()), canEditPrompt: t.Boolean(), canRestart: t.Boolean(),
});
const coverSelect = { id: true, image: { select: { id: true, url: true } }, imageId: true, imageDescription: true, updatedAt: true, coverCreatedById: true, coverLeaseToken: true, coverLeaseExpiresAt: true } as const;
type CoverRow = { id: string; image: { id: string; url: string } | null; imageId: string | null; imageDescription: string | null; updatedAt: Date; coverCreatedById: string | null; coverLeaseToken: string | null; coverLeaseExpiresAt: Date | null };
type CoverActor = { id: string; isGuest: boolean } & Parameters<typeof canModerate>[0];
const claimResponse = t.Composite([coverResponse, t.Object({ token: t.Nullable(t.String()) })]);

/** Artwork descriptions are shared; lease tokens and source chapter text stay private. */
function publicCover(row: CoverRow | null, user: CoverActor) {
  const generating = !!row?.coverLeaseExpiresAt && row.coverLeaseExpiresAt.getTime() > Date.now();
  return {
    image: row?.image ?? null,
    imageDescription: row?.imageDescription ?? null,
    imagePrompt: row?.imageDescription ?? null,
    promptUpdatedAt: row?.updatedAt ?? null,
    canEditPrompt: !user.isGuest && !!row && (row.coverCreatedById === user.id || canModerate(user)),
    generating,
    canRestart: generating && !user.isGuest && row?.coverCreatedById === user.id,
  };
}

export function coverRoutes(prefix: string) {
 const compatibility = prefix === '/chapter-covers' ? { deprecated: { since: '2026-10-17', removeAfter: '2027-04-30', replacement: '/api/user/chapter-artwork/:novelId/:chapterNumber' } } : {};
 const routes = new Elysia({ prefix, tags: ['Chapter covers'] })
  .use(setup)
  .use(authorize('user'))
  .get('/:novelId/:chapterNumber', async ({ prisma, params, authedUser }) => {
    const row = await prisma.chapter.findUnique({ where: { novelId_number: { novelId: params.novelId, number: params.chapterNumber } }, select: coverSelect });
    return publicCover(row, authedUser);
  }, { ...compatibility, params, response: { 200: coverResponse }, detail: { summary: 'Read a shared chapter cover' } })
  .post('/:novelId/:chapterNumber/claim', async ({ prisma, authedUser, params, body }) => {
    if (!await prisma.novel.findUnique({ where: { id: params.novelId }, select: { id: true } }))
      throw new HttpError({ statusCode: 404, message: 'Novel not found' });
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261016, hashtext(${`${params.novelId}:${params.chapterNumber}`}))`;
      const where = { novelId_number: { novelId: params.novelId, number: params.chapterNumber } };
      const row = await tx.chapter.findUnique({ where, select: coverSelect });
      const cover = publicCover(row, authedUser);
      // Restart only the caller's observed reservation. A stale tab cannot replace a newer attempt.
      const restart = cover.canRestart && body?.restartIfUpdatedAt === row?.updatedAt.toISOString();
      if ((cover.generating && !restart) || (cover.image && !body?.regenerate && !restart)) return { ...cover, token: null };
      if (cover.image && row?.coverCreatedById !== authedUser.id && !canModerate(authedUser))
        throw new HttpError({ statusCode: 403, message: 'Only the cover publisher or a moderator can regenerate this cover' });
      const token = crypto.randomUUID();
      const data = { coverLeaseToken: token, coverLeaseExpiresAt: new Date(Date.now() + LEASE_MS), coverCreatedById: authedUser.id };
      const claimed = await tx.chapter.upsert({ where, create: { novelId: params.novelId, number: params.chapterNumber, ...data }, update: data, select: coverSelect });
      return { ...publicCover(claimed, authedUser), token };
    });
  }, { ...compatibility, params, body: t.Optional(t.Object({ regenerate: t.Optional(t.Boolean()), restartIfUpdatedAt: t.Optional(t.String({ format: 'date-time' })) })), response: { 200: claimResponse }, detail: { summary: 'Reserve generation or regeneration of a shared chapter cover' } })
  .put('/:novelId/:chapterNumber', async ({ prisma, authedUser, params, body }) => {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261016, hashtext(${`${params.novelId}:${params.chapterNumber}`}))`;
      const row = await tx.chapter.findUnique({ where: { novelId_number: { novelId: params.novelId, number: params.chapterNumber } }, select: coverSelect });
      // Completed writes replay; a matching replacement lease must still be completed.
      if (row?.imageId === body.imageId && row.coverCreatedById === authedUser.id && row.coverLeaseToken !== body.token) return publicCover(row, authedUser);
      const file = await tx.file.findUnique({ where: { id: body.imageId } });
      if (!file || file.type !== 'Image' || file.userId !== authedUser.id)
        throw new HttpError({ statusCode: 403, message: 'Use an image uploaded by your account' });
      const result = await tx.chapter.updateMany({
        where: { novelId: params.novelId, number: params.chapterNumber, coverCreatedById: authedUser.id, coverLeaseToken: body.token, coverLeaseExpiresAt: { gt: new Date() } },
        data: { imageId: body.imageId, imageDescription: imageDescriptionValue(body)?.trim() || null, coverLeaseToken: null, coverLeaseExpiresAt: null },
      });
      if (!result.count) throw new HttpError({ statusCode: 409, message: 'The chapter cover reservation expired or was already completed' });
      return publicCover(await tx.chapter.findUniqueOrThrow({ where: { novelId_number: { novelId: params.novelId, number: params.chapterNumber } }, select: coverSelect }), authedUser);
    });
  }, { ...compatibility, params, response: { 200: coverResponse }, body: t.Object({ token: t.String({ format: 'uuid' }), imageId: t.String({ format: 'uuid' }), ...imageDescriptionFields }), detail: { summary: 'Save a generated shared chapter cover' } })
  .delete('/:novelId/:chapterNumber/claim', async ({ prisma, authedUser, params, body }) => {
    await prisma.chapter.updateMany({ where: { novelId: params.novelId, number: params.chapterNumber, coverCreatedById: authedUser.id, coverLeaseToken: body.token }, data: { coverLeaseToken: null, coverLeaseExpiresAt: null } });
    return { ok: true };
  }, { ...compatibility, params, body: t.Object({ token: t.String({ format: 'uuid' }) }), detail: { summary: 'Release an unfinished chapter cover reservation' } });
 return prefix === '/chapter-artwork' ? routes
  .put('/:novelId/:chapterNumber/prompt', async ({ prisma, authedUser, params, body }) => {
    if (imageDescriptionValue(body) === undefined) throw new HttpError({ statusCode: 422, message: 'An image description is required' });
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261016, hashtext(${`${params.novelId}:${params.chapterNumber}`}))`;
      const where = { novelId_number: { novelId: params.novelId, number: params.chapterNumber } };
      const row = await tx.chapter.findUnique({ where, select: coverSelect });
      if (!row?.image) throw new HttpError({ statusCode: 404, message: 'Chapter artwork not found' });
      if (row.coverCreatedById !== authedUser.id && !canModerate(authedUser))
        throw new HttpError({ statusCode: 403, message: 'Only the cover publisher or a moderator can edit this prompt' });
      if (row.coverLeaseExpiresAt && row.coverLeaseExpiresAt.getTime() > Date.now())
        throw new HttpError({ statusCode: 409, message: 'Wait for chapter cover generation to finish before editing its prompt' });
      const result = await tx.chapter.updateMany({ where: { id: row.id, updatedAt: new Date(body.baseUpdatedAt) }, data: { imageDescription: (imageDescriptionValue(body) ?? "").trim() || null, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) } });
      if (!result.count) throw new HttpError({ statusCode: 409, code: 'STALE_WRITE', message: 'The chapter artwork changed. Reload its saved prompt before saving again.' });
      return publicCover(await tx.chapter.findUniqueOrThrow({ where, select: coverSelect }), authedUser);
    });
  }, { ...compatibility, params, response: { 200: coverResponse }, body: t.Object({ ...imageDescriptionFields, baseUpdatedAt: t.String({ format: 'date-time' }) }), detail: { summary: 'Edit a shared chapter cover image prompt' } }) : routes;
}

export const chapterCovers = coverRoutes('/chapter-covers');
export const chapterArtwork = coverRoutes('/chapter-artwork');
