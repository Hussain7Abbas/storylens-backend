import {
  ChapterPlain,
  FilePlain,
  KeywordCategoryPlain,
  KeywordNaturePlain,
  KeywordPlain,
  KeywordsChaptersPlain,
  NovelPlain,
} from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import { shouldBeAdmin, shouldBeGuest } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';

export const chapters = new Elysia({ prefix: '/chapters', tags: ['Chapters'] })
  .use(setup)
  .use(shouldBeGuest())

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
          include: {
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
        data: chapters,
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
        include: {
          novel: true,
          KeywordsChapters: {
            include: {
              keyword: {
                include: {
                  category: true,
                  nature: true,
                  image: true,
                },
              },
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

      return chapter;
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
                  keyword: t.Composite([
                    KeywordPlain,
                    t.Object({
                      category: KeywordCategoryPlain,
                      nature: KeywordNaturePlain,
                      image: t.Nullable(FilePlain),
                    }),
                  ]),
                }),
              ]),
            ),
          }),
        ]),
      },
    },
  )

  // Create chapter (admin only)
  .use(shouldBeAdmin())
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
          description: body.description,
          novelId: body.novelId,
        },
      });

      return chapter;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        number: t.Number({ minimum: 1 }),
        description: t.Optional(t.String()),
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

      const chapter = await prisma.chapter.update({
        where: { id },
        data: {
          name: body.name,
          number: body.number,
          description: body.description,
        },
      });

      return chapter;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        number: t.Number({ minimum: 1 }),
        description: t.Optional(t.String()),
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

      return existingChapter;
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
