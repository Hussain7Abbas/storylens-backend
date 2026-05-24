import { KeywordCategoryPlain, KeywordNaturePlain, KeywordPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import { shouldBeAdmin, shouldBeGuest } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';

export const keywordNatures = new Elysia({
  prefix: '/keyword-natures',
  tags: ['KeywordNatures'],
})
  .use(setup)
  .use(shouldBeGuest())

  // Get all keyword natures
  .get(
    '/',
    async ({ prisma, query: { pagination, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      const [natures, total] = await Promise.all([
        prisma.keywordNature.findMany({
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
        prisma.keywordNature.count(),
      ]);

      return {
        data: natures,
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
          data: t.Array(KeywordNaturePlain),
          total: t.Number(),
        }),
      },
    },
  )

  // Get keyword nature by ID
  .get(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const nature = await prisma.keywordNature.findUnique({
        where: { id },
        include: {
          keywords: {
            include: {
              category: true,
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

      if (!nature) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Nature not found',
            ar: 'الطبيعة غير موجودة',
          }),
        });
      }

      return nature;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          KeywordNaturePlain,
          t.Object({
            keywords: t.Array(
              t.Composite([
                KeywordPlain,
                t.Object({
                  category: KeywordCategoryPlain,
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

  // Create keyword nature (admin only)
  .use(shouldBeAdmin())
  .post(
    '/',
    async ({ t, prisma, body }) => {
      // Check if nature name already exists
      const existingNature = await prisma.keywordNature.findFirst({
        where: {
          name: body.name,
        },
      });

      if (existingNature) {
        throw new HttpError({
          message: t({
            en: 'Nature name already exists',
            ar: 'اسم الطبيعة موجود بالفعل',
          }),
        });
      }

      const nature = await prisma.keywordNature.create({
        data: {
          name: body.name,
          color: body.color,
        },
      });

      return nature;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        color: t.String({ pattern: '^#[0-9A-Fa-f]{6}$' }),
      }),
      response: {
        200: KeywordNaturePlain,
      },
    },
  )

  // Update keyword nature (User only)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body }) => {
      const existingNature = await prisma.keywordNature.findUnique({
        where: { id },
      });

      if (!existingNature) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Nature not found',
            ar: 'الطبيعة غير موجودة',
          }),
        });
      }

      // If changing name, check for conflicts
      if (body.name && body.name !== existingNature.name) {
        const conflictNature = await prisma.keywordNature.findFirst({
          where: {
            name: body.name,
            id: { not: id },
          },
        });

        if (conflictNature) {
          throw new HttpError({
            message: t({
              en: 'Nature name already exists',
              ar: 'اسم الطبيعة موجود بالفعل',
            }),
          });
        }
      }

      const nature = await prisma.keywordNature.update({
        where: { id },
        data: {
          name: body.name,
          color: body.color,
        },
      });

      return nature;
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
        200: KeywordNaturePlain,
      },
    },
  )

  // Delete keyword nature (User only)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const existingNature = await prisma.keywordNature.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              keywords: true,
            },
          },
        },
      });

      if (!existingNature) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Nature not found',
            ar: 'الطبيعة غير موجودة',
          }),
        });
      }

      // Check if nature has keywords
      if (existingNature._count.keywords > 0) {
        throw new HttpError({
          message: t({
            en: 'Cannot delete nature with keywords',
            ar: 'لا يمكن حذف طبيعة تحتوي على كلمات مفتاحية',
          }),
        });
      }

      await prisma.keywordNature.delete({
        where: { id },
      });

      return existingNature;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: KeywordNaturePlain,
      },
    },
  );
