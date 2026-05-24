import {
  ChapterPlain,
  FilePlain,
  KeywordCategoryPlain,
  KeywordNaturePlain,
  KeywordPlain,
  KeywordsChaptersPlain,
  NovelPlain,
  ReplacementPlain,
} from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import {
  assertOwnsResource,
  shouldBeGuest,
  shouldBeUser,
} from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitizeObject } from '@/utils/sanitize';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';
import { orderByIds, queryWeightedSearchIds } from '@/utils/weighted-search';

const keywordInclude = {
  category: true,
  nature: true,
  image: true,
  parent: true,
} as const;

export const keywords = new Elysia({ prefix: '/keywords', tags: ['Keywords'] })
  .use(setup)
  .use(shouldBeGuest())

  // Get all keywords with filters
  .get(
    '/',
    async ({ prisma, query: { pagination, query, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      const where: Record<string, unknown> = {};

      if (query?.categoryId) {
        where.categoryId = query.categoryId;
      }

      if (query?.natureId) {
        where.natureId = query.natureId;
      }

      if (query?.novelId) {
        where.novelId = query.novelId;
      }

      if (query?.search) {
        const { ids, total } = await queryWeightedSearchIds(prisma, {
          table: 'Keyword',
          primaryColumn: 'name',
          secondaryColumn: 'description',
          search: query.search,
          filters: {
            novelId: query.novelId,
            categoryId: query.categoryId,
            natureId: query.natureId,
          },
          skip: skip ?? 0,
          take: take ?? 25,
          sortColumn: sorting?.column,
          sortDirection: sorting?.direction,
        });

        if (ids.length === 0) {
          return {
            data: [],
            total,
          };
        }

        const keywords = await prisma.keyword.findMany({
          where: { id: { in: ids } },
          include: keywordInclude,
        });

        return {
          data: orderByIds(keywords, ids),
          total,
        };
      }

      const [keywords, total] = await Promise.all([
        prisma.keyword.findMany({
          where,
          skip,
          take,
          include: keywordInclude,
          orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
        }),
        prisma.keyword.count({ where }),
      ]);

      return {
        data: keywords,
        total,
      };
    },
    {
      query: t.Object({
        pagination: paginationSchema,
        sorting: sortingSchema,
        query: t.Optional(
          t.Object({
            search: t.Optional(t.String()),
            categoryId: t.Optional(t.String({ format: 'uuid' })),
            natureId: t.Optional(t.String({ format: 'uuid' })),
            novelId: t.Optional(t.String({ format: 'uuid' })),
          }),
        ),
      }),
      response: {
        200: t.Object({
          data: t.Array(
            t.Composite([
              KeywordPlain,
              t.Object({
                category: KeywordCategoryPlain,
                nature: KeywordNaturePlain,
                image: t.Nullable(FilePlain),
                parent: t.Nullable(KeywordPlain),
              }),
            ]),
          ),
          total: t.Number(),
        }),
      },
    },
  )

  // Get keyword by ID
  .get(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const keyword = await prisma.keyword.findUnique({
        where: { id },
        include: {
          category: true,
          nature: true,
          image: true,
          parent: true,
          children: {
            include: {
              category: true,
              nature: true,
            },
          },
          novel: true,
          KeywordsChapters: {
            include: {
              chapter: true,
            },
          },
          replacements: true,
        },
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

      return keyword;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          KeywordPlain,
          t.Object({
            category: KeywordCategoryPlain,
            nature: KeywordNaturePlain,
            image: t.Nullable(FilePlain),
            parent: t.Nullable(KeywordPlain),
            children: t.Array(
              t.Composite([
                KeywordPlain,
                t.Object({
                  category: KeywordCategoryPlain,
                  nature: KeywordNaturePlain,
                }),
              ]),
            ),
            novel: t.Nullable(NovelPlain),
            KeywordsChapters: t.Array(
              t.Composite([
                KeywordsChaptersPlain,
                t.Object({
                  chapter: ChapterPlain,
                }),
              ]),
            ),
            replacements: t.Array(ReplacementPlain),
          }),
        ]),
      },
    },
  )

  // Create keyword (user + admin)
  .use(shouldBeUser())
  .post(
    '/',
    async ({ t, prisma, body, authedUser }) => {
      const sanitizedBody = sanitizeObject(body);

      const [category, nature, novel] = await Promise.all([
        prisma.keywordCategory.findUnique({ where: { id: sanitizedBody.categoryId } }),
        prisma.keywordNature.findUnique({ where: { id: sanitizedBody.natureId } }),
        prisma.novel.findUnique({ where: { id: sanitizedBody.novelId } }),
      ]);

      if (!category) {
        throw new HttpError({
          statusCode: 404,
          message: t({ en: 'Category not found', ar: 'الفئة غير موجودة' }),
        });
      }

      if (!nature) {
        throw new HttpError({
          statusCode: 404,
          message: t({ en: 'Nature not found', ar: 'الطبيعة غير موجودة' }),
        });
      }

      if (!novel) {
        throw new HttpError({
          statusCode: 404,
          message: t({ en: 'Novel not found', ar: 'الرواية غير موجودة' }),
        });
      }

      const existingKeyword = await prisma.keyword.findFirst({
        where: {
          name: sanitizedBody.name,
          novelId: sanitizedBody.novelId,
        },
      });

      if (existingKeyword) {
        throw new HttpError({
          message: t({
            en: 'Keyword name already exists for this novel',
            ar: 'اسم الكلمة المفتاحية موجود بالفعل لهذه الرواية',
          }),
        });
      }

      const keyword = await prisma.keyword.create({
        data: {
          name: sanitizedBody.name,
          description: sanitizedBody.description,
          categoryId: sanitizedBody.categoryId,
          natureId: sanitizedBody.natureId,
          imageId: sanitizedBody.imageId,
          parentId: sanitizedBody.parentId,
          novelId: sanitizedBody.novelId,
          createdById: authedUser.id,
        },
        include: keywordInclude,
      });

      return keyword;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.String({ minLength: 1 }),
        categoryId: t.String({ format: 'uuid' }),
        natureId: t.String({ format: 'uuid' }),
        imageId: t.Optional(t.String({ format: 'uuid' })),
        parentId: t.Optional(t.String({ format: 'uuid' })),
        novelId: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          KeywordPlain,
          t.Object({
            category: KeywordCategoryPlain,
            nature: KeywordNaturePlain,
            image: t.Nullable(FilePlain),
            parent: t.Nullable(KeywordPlain),
          }),
        ]),
      },
    },
  )

  // Update keyword (own only for user, all for admin)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body, authedUser }) => {
      const existingKeyword = await prisma.keyword.findUnique({
        where: { id },
      });

      if (!existingKeyword) {
        throw new HttpError({
          statusCode: 404,
          message: t({ en: 'Keyword not found', ar: 'الكلمة المفتاحية غير موجودة' }),
        });
      }

      assertOwnsResource(existingKeyword.createdById, authedUser);

      const sanitizedBody = sanitizeObject(body);

      if (sanitizedBody.name && sanitizedBody.name !== existingKeyword.name) {
        const conflictKeyword = await prisma.keyword.findFirst({
          where: {
            name: sanitizedBody.name,
            novelId: existingKeyword.novelId,
            id: { not: id },
          },
        });

        if (conflictKeyword) {
          throw new HttpError({
            message: t({
              en: 'Keyword name already exists for this novel',
              ar: 'اسم الكلمة المفتاحية موجود بالفعل لهذه الرواية',
            }),
          });
        }
      }

      if (sanitizedBody.categoryId || sanitizedBody.natureId) {
        const [category, nature] = await Promise.all([
          sanitizedBody.categoryId
            ? prisma.keywordCategory.findUnique({ where: { id: sanitizedBody.categoryId } })
            : Promise.resolve(null),
          sanitizedBody.natureId
            ? prisma.keywordNature.findUnique({ where: { id: sanitizedBody.natureId } })
            : Promise.resolve(null),
        ]);

        if (sanitizedBody.categoryId && !category) {
          throw new HttpError({
            statusCode: 404,
            message: t({ en: 'Category not found', ar: 'الفئة غير موجودة' }),
          });
        }

        if (sanitizedBody.natureId && !nature) {
          throw new HttpError({
            statusCode: 404,
            message: t({ en: 'Nature not found', ar: 'الطبيعة غير موجودة' }),
          });
        }
      }

      const keyword = await prisma.keyword.update({
        where: { id },
        data: {
          name: sanitizedBody.name,
          description: sanitizedBody.description,
          categoryId: sanitizedBody.categoryId,
          natureId: sanitizedBody.natureId,
          imageId: sanitizedBody.imageId,
          parentId: sanitizedBody.parentId,
        },
        include: keywordInclude,
      });

      return keyword;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.String({ minLength: 1 }),
        categoryId: t.String({ format: 'uuid' }),
        natureId: t.String({ format: 'uuid' }),
        imageId: t.Optional(t.String({ format: 'uuid' })),
        parentId: t.Optional(t.String({ format: 'uuid' })),
      }),
      response: {
        200: t.Composite([
          KeywordPlain,
          t.Object({
            category: KeywordCategoryPlain,
            nature: KeywordNaturePlain,
            image: t.Nullable(FilePlain),
            parent: t.Nullable(KeywordPlain),
          }),
        ]),
      },
    },
  )

  // Delete keyword (own only for user, all for admin)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id }, authedUser }) => {
      const existingKeyword = await prisma.keyword.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              children: true,
              KeywordsChapters: true,
              replacements: true,
            },
          },
        },
      });

      if (!existingKeyword) {
        throw new HttpError({
          statusCode: 404,
          message: t({ en: 'Keyword not found', ar: 'الكلمة المفتاحية غير موجودة' }),
        });
      }

      assertOwnsResource(existingKeyword.createdById, authedUser);

      if (existingKeyword._count.children > 0) {
        throw new HttpError({
          message: t({
            en: 'Cannot delete keyword with child keywords',
            ar: 'لا يمكن حذف كلمة مفتاحية لها كلمات فرعية',
          }),
        });
      }

      await prisma.keyword.delete({
        where: { id },
      });

      return existingKeyword;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: KeywordPlain,
      },
    },
  );
