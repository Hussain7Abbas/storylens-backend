import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

const params = t.Object({ novelId: t.String({ format: 'uuid' }), chapterNumber: t.Numeric({ minimum: 0, maximum: 2147483647, multipleOf: 1 }) });
const LEASE_MS = 30 * 60_000;
const coverResponse = t.Object({ image: t.Nullable(t.Object({ id: t.String(), url: t.String() })), generating: t.Boolean() });
const claimResponse = t.Composite([coverResponse, t.Object({ token: t.Nullable(t.String()) })]);

/** Only public artwork and lease status leave the server; claim tokens are private. */
function publicCover(row: { image: { id: string; url: string } | null; coverLeaseExpiresAt: Date | null } | null) {
  return { image: row?.image ? { id: row.image.id, url: row.image.url } : null, generating: !row?.image && !!row?.coverLeaseExpiresAt && row.coverLeaseExpiresAt.getTime() > Date.now() };
}

export function coverRoutes(prefix: string) {
 const compatibility = prefix === '/chapter-covers' ? { deprecated: { since: '2026-10-17', removeAfter: '2027-04-30', replacement: '/api/user/chapter-artwork/:novelId/:chapterNumber' } } : {};
 return new Elysia({ prefix, tags: ['Chapter covers'] })
  .use(setup)
  .use(authorize('user'))
  .get('/:novelId/:chapterNumber', async ({ prisma, params }) => {
    const row = await prisma.chapter.findUnique({ where: { novelId_number: { novelId: params.novelId, number: params.chapterNumber } }, include: { image: true } });
    return publicCover(row);
  }, { ...compatibility, params, response: { 200: coverResponse }, detail: { summary: 'Read a shared chapter cover' } })
  .post('/:novelId/:chapterNumber/claim', async ({ prisma, authedUser, params }) => {
    if (!await prisma.novel.findUnique({ where: { id: params.novelId }, select: { id: true } }))
      throw new HttpError({ statusCode: 404, message: 'Novel not found' });
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261016, hashtext(${`${params.novelId}:${params.chapterNumber}`}))`;
      const where = { novelId_number: { novelId: params.novelId, number: params.chapterNumber } };
      const row = await tx.chapter.findUnique({ where, include: { image: true } });
      const cover = publicCover(row);
      if (cover.image || cover.generating) return { ...cover, token: null };
      const token = crypto.randomUUID();
      const data = { coverLeaseToken: token, coverLeaseExpiresAt: new Date(Date.now() + LEASE_MS), coverCreatedById: authedUser.id };
      await tx.chapter.upsert({ where, create: { novelId: params.novelId, number: params.chapterNumber, ...data }, update: data });
      return { image: null, generating: true, token };
    });
  }, { ...compatibility, params, response: { 200: claimResponse }, detail: { summary: 'Reserve generation of a missing shared chapter cover' } })
  .put('/:novelId/:chapterNumber', async ({ prisma, authedUser, params, body }) => {
    return prisma.$transaction(async tx => {
      const row = await tx.chapter.findUnique({ where: { novelId_number: { novelId: params.novelId, number: params.chapterNumber } }, include: { image: true } });
      // Completed writes replay without replacing a shared image.
      if (row?.imageId === body.imageId && row.coverCreatedById === authedUser.id) return publicCover(row);
      const file = await tx.file.findUnique({ where: { id: body.imageId } });
      if (!file || file.type !== 'Image' || file.userId !== authedUser.id)
        throw new HttpError({ statusCode: 403, message: 'Use an image uploaded by your account' });
      const result = await tx.chapter.updateMany({
        where: { novelId: params.novelId, number: params.chapterNumber, imageId: null, coverCreatedById: authedUser.id, coverLeaseToken: body.token, coverLeaseExpiresAt: { gt: new Date() } },
        data: { imageId: body.imageId, coverLeaseToken: null, coverLeaseExpiresAt: null },
      });
      if (!result.count) throw new HttpError({ statusCode: 409, message: 'The chapter cover reservation expired or was already completed' });
      return { image: { id: file.id, url: file.url }, generating: false };
    });
  }, { ...compatibility, params, response: { 200: coverResponse }, body: t.Object({ token: t.String({ format: 'uuid' }), imageId: t.String({ format: 'uuid' }) }), detail: { summary: 'Save a generated shared chapter cover' } })
  .delete('/:novelId/:chapterNumber/claim', async ({ prisma, authedUser, params, body }) => {
    await prisma.chapter.updateMany({ where: { novelId: params.novelId, number: params.chapterNumber, coverCreatedById: authedUser.id, coverLeaseToken: body.token, imageId: null }, data: { coverLeaseToken: null, coverLeaseExpiresAt: null } });
    return { ok: true };
  }, { ...compatibility, params, body: t.Object({ token: t.String({ format: 'uuid' }) }), detail: { summary: 'Release an unfinished chapter cover reservation' } }); }

export const chapterCovers = coverRoutes('/chapter-covers');
export const chapterArtwork = coverRoutes('/chapter-artwork');
