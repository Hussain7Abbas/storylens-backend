import { Elysia, t } from 'elysia';
import { setup } from '@/setup';
import { canModerate } from '@/middleware/authorize';
import { authorize } from '@/middleware/authorize';
import { HttpError } from '@/utils/errors';
import { chapterContextSchema } from '@/lib/chapter-context/schema';
import {
  inactiveEntities,
  imageContinuity,
  mentionRecords,
  parseStoredContext,
} from '@/lib/chapter-context/storage';

const params = t.Object({
  novelId: t.String({ format: 'uuid' }),
  chapterNumber: t.Numeric({ minimum: 0, maximum: 2147483647, multipleOf: 1 }),
});
const hash = t.String({ pattern: '^[a-f0-9]{64}$' });
const leaseBody = t.Object({
  contentHash: hash,
  language: t.Union([t.Literal('en'), t.Literal('ar')]),
});
const leaseMs = 15 * 60_000;
export const chapterContexts = new Elysia({ prefix: '/chapter-context', tags: ['Chapter context'] })
  .use(setup)
  .use(authorize('user'))
  .get(
    '/:novelId/:chapterNumber',
    async ({ prisma, params }) => {
      const row = await prisma.chapter.findUnique({
        where: { novelId_number: { novelId: params.novelId, number: params.chapterNumber } },
      });
      return {
        context: parseStoredContext(row?.context),
        contentHash: row?.contextHash ?? null,
        generating:
          !!row?.contextLeaseExpiresAt && row.contextLeaseExpiresAt.getTime() > Date.now(),
        inactiveEntities: await inactiveEntities(prisma, params.novelId, params.chapterNumber),
      };
    },
    {
      params,
      response: t.Unknown(),
      detail: {
        summary:
          'Read this chapter context and recently absent entities; never neighboring contexts',
      },
    },
  )
  .get(
    '/:novelId/:chapterNumber/continuity',
    async ({ prisma, params, query }) => {
      let requested: unknown;
      try {
        requested = query.entities?.startsWith('[')
          ? JSON.parse(query.entities)
          : (query.entities ?? '').split(',').filter(Boolean);
      } catch {
        throw new HttpError({ statusCode: 422, message: 'Invalid entity keys' });
      }
      if (
        !Array.isArray(requested) ||
        requested.length > 80 ||
        requested.some(
          (key) => typeof key !== 'string' || key.length > 200 || !/^(keyword:|name:)/u.test(key),
        )
      )
        throw new HttpError({ statusCode: 422, message: 'Invalid entity keys' });
      const keys = [...new Set(requested as string[])];
      return imageContinuity(prisma, params.novelId, params.chapterNumber, keys);
    },
    {
      params,
      query: t.Object({ entities: t.Optional(t.String({ maxLength: 20000 })) }),
      response: t.Unknown(),
      detail: {
        summary:
          'Load neighboring chapter contexts and returning entity states only when preparing an image',
      },
    },
  )
  .post(
    '/:novelId/:chapterNumber/claim',
    async ({ prisma, params, authedUser, body }) => {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261017, hashtext(${`${params.novelId}:${params.chapterNumber}`}))`;
        if (!(await tx.novel.findUnique({ where: { id: params.novelId } })))
          throw new HttpError({ statusCode: 404, message: 'Novel not found' });
        const where = { novelId_number: { novelId: params.novelId, number: params.chapterNumber } };
        const row = await tx.chapter.findUnique({ where });
        if (
          parseStoredContext(row?.context) &&
          (body.onlyIfMissing || row?.contextHash === body.contentHash)
        )
          return { token: null, ready: true };
        if (
          row?.contextHash &&
          parseStoredContext(row.context) &&
          row.contextCreatedById !== authedUser.id &&
          !canModerate(authedUser)
        )
          return { token: null, ready: true };
        if (row?.contextLeaseExpiresAt && row.contextLeaseExpiresAt.getTime() > Date.now())
          return { token: null, ready: false };
        const token = crypto.randomUUID();
        const data = {
          contextLeaseToken: token,
          contextLeaseExpiresAt: new Date(Date.now() + leaseMs),
          contextLeaseHash: body.contentHash,
          contextCreatedById: authedUser.id,
        };
        await tx.chapter.upsert({
          where,
          create: { novelId: params.novelId, number: params.chapterNumber, ...data },
          update: data,
        });
        return { token, ready: false };
      });
    },
    {
      params,
      body: t.Composite([leaseBody, t.Object({ onlyIfMissing: t.Optional(t.Boolean()) })]),
      response: t.Object({ token: t.Nullable(t.String()), ready: t.Boolean() }),
      detail: { summary: 'Reserve generation of a missing or changed chapter context' },
    },
  )
  .put(
    '/:novelId/:chapterNumber',
    async ({ prisma, params, authedUser, body }) => {
      const parsed = chapterContextSchema.safeParse(body.context);
      if (!parsed.success || JSON.stringify(body.context).length > 180000)
        throw new HttpError({ statusCode: 422, message: 'Invalid structured chapter context' });
      const mentions = mentionRecords(parsed.data);
      const ids = mentions.flatMap((item) => (item.keywordId ? [item.keywordId] : []));
      if (
        (await prisma.keyword.count({ where: { novelId: params.novelId, id: { in: ids } } })) !==
        new Set(ids).size
      )
        throw new HttpError({
          statusCode: 422,
          message: 'Context entities must belong to this novel',
        });
      await prisma.$transaction(async (tx) => {
        const where = { novelId: params.novelId, number: params.chapterNumber };
        const row = await tx.chapter.findUnique({ where: { novelId_number: where } });
        if (
          row?.contextHash === body.contentHash &&
          row.contextCreatedById === authedUser.id &&
          parseStoredContext(row.context)
        )
          return;
        const result = await tx.chapter.updateMany({
          where: {
            ...where,
            contextCreatedById: authedUser.id,
            contextLeaseToken: body.token,
            contextLeaseHash: body.contentHash,
            contextLeaseExpiresAt: { gt: new Date() },
          },
          data: {
            context: parsed.data,
            contextHash: body.contentHash,
            contextLanguage: body.language,
            contextGeneratedAt: new Date(),
            contextLeaseToken: null,
            contextLeaseExpiresAt: null,
            contextLeaseHash: null,
          },
        });
        if (!result.count || !row)
          throw new HttpError({ statusCode: 409, message: 'Chapter context reservation expired' });
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
      });
      return { ok: true };
    },
    {
      params,
      body: t.Composite([
        leaseBody,
        t.Object({ token: t.String({ format: 'uuid' }), context: t.Unknown() }),
      ]),
      response: t.Object({ ok: t.Boolean() }),
      detail: { summary: 'Publish a validated chapter context and its continuity index' },
    },
  )
  .delete(
    '/:novelId/:chapterNumber/claim',
    async ({ prisma, params, authedUser, body }) => {
      await prisma.chapter.updateMany({
        where: {
          novelId: params.novelId,
          number: params.chapterNumber,
          contextCreatedById: authedUser.id,
          contextLeaseToken: body.token,
        },
        data: { contextLeaseToken: null, contextLeaseExpiresAt: null, contextLeaseHash: null },
      });
      return { ok: true };
    },
    {
      params,
      body: t.Object({ token: t.String({ format: 'uuid' }) }),
      response: t.Object({ ok: t.Boolean() }),
      detail: { summary: 'Release your unfinished context generation' },
    },
  );
