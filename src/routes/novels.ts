import { ChapterPlain, FilePlain, NovelPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import { setup } from '@/setup';
import { requireRole } from '@/middleware/authorize';
import { HttpError } from '@/utils/errors';
import { sanitize, sanitizeObject } from '@/utils/sanitize';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';

export const novels = new Elysia({
  prefix: '/novels',
  tags: ['Novels'],
})
  .use(setup)

  // Get all novels with pagination (all roles)
  .get(
    '/',
    async ({ prisma, query: { pagination, query, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      const where = query?.search
        ? {
            OR: [
              {
                name: {
                  contains: query?.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                description: {
                  contains: query?.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                slugs: {
                  has: query.search,
                },
              },
            ],
          }
        : {};

      const [novels, total] = await Promise.all([
        prisma.novel.findMany({
          where,
          skip,
          take,
          include: {
            image: true,
            _count: {
              select: {
                chapters: true,
                Keywords: true,
              },
            },
          },
          orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
        }),
        prisma.novel.count({ where }),
      ]);

      return {
        data: novels,
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
          }),
        ),
      }),
      response: {
        200: t.Object({
          data: t.Array(NovelPlain),
          total: t.Number(),
        }),
      },
    },
  )

  // Get novel by ID (all roles)
  .get(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const novel = await prisma.novel.findUnique({
        where: { id },
        include: {
          image: true,
          chapters: {
            orderBy: {
              number: 'asc',
            },
            include: {
              _count: {
                select: {
                  KeywordsChapters: true,
                },
              },
            },
          },
        },
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

      return novel;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          NovelPlain,
          t.Object({
            image: t.Nullable(FilePlain),
            chapters: t.Array(ChapterPlain),
          }),
        ]),
      },
    },
  )

  // Create novel (user, admin only)
  .post(
    '/',
    async ({ prisma, body, currentUser, t }) => {
      if (!currentUser || currentUser.role === 'guest') {
        throw new HttpError({
          statusCode: 403,
          message: t({
            en: 'Guests cannot create novels',
            ar: 'لا يمكن للضيوف إنشاء روايات',
          }),
        });
      }

      const sanitizedBody = sanitizeObject(body);

      const novel = await prisma.novel.create({
        data: {
          name: sanitizedBody.name,
          description: sanitizedBody.description,
          imageId: sanitizedBody.imageId,
          slugs: sanitizedBody.slugs ?? [],
          createdById: currentUser.id,
        },
        include: {
          image: true,
        },
      });

      return novel;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String({ minLength: 1 })),
        imageId: t.Optional(t.String({ format: 'uuid' })),
        slugs: t.Optional(t.Array(t.String({ minLength: 1 }))),
      }),
      response: {
        200: t.Composite([
          NovelPlain,
          t.Object({
            image: t.Nullable(FilePlain),
          }),
        ]),
      },
    },
  )

  // Update novel (admin only, except "add slug" for user)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body, currentUser }) => {
      if (!currentUser || currentUser.role === 'guest') {
        throw new HttpError({
          statusCode: 403,
          message: t({
            en: 'Guests cannot update novels',
            ar: 'لا يمكن للضيوف تعديل الروايات',
          }),
        });
      }

      const existingNovel = await prisma.novel.findUnique({
        where: { id },
      });

      if (!existingNovel) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Novel not found',
            ar: 'الرواية غير موجودة',
          }),
        });
      }

      // Users can only add slugs, not edit name/description/image
      if (currentUser.role === 'user') {
        const novel = await prisma.novel.update({
          where: { id },
          data: {
            slugs: body.slugs ? sanitizeObject(body.slugs) : existingNovel.slugs,
          },
          include: { image: true },
        });
        return novel;
      }

      const sanitizedBody = sanitizeObject(body);

      const novel = await prisma.novel.update({
        where: { id },
        data: {
          name: sanitizedBody.name,
          description: sanitizedBody.description,
          imageId: sanitizedBody.imageId,
          slugs: sanitizedBody.slugs,
        },
        include: {
          image: true,
        },
      });

      return novel;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String({ minLength: 1 })),
        imageId: t.Optional(t.String({ format: 'uuid' })),
        slugs: t.Optional(t.Array(t.String({ minLength: 1 }))),
      }),
      response: {
        200: t.Composite([
          NovelPlain,
          t.Object({
            image: t.Nullable(FilePlain),
          }),
        ]),
      },
    },
  )

  // Delete novel (admin only)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id }, currentUser }) => {
      if (!currentUser || currentUser.role !== 'admin') {
        throw new HttpError({
          statusCode: 403,
          message: t({
            en: 'Only admins can delete novels',
            ar: 'فقط المسؤولون يمكنهم حذف الروايات',
          }),
        });
      }

      const existingNovel = await prisma.novel.findUnique({
        where: { id },
      });

      if (!existingNovel) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Novel not found',
            ar: 'الرواية غير موجودة',
          }),
        });
      }

      await prisma.novel.delete({
        where: { id },
      });

      return existingNovel;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: NovelPlain,
      },
    },
  );
