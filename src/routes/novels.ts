import { ChapterPlain, FilePlain, NovelPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import {
  isAdmin,
  shouldBeAdmin,
  shouldBeGuest,
  shouldBeUser,
} from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize, sanitizeObject } from '@/utils/sanitize';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';

export const novels = new Elysia({
  prefix: '/novels',
  tags: ['Novels'],
})
  .use(setup)
  .use(shouldBeGuest())

  // Get all novels with pagination
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

  // Get novel by ID
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

  // Create novel (user: name + slugs only; admin: full)
  .use(shouldBeUser())
  .post(
    '/',
    async ({ prisma, body, authedUser, t }) => {
      if (isAdmin(authedUser)) {
        const sanitizedBody = sanitizeObject(body);

        const novel = await prisma.novel.create({
          data: {
            name: sanitizedBody.name,
            description: sanitizedBody.description,
            imageId: sanitizedBody.imageId,
            slugs: sanitizedBody.slugs ?? [],
            createdById: authedUser.id,
          },
          include: {
            image: true,
          },
        });

        return novel;
      }

      const name = sanitize(body.name);
      const slugs = body.slugs?.map((slug) => sanitize(slug)) ?? [];

      const novel = await prisma.novel.create({
        data: {
          name,
          slugs,
          createdById: authedUser.id,
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

  // Update novel (user: slugs only; admin: full)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body, authedUser }) => {
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

      if (!isAdmin(authedUser)) {
        const slugs = body.slugs?.map((slug) => sanitize(slug)) ?? existingNovel.slugs;

        const novel = await prisma.novel.update({
          where: { id },
          data: { slugs },
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
  .use(shouldBeAdmin())
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
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
