import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { adminVersionSchema, styleBody, styleInclude } from '@/schemas/admin-keywords';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { assertStyleRefs, styleData } from './keyword-styles';

function notFound(what: 'Version' | 'Keyword'): never {
  throw new HttpError({ statusCode: 404, message: `${what} not found` });
}

function invalid(message: string, statusCode = 409): never {
  throw new HttpError({ statusCode, message });
}

function assertRange(startingChapter: number, endingChapter: number | null | undefined) {
  if (endingChapter != null && endingChapter < startingChapter) {
    invalid('The ending chapter must not be before the starting chapter', 422);
  }
}

const chapter = t.Integer({ minimum: 0 });

export const adminKeywordVersions = new Elysia({ prefix: '/keyword-versions', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))

  // A new version starts after the latest one, which then ends the chapter before.
  .post(
    '/',
    async ({ prisma, authedUser, body }) => {
      const keyword = await prisma.keyword.findUnique({
        where: { id: body.keywordId },
        include: { versions: { orderBy: { startingChapter: 'desc' } } },
      });
      if (!keyword) notFound('Keyword');
      await assertStyleRefs(prisma, body);
      const { startingChapter } = body;
      assertRange(startingChapter, body.endingChapter);
      const latest = keyword.versions[0];
      if (latest && startingChapter <= latest.startingChapter) {
        invalid(`A new version must start after chapter ${latest.startingChapter}, where the latest version starts`);
      }

      return prisma.$transaction(async (tx) => {
        if (latest && (latest.endingChapter === null || latest.endingChapter >= startingChapter)) {
          await tx.keywordVersion.update({ where: { id: latest.id }, data: { endingChapter: startingChapter - 1 } });
        }
        return tx.keywordVersion.create({
          data: {
            ...styleData(body),
            keywordId: keyword.id,
            startingChapter,
            endingChapter: body.endingChapter ?? null,
            createdById: authedUser.id,
          },
          include: styleInclude,
        });
      });
    },
    {
      body: t.Object({
        keywordId: t.String({ format: 'uuid' }),
        startingChapter: chapter,
        endingChapter: t.Optional(t.Nullable(chapter)),
        ...styleBody,
      }),
      response: { 200: adminVersionSchema },
      detail: { summary: 'Add a version to a keyword' },
    },
  )

  .put(
    '/:id',
    async ({ prisma, params: { id }, body }) => {
      const existing = await prisma.keywordVersion.findUnique({ where: { id } });
      if (!existing) notFound('Version');
      await assertStyleRefs(prisma, body);
      const startingChapter = body.startingChapter ?? existing.startingChapter;
      assertRange(startingChapter, body.endingChapter === undefined ? existing.endingChapter : body.endingChapter);
      if (startingChapter !== existing.startingChapter) {
        const taken = await prisma.keywordVersion.findFirst({
          where: { keywordId: existing.keywordId, startingChapter, id: { not: id } },
          select: { id: true },
        });
        if (taken) invalid(`Another version already starts at chapter ${startingChapter}`);
      }
      return prisma.keywordVersion.update({
        where: { id },
        data: { ...styleData(body), startingChapter: body.startingChapter, endingChapter: body.endingChapter },
        include: styleInclude,
      });
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({
        startingChapter: t.Optional(chapter),
        endingChapter: t.Optional(t.Nullable(chapter)),
        ...styleBody,
      }),
      response: { 200: adminVersionSchema },
      detail: { summary: 'Update a keyword version' },
    },
  )

  // The base (earliest) version holds the keyword's own details, so it stays.
  .delete(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const existing = await prisma.keywordVersion.findUnique({ where: { id }, include: styleInclude });
      if (!existing) notFound('Version');
      const base = await prisma.keywordVersion.findFirst({
        where: { keywordId: existing.keywordId },
        orderBy: { startingChapter: 'asc' },
        select: { id: true },
      });
      if (base?.id === id) invalid('The base version of a keyword cannot be deleted');
      await prisma.keywordVersion.delete({ where: { id } });
      return existing;
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: adminVersionSchema },
      detail: { summary: 'Delete a keyword version' },
    },
  );
