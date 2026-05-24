import type { PrismaClient } from '@prisma/client';
import {
  KeywordCategoryPlain,
  KeywordNaturePlain,
  KeywordPlain,
  ReplacementPlain,
} from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema } from '@/schemas/common';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';
import { orderByIds, queryWeightedSearchIds } from '@/utils/weighted-search';

const replacementInclude = {
  keyword: true,
} as const;

export const replacements = new Elysia({
  prefix: '/replacements',
  tags: ['Replacements'],
})
  .use(setup)

  // Get all Replacements with filters
  .get(
    '/',
    async ({ prisma, query: { pagination, query, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      const where: Record<string, unknown> = {};

      if (query?.keywordId) {
        where.keywordId = query.keywordId;
      }

      if (query?.novelId) {
        where.novelId = query.novelId;
      }

      if (query?.search) {
        const { ids, total } = await queryWeightedSearchIds(prisma, {
          table: 'Replacement',
          primaryColumn: 'from',
          secondaryColumn: 'to',
          search: query.search,
          filters: {
            novelId: query.novelId,
            keywordId: query.keywordId,
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

        const replacements = await prisma.replacement.findMany({
          where: { id: { in: ids } },
          include: replacementInclude,
        });

        return {
          data: orderByIds(replacements, ids),
          total,
        };
      }

      const [replacements, total] = await Promise.all([
        prisma.replacement.findMany({
          where,
          skip,
          take,
          include: replacementInclude,
          orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
        }),
        prisma.replacement.count({ where }),
      ]);

      return {
        data: replacements,
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
            from: t.Optional(t.String()),
            to: t.Optional(t.String()),
            novelId: t.Optional(t.String({ format: 'uuid' })),
            keywordId: t.Optional(t.String({ format: 'uuid' })),
          }),
        ),
      }),
      response: {
        200: t.Object({
          data: t.Array(
            t.Composite([
              ReplacementPlain,
              t.Object({
                keyword: t.Nullable(KeywordPlain),
              }),
            ]),
          ),
          total: t.Number(),
        }),
      },
    },
  )

  // Get replacement by ID
  .get(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const replacement = await prisma.replacement.findUnique({
        where: { id },
        include: {
          keyword: {
            include: {
              category: true,
              nature: true,
            },
          },
        },
      });

      if (!replacement) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Replacement not found',
            ar: 'البديل غير موجود',
          }),
        });
      }

      return replacement;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Composite([
          ReplacementPlain,
          t.Object({
            keyword: t.Nullable(
              t.Composite([
                KeywordPlain,
                t.Object({
                  category: KeywordCategoryPlain,
                  nature: KeywordNaturePlain,
                }),
              ]),
            ),
          }),
        ]),
      },
    },
  )

  // Create replacement (User only)
  .post(
    '/',
    async ({ t, prisma, body }) => {
      await validateReplacement(body, prisma, t, 'create');
      const keyword = await checkChainReplacement(body, prisma);

      const replacement = await prisma.replacement.create({
        data: {
          novelId: body.novelId,
          from: body.from,
          to: body.to,
          keywordId: keyword?.id,
        },
        include: {
          keyword: true,
        },
      });

      return replacement;
    },
    {
      body: t.Object({
        novelId: t.String({ format: 'uuid' }),
        from: t.String({ minLength: 1 }),
        to: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Composite([
          ReplacementPlain,
          t.Object({
            keyword: t.Nullable(KeywordPlain),
          }),
        ]),
      },
    },
  )

  // Update replacement (User only)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body }) => {
      await validateReplacement(body, prisma, t, 'update');
      const keyword = await checkChainReplacement(body, prisma);

      const replacement = await prisma.replacement.update({
        where: { id },
        data: {
          from: body.from,
          to: body.to,
          keywordId: keyword?.id,
        },
        include: {
          keyword: true,
        },
      });

      return replacement;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        novelId: t.String({ format: 'uuid' }),
        from: t.String({ minLength: 1 }),
        to: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Composite([
          ReplacementPlain,
          t.Object({
            keyword: t.Nullable(KeywordPlain),
          }),
        ]),
      },
    },
  )

  // Delete replacement (User only)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const existingReplacement = await prisma.replacement.findUnique({
        where: { id },
      });

      if (!existingReplacement) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Replacement not found',
            ar: 'البديل غير موجود',
          }),
        });
      }

      await prisma.replacement.delete({
        where: { id },
      });

      return existingReplacement;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: ReplacementPlain,
      },
    },
  );

async function validateReplacement(
  body: { id?: string; from: string; to: string; novelId: string },
  prisma: PrismaClient,
  t: ({ en, ar }: { en: string; ar: string }) => string,
  mode: 'create' | 'update',
) {
  if (mode === 'update') {
    const existingReplacement = await prisma.replacement.findUnique({
      where: { id: body.id },
    });

    if (!existingReplacement) {
      throw new HttpError({
        statusCode: 404,
        message: t({
          en: 'Replacement not found',
          ar: 'البديل غير موجود',
        }),
      });
    }
  }

  // Check if replacement already exists
  const existingReplacement = await prisma.replacement.findFirst({
    where: {
      from: body.from,
      novelId: body.novelId,
    },
  });

  if (existingReplacement) {
    throw new HttpError({
      message: t({
        en: 'Replacement already exists for this keyword',
        ar: 'البديل موجود بالفعل لهذه الكلمة المفتاحية',
      }),
    });
  }

  // Check if there is bidirectional replacement
  const bidirectionalReplacement = await prisma.replacement.findFirst({
    where: {
      from: body.to,
      to: body.from,
      novelId: body.novelId,
    },
  });

  if (bidirectionalReplacement) {
    throw new HttpError({
      message: t({
        en: 'There is a bidirectional replacement',
        ar: 'هناك بديل متبادل',
      }),
    });
  }
}

async function checkChainReplacement(
  body: { from: string; to: string; novelId: string },
  prisma: PrismaClient,
) {
  // check if there is a keyword linked to the "to replacement"
  const keyword = await prisma.keyword.findFirst({
    where: {
      name: body.to,
      novelId: body.novelId,
    },
  });

  // Check if there is a chain of replacements then update the replacement
  const chainReplacement = await prisma.replacement.findMany({
    where: {
      to: body.from,
      novelId: body.novelId,
    },
  });

  if (chainReplacement.length > 0) {
    await prisma.replacement.updateMany({
      where: {
        to: body.from,
        novelId: body.novelId,
      },
      data: {
        to: body.to,
        keywordId: keyword?.id,
      },
    });
  }

  return keyword;
}
