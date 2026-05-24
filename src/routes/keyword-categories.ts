import { KeywordCategoryPlain, KeywordNaturePlain, KeywordPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';

export const keywordCategories = new Elysia({
  prefix: '/keyword-categories',
  tags: ['KeywordCategories'],
})
  .use(setup)

  // Get all keyword categories
  .get(
    '/',
    async ({ prisma, query: { pagination, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      const [categories, total] = await Promise.all([
        prisma.keywordCategory.findMany({
          skip,
          take,
          include: {
            _count: {
              select: {
                keywords: true,
              },
            },
          },
          orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
        }),
        prisma.keywordCategory.count(),
      ]);

      return {
        data: categories,
        total,
      };
    },
    {
      query: t.Object({
        pagination: paginationSchema,
        sorting: sortingSchema,
      }),
      response: {
        200: t.Object({
          data: t.Array(KeywordCategoryPlain),
          total: t.Number(),
        }),
      },
    },
  )

  // Get keyword category by ID
  .get(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const category = await prisma.keywordCategory.findUnique({
        where: { id },
        include: {
          keywords: {
            include: {
              nature: true,
            },
            take: 10,
            orderBy: {
              createdAt: 'desc',
            },
          },
          _count: {
            select: {
              keywords: true,
            },
          },
        },
      });

      if (!category) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Category not found',
            ar: 'الفئة غير موجودة',
          }),
        });
      }

      return category;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          KeywordCategoryPlain,
          t.Object({
            keywords: t.Array(
              t.Composite([
                KeywordPlain,
                t.Object({
                  nature: KeywordNaturePlain,
                }),
              ]),
            ),
            _count: t.Object({
              keywords: t.Number(),
            }),
          }),
        ]),
      },
    },
  )

  // Create keyword category (User only)
  .post(
    '/',
    async ({ t, prisma, body }) => {
      // Check if category name already exists
      const existingCategory = await prisma.keywordCategory.findFirst({
        where: {
          name: body.name,
        },
      });

      if (existingCategory) {
        throw new HttpError({
          message: t({
            en: 'Category name already exists',
            ar: 'اسم الفئة موجود بالفعل',
          }),
        });
      }

      const category = await prisma.keywordCategory.create({
        data: {
          name: body.name,
          color: body.color,
        },
      });

      return category;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        color: t.String({ pattern: '^#[0-9A-Fa-f]{6}$' }),
      }),
      response: {
        200: KeywordCategoryPlain,
      },
    },
  )

  // Update keyword category (User only)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body }) => {
      const existingCategory = await prisma.keywordCategory.findUnique({
        where: { id },
      });

      if (!existingCategory) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Category not found',
            ar: 'الفئة غير موجودة',
          }),
        });
      }

      // If changing name, check for conflicts
      if (body.name && body.name !== existingCategory.name) {
        const conflictCategory = await prisma.keywordCategory.findFirst({
          where: {
            name: body.name,
            id: { not: id },
          },
        });

        if (conflictCategory) {
          throw new HttpError({
            message: t({
              en: 'Category name already exists',
              ar: 'اسم الفئة موجود بالفعل',
            }),
          });
        }
      }

      const category = await prisma.keywordCategory.update({
        where: { id },
        data: {
          name: body.name,
          color: body.color,
        },
      });

      return category;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        color: t.String({ pattern: '^#[0-9A-Fa-f]{6}$' }),
      }),
      response: {
        200: KeywordCategoryPlain,
      },
    },
  )

  // Delete keyword category (User only)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const existingCategory = await prisma.keywordCategory.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              keywords: true,
            },
          },
        },
      });

      if (!existingCategory) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Category not found',
            ar: 'الفئة غير موجودة',
          }),
        });
      }

      // Check if category has keywords
      if (existingCategory._count.keywords > 0) {
        throw new HttpError({
          message: t({
            en: 'Cannot delete category with keywords',
            ar: 'لا يمكن حذف فئة تحتوي على كلمات مفتاحية',
          }),
        });
      }

      await prisma.keywordCategory.delete({
        where: { id },
      });

      return existingCategory;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: KeywordCategoryPlain,
      },
    },
  );
