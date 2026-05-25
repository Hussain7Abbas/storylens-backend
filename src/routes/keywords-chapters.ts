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

export const keywordsChapters = new Elysia({
  prefix: '/keywords-chapters',
  tags: ['KeywordsChapters'],
})
  .use(setup)
  .use(shouldBeGuest())

  // Get all keyword-chapter relationships for a specific chapter
  .get(
    '/chapter/:chapterId',
    async ({ t, prisma, params: { chapterId }, query: { pagination, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      // Verify chapter exists
      const chapter = await prisma.chapter.findUnique({
        where: { id: chapterId },
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

      const [relationships, total] = await Promise.all([
        prisma.keywordsChapters.findMany({
          where: { chapterId },
          skip,
          take,
          include: {
            keyword: {
              include: {
                category: true,
                nature: true,
                image: true,
              },
            },
            chapter: true,
          },
          orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
        }),
        prisma.keywordsChapters.count({ where: { chapterId } }),
      ]);

      return {
        data: relationships,
        total,
      };
    },
    {
      params: t.Object({
        chapterId: t.String({ format: 'uuid' }),
      }),
      query: t.Object({
        pagination: paginationSchema,
        sorting: sortingSchema,
      }),
      response: {
        200: t.Object({
          data: t.Array(KeywordsChaptersPlain),
          total: t.Number(),
        }),
      },
    },
  )

  // Get all keyword-chapter relationships for a specific keyword
  .get(
    '/keyword/:keywordId',
    async ({ t, prisma, params: { keywordId }, query: { pagination } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      // Verify keyword exists
      const keyword = await prisma.keyword.findUnique({
        where: { id: keywordId },
      });

      if (!keyword) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Keyword not found',
            ar: 'الكلمة المفتاحية غير موجودة',
          }),
        });
      }

      const [relationships, total] = await Promise.all([
        prisma.keywordsChapters.findMany({
          where: { keywordId },
          skip,
          take,
          include: {
            keyword: true,
            chapter: {
              include: {
                novel: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        }),
        prisma.keywordsChapters.count({ where: { keywordId } }),
      ]);

      return {
        data: relationships,
        total,
      };
    },
    {
      params: t.Object({
        keywordId: t.String({ format: 'uuid' }),
      }),
      query: t.Object({
        pagination: paginationSchema,
        sorting: sortingSchema,
      }),
      response: {
        200: t.Object({
          data: t.Array(KeywordsChaptersPlain),
          total: t.Number(),
        }),
      },
    },
  )

  // Get relationship by ID
  .get(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const relationship = await prisma.keywordsChapters.findUnique({
        where: { id },
        include: {
          keyword: {
            include: {
              category: true,
              nature: true,
              image: true,
            },
          },
          chapter: {
            include: {
              novel: true,
            },
          },
        },
      });

      if (!relationship) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Relationship not found',
            ar: 'العلاقة غير موجودة',
          }),
        });
      }

      return relationship;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
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
            chapter: t.Composite([
              ChapterPlain,
              t.Object({
                novel: NovelPlain,
              }),
            ]),
          }),
        ]),
      },
    },
  )

  // Create keyword-chapter relationship (admin only)
  .use(shouldBeAdmin())
  .post(
    '/',
    async ({ t, prisma, body }) => {
      // Verify both keyword and chapter exist
      const [keyword, chapter] = await Promise.all([
        prisma.keyword.findUnique({ where: { id: body.keywordId } }),
        prisma.chapter.findUnique({ where: { id: body.chapterId } }),
      ]);

      if (!keyword) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Keyword not found',
            ar: 'الكلمة المفتاحية غير موجودة',
          }),
        });
      }

      if (!chapter) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Chapter not found',
            ar: 'الفصل غير موجود',
          }),
        });
      }

      // Check if relationship already exists
      const existingRelationship = await prisma.keywordsChapters.findFirst({
        where: {
          keywordId: body.keywordId,
          chapterId: body.chapterId,
        },
      });

      if (existingRelationship) {
        throw new HttpError({
          message: t({
            en: 'Relationship already exists',
            ar: 'العلاقة موجودة بالفعل',
          }),
        });
      }

      const relationship = await prisma.keywordsChapters.create({
        data: {
          keywordId: body.keywordId,
          chapterId: body.chapterId,
        },
        include: {
          keyword: true,
          chapter: true,
        },
      });

      return relationship;
    },
    {
      body: t.Object({
        keywordId: t.String({ format: 'uuid' }),
        chapterId: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          KeywordsChaptersPlain,
          t.Object({
            keyword: KeywordPlain,
            chapter: ChapterPlain,
          }),
        ]),
      },
    },
  )

  // Delete keyword-chapter relationship (User only)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const existingRelationship = await prisma.keywordsChapters.findUnique({
        where: { id },
      });

      if (!existingRelationship) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Relationship not found',
            ar: 'العلاقة غير موجودة',
          }),
        });
      }

      await prisma.keywordsChapters.delete({
        where: { id },
      });

      return existingRelationship;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: KeywordsChaptersPlain,
      },
    },
  );
