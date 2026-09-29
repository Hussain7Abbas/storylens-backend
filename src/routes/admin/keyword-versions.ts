import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { adminVersionSchema, styleBody, styleInclude } from '@/schemas/admin-keywords';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { assertStyleRefs, styleData } from './keyword-styles';
import { lockKeywordVersions, versionEditNeighbors } from './version-ranges';

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
      await assertStyleRefs(prisma, body);
      const { startingChapter } = body;
      assertRange(startingChapter, body.endingChapter);
      return prisma.$transaction(async (tx) => {
        await lockKeywordVersions(tx, body.keywordId);
        const keyword = await tx.keyword.findUnique({
          where: { id: body.keywordId },
          include: { versions: { orderBy: { startingChapter: 'desc' } } },
        });
        if (!keyword) notFound('Keyword');
        const latest = keyword.versions[0];
        if (latest && startingChapter <= latest.startingChapter) {
          invalid(`A new version must start after chapter ${latest.startingChapter}, where the latest version starts`);
        }
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
      await assertStyleRefs(prisma, body);
      const initial = await prisma.keywordVersion.findUnique({ where: { id }, select: { keywordId: true } });
      if (!initial) notFound('Version');
      return prisma.$transaction(async (tx) => {
        await lockKeywordVersions(tx, initial.keywordId);
        const versions = await tx.keywordVersion.findMany({
          where: { keywordId: initial.keywordId },
          orderBy: { startingChapter: 'asc' },
        });
        const existing = versions.find((version) => version.id === id);
        if (!existing) notFound('Version');
        const startingChapter = body.startingChapter ?? existing.startingChapter;
        const endingChapter = body.endingChapter === undefined ? existing.endingChapter : body.endingChapter;
        const { previous, endingChapter: boundedEnd } = versionEditNeighbors(versions, id, startingChapter, endingChapter);
        if (previous && startingChapter !== existing.startingChapter) {
          await tx.keywordVersion.update({ where: { id: previous.id }, data: { endingChapter: startingChapter - 1 } });
        }
        return tx.keywordVersion.update({
          where: { id },
          data: {
            ...styleData(body),
            startingChapter: body.startingChapter,
            endingChapter: boundedEnd === existing.endingChapter && body.endingChapter === undefined ? undefined : boundedEnd,
          },
          include: styleInclude,
        });
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
      const initial = await prisma.keywordVersion.findUnique({ where: { id }, select: { keywordId: true } });
      if (!initial) notFound('Version');
      return prisma.$transaction(async (tx) => {
        await lockKeywordVersions(tx, initial.keywordId);
        const versions = await tx.keywordVersion.findMany({
          where: { keywordId: initial.keywordId },
          orderBy: { startingChapter: 'asc' },
        });
        const index = versions.findIndex((version) => version.id === id);
        if (index < 0) notFound('Version');
        if (index === 0) invalid('The base version of a keyword cannot be deleted');
        const previous = versions[index - 1];
        const next = versions[index + 1];
        const existing = await tx.keywordVersion.delete({ where: { id }, include: styleInclude });
        if (previous) {
          await tx.keywordVersion.update({
            where: { id: previous.id },
            data: { endingChapter: next ? next.startingChapter - 1 : null },
          });
        }
        return existing;
      });
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: adminVersionSchema },
      detail: { summary: 'Delete a keyword version' },
    },
  );
