import {
  ChapterPlain,
  KeywordPlain,
  KeywordsChaptersPlain,
  NovelPlain,
} from '@/lib/db';
import { parseStoredContext } from '@/lib/chapter-context/storage';
import { chapterPublicSelect, legacyChapterContext } from '@/lib/chapter-context/public';
import { deprecate } from '@/lib/compat/deprecation';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';

export const chapters = new Elysia({ prefix: '/chapters', tags: ['Chapters'] })
  .use(setup)
  .use(authorize('user'))

  // Get all chapters for a novel
  .get(
    '/novel/:novelId',
    async ({ t, prisma, params: { novelId }, query: { pagination, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      // Verify novel exists
      const novel = await prisma.novel.findUnique({
        where: { id: novelId },
      });

      if (!novel) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Novel not found',
            ar: 'الرواية غير موجودة',
          }),
        });
      }

      const [chapters, total] = await Promise.all([
        prisma.chapter.findMany({
          where: { novelId },
          skip,
          take,
          select: {
            ...chapterPublicSelect,
            _count: {
              select: {
                KeywordsChapters: true,
              },
            },
          },
          orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
        }),
        prisma.chapter.count({ where: { novelId } }),
      ]);

      return {
        data: chapters.map(chapter => ({ ...chapter, description: null })),
        total,
      };
    },
    {
      params: t.Object({
        novelId: t.String({ format: 'uuid' }),
      }),
      query: t.Object({
        pagination: paginationSchema,
        sorting: sortingSchema,
      }),
      response: {
        200: t.Object({
          data: t.Array(ChapterPlain),
          total: t.Number(),
        }),
      },
    },
  )

  // Get chapter by ID
  .get(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const chapter = await prisma.chapter.findUnique({
        where: { id },
        select: {
          ...chapterPublicSelect,
          novel: true,
          KeywordsChapters: {
            include: {
              keyword: true,
            },
          },
        },
      });

      if (!chapter) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Chapter not found',
            ar: 'الفصل غير موجود',
          }),
        });
      }

      return { ...chapter, description: null };
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          ChapterPlain,
          t.Object({
            novel: NovelPlain,
            KeywordsChapters: t.Array(
              t.Composite([
                KeywordsChaptersPlain,
                t.Object({
                  keyword: KeywordPlain,
                }),
              ]),
            ),
          }),
        ]),
      },
    },
  )

  // Create chapter (moderator by default)
  .post(
    '/',
    async ({ t, prisma, body }) => {
      // Verify novel exists
      const novel = await prisma.novel.findUnique({
        where: { id: body.novelId },
      });

      if (!novel) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Novel not found',
            ar: 'الرواية غير موجودة',
          }),
        });
      }

      // Check if chapter number already exists for this novel
      const existingChapter = await prisma.chapter.findFirst({
        where: {
          novelId: body.novelId,
          number: body.number,
        },
      });

      if (existingChapter) {
        throw new HttpError({
          message: t({
            en: 'Chapter number already exists for this novel',
            ar: 'رقم الفصل موجود بالفعل لهذه الرواية',
          }),
        });
      }

      const chapter = await prisma.chapter.create({
        data: {
          name: body.name,
          number: body.number,
          ...(body.description === undefined ? {} : { context: legacyChapterContext(body.description) }),
          novelId: body.novelId,
        },
      });

      return { id: chapter.id, name: chapter.name, number: chapter.number, novelId: chapter.novelId, imageId: chapter.imageId, createdAt: chapter.createdAt, updatedAt: chapter.updatedAt, description: null };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        number: t.Number({ minimum: 1 }),
        description: t.Optional(deprecate(t.String(), { since: '2026-10-17', removeAfter: '2027-04-30', replacement: 'Chapter context.summary' })),
        novelId: t.String({ format: 'uuid' }),
      }),
      response: {
        200: ChapterPlain,
      },
    },
  )

  // Update chapter (User only)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body }) => {
      const existingChapter = await prisma.chapter.findUnique({
        where: { id },
      });

      if (!existingChapter) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Chapter not found',
            ar: 'الفصل غير موجود',
          }),
        });
      }

      // If changing chapter number, check for conflicts
      if (body.number && body.number !== existingChapter.number) {
        const conflictChapter = await prisma.chapter.findFirst({
          where: {
            novelId: existingChapter.novelId,
            number: body.number,
            id: { not: id },
          },
        });

        if (conflictChapter) {
          throw new HttpError({
            message: t({
              en: 'Chapter number already exists for this novel',
              ar: 'رقم الفصل موجود بالفعل لهذه الرواية',
            }),
          });
        }
      }

      const chapter = await prisma.$transaction(async tx => {
        const updated = await tx.chapter.update({
          where: { id },
          data: {
            name: body.name,
            number: body.number,
            ...(body.description === undefined ? {} : { context: { ...(parseStoredContext(existingChapter.context) ?? legacyChapterContext(body.description)), summary: body.description } }),
          },
        });
        if (body.number !== existingChapter.number) {
          await tx.chapterMention.updateMany({ where: { chapterId: id }, data: { chapterNumber: body.number } });
        }
        return updated;
      });

      return { id: chapter.id, name: chapter.name, number: chapter.number, novelId: chapter.novelId, imageId: chapter.imageId, createdAt: chapter.createdAt, updatedAt: chapter.updatedAt, description: null };
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        number: t.Number({ minimum: 1 }),
        description: t.Optional(deprecate(t.String(), { since: '2026-10-17', removeAfter: '2027-04-30', replacement: 'Chapter context.summary' })),
      }),
      response: {
        200: ChapterPlain,
      },
    },
  )

  // Delete chapter (User only)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const existingChapter = await prisma.chapter.findUnique({
        where: { id },
      });

      if (!existingChapter) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Chapter not found',
            ar: 'الفصل غير موجود',
          }),
        });
      }

      await prisma.chapter.delete({
        where: { id },
      });

      return { id: existingChapter.id, name: existingChapter.name, number: existingChapter.number, novelId: existingChapter.novelId, imageId: existingChapter.imageId, createdAt: existingChapter.createdAt, updatedAt: existingChapter.updatedAt, description: null };
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: ChapterPlain,
      },
    },
  );
