import { ChapterPlain, FilePlain, NovelPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import { authorize, canModerate } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize, sanitizeObject } from '@/utils/sanitize';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';
import {
  assertHasName,
  descriptionField,
  type Language,
  nameField,
  translatedDescriptionBody,
  translatedNameBody,
} from '@/utils/translation';

/** `name`/`description` sort columns read the request language's field. */
function localizedSortColumn(column: string | undefined, lang: Language): string | undefined {
  if (column === 'name') return nameField(lang);
  if (column === 'description') return descriptionField(lang);
  return column;
}

function cleanText(value: string | null | undefined): string | null | undefined {
  return value === undefined || value === null ? value : sanitize(value) || null;
}

function cleanNames(body: { nameAr?: string | null; nameEn?: string | null }) {
  return { nameAr: cleanText(body.nameAr), nameEn: cleanText(body.nameEn) };
}

export const novels = new Elysia({
  prefix: '/novels',
  tags: ['Novels'],
})
  .use(setup)
  .use(authorize('user'))

  // Get all novels with pagination
  .get(
    '/',
    async ({ prisma, lang, query: { pagination, query, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);
      const name = nameField(lang);
      const description = descriptionField(lang);

      // Readers only see novels named in their language.
      const where = {
        [name]: { not: null },
        ...(query?.search
        ? {
            OR: [
              {
                [name]: {
                  contains: query?.search,
                  mode: 'insensitive' as const,
                },
              },
              {
                [description]: {
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
        : {}),
      };

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
          orderBy: getNestedColumnObject(
            localizedSortColumn(sorting?.column, lang),
            sorting?.direction,
          ),
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

  // Create novel (reader: names, slugs and context only; moderator: full).
  // A novel already known by one of the slugs gets its missing translations filled instead.
  .post(
    '/',
    async ({ prisma, body, authedUser, t }) => {
      assertHasName(body, t);
      const names = cleanNames(body);
      const slugs = body.slugs?.map((slug) => sanitize(slug)) ?? [];
      const context = body.context ? sanitize(body.context) : undefined;

      const known = slugs.length
        ? await prisma.novel.findFirst({ where: { slugs: { hasSome: slugs } } })
        : null;
      if (known) {
        return prisma.novel.update({
          where: { id: known.id },
          data: {
            nameAr: known.nameAr ?? names.nameAr,
            nameEn: known.nameEn ?? names.nameEn,
            slugs: [...new Set([...known.slugs, ...slugs])],
            context: known.context?.trim() ? undefined : context,
          },
          include: { image: true },
        });
      }

      if (canModerate(authedUser)) {
        const sanitizedBody = sanitizeObject(body);

        const novel = await prisma.novel.create({
          data: {
            ...names,
            descriptionAr: cleanText(sanitizedBody.descriptionAr),
            descriptionEn: cleanText(sanitizedBody.descriptionEn),
            context: sanitizedBody.context,
            imageId: sanitizedBody.imageId,
            slugs,
            createdById: authedUser.id,
          },
          include: {
            image: true,
          },
        });

        return novel;
      }

      const novel = await prisma.novel.create({
        data: {
          ...names,
          slugs,
          context,
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
        ...translatedNameBody,
        ...translatedDescriptionBody,
        context: t.Optional(t.String({ minLength: 1, maxLength: 20000 })),
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

  // Update novel (reader: slugs, plus context and translations while they are empty; moderator: full)
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

      if (!canModerate(authedUser)) {
        const slugs = body.slugs?.map((slug) => sanitize(slug)) ?? existingNovel.slugs;
        // Readers may fill a missing context; only moderators can change an existing one.
        const context =
          body.context && !existingNovel.context?.trim()
            ? sanitize(body.context)
            : undefined;
        // Readers may add a missing translation of the name, not change an existing one.
        const names = cleanNames(body);

        const novel = await prisma.novel.update({
          where: { id },
          data: {
            slugs,
            context,
            nameAr: existingNovel.nameAr ? undefined : names.nameAr,
            nameEn: existingNovel.nameEn ? undefined : names.nameEn,
          },
          include: { image: true },
        });

        return novel;
      }

      const sanitizedBody = sanitizeObject(body);
      const names = cleanNames(body);
      assertHasName(
        {
          nameAr: names.nameAr === undefined ? existingNovel.nameAr : names.nameAr,
          nameEn: names.nameEn === undefined ? existingNovel.nameEn : names.nameEn,
        },
        t,
      );

      const novel = await prisma.novel.update({
        where: { id },
        data: {
          ...names,
          descriptionAr: cleanText(sanitizedBody.descriptionAr),
          descriptionEn: cleanText(sanitizedBody.descriptionEn),
          context: sanitizedBody.context,
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
        ...translatedNameBody,
        ...translatedDescriptionBody,
        context: t.Optional(t.String({ minLength: 1, maxLength: 20000 })),
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

  // Set novel context (reader: only while it is empty, e.g. AI auto-fill; moderator: always)
  .put(
    '/:id/context',
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

      if (!canModerate(authedUser) && existingNovel.context?.trim()) {
        throw new HttpError({
          statusCode: 403,
          message: t({
            en: 'Only moderators can change an existing novel context',
            ar: 'يمكن للمشرفين فقط تعديل سياق الرواية الموجود',
          }),
        });
      }

      const novel = await prisma.novel.update({
        where: { id },
        data: { context: sanitize(body.context) },
        include: { image: true },
      });

      return novel;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        context: t.String({ minLength: 1, maxLength: 20000 }),
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

  // Delete novel (moderator by default)
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
