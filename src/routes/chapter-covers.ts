import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

const params = t.Object({ novelId: t.String({ format: 'uuid' }), chapterNumber: t.Numeric({ minimum: 0, maximum: 2147483647, multipleOf: 1 }) });
const LEASE_MS = 30 * 60_000;
const coverResponse = t.Object({ image: t.Nullable(t.Object({ id: t.String(), url: t.String() })), generating: t.Boolean() });
const claimResponse = t.Composite([coverResponse, t.Object({ token: t.Nullable(t.String()) })]);

/** Only public artwork and lease status leave the server; claim tokens are private. */
function publicCover(row: { image: { id: string; url: string } | null; leaseExpiresAt: Date | null } | null) {
  return { image: row?.image ? { id: row.image.id, url: row.image.url } : null, generating: !row?.image && !!row?.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now() };
}

export const chapterCovers = new Elysia({ prefix: '/chapter-covers', tags: ['Chapter covers'] })
  .use(setup)
  .use(authorize('user'))
  .get('/:novelId/:chapterNumber', async ({ prisma, params }) => {
    const row = await prisma.chapterCover.findUnique({ where: { novelId_chapterNumber: params }, include: { image: true } });
    return publicCover(row);
  }, { params, response: { 200: coverResponse }, detail: { summary: 'Read a shared chapter cover' } })
  .post('/:novelId/:chapterNumber/claim', async ({ prisma, authedUser, params }) => {
    if (!await prisma.novel.findUnique({ where: { id: params.novelId }, select: { id: true } }))
      throw new HttpError({ statusCode: 404, message: 'Novel not found' });
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261016, hashtext(${`${params.novelId}:${params.chapterNumber}`}))`;
      const where = { novelId_chapterNumber: params };
      const row = await tx.chapterCover.findUnique({ where, include: { image: true } });
      const cover = publicCover(row);
      if (cover.image || cover.generating) return { ...cover, token: null };
      const token = crypto.randomUUID();
      const data = { leaseToken: token, leaseExpiresAt: new Date(Date.now() + LEASE_MS), createdById: authedUser.id };
      await tx.chapterCover.upsert({ where, create: { ...params, ...data }, update: data });
      return { image: null, generating: true, token };
    });
  }, { params, response: { 200: claimResponse }, detail: { summary: 'Reserve generation of a missing shared chapter cover' } })
  .put('/:novelId/:chapterNumber', async ({ prisma, authedUser, params, body }) => {
    return prisma.$transaction(async tx => {
      const row = await tx.chapterCover.findUnique({ where: { novelId_chapterNumber: params }, include: { image: true } });
      // Completed writes replay without replacing a shared image.
      if (row?.imageId === body.imageId && row.createdById === authedUser.id) return publicCover(row);
      const file = await tx.file.findUnique({ where: { id: body.imageId } });
      if (!file || file.type !== 'Image' || file.userId !== authedUser.id)
        throw new HttpError({ statusCode: 403, message: 'Use an image uploaded by your account' });
      const result = await tx.chapterCover.updateMany({
        where: { ...params, imageId: null, createdById: authedUser.id, leaseToken: body.token, leaseExpiresAt: { gt: new Date() } },
        data: { imageId: body.imageId, leaseToken: null, leaseExpiresAt: null },
      });
      if (!result.count) throw new HttpError({ statusCode: 409, message: 'The chapter cover reservation expired or was already completed' });
      return { image: { id: file.id, url: file.url }, generating: false };
    });
  }, { params, response: { 200: coverResponse }, body: t.Object({ token: t.String({ format: 'uuid' }), imageId: t.String({ format: 'uuid' }) }), detail: { summary: 'Save a generated shared chapter cover' } })
  .delete('/:novelId/:chapterNumber/claim', async ({ prisma, authedUser, params, body }) => {
    await prisma.chapterCover.updateMany({ where: { ...params, createdById: authedUser.id, leaseToken: body.token, imageId: null }, data: { leaseToken: null, leaseExpiresAt: null } });
    return { ok: true };
  }, { params, body: t.Object({ token: t.String({ format: 'uuid' }) }), detail: { summary: 'Release an unfinished chapter cover reservation' } });
