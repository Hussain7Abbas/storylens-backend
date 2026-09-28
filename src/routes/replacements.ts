import type { PrismaClient, Replacement } from '@prisma/client';
import {
  KeywordPlain,
  MatchingType,
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

const replacementInclude = {
  keyword: true,
} as const;

export const replacements = new Elysia({
  prefix: '/replacements',
  tags: ['Replacements'],
})
  .use(setup)
  .use(shouldBeGuest())

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
          keyword: true,
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
            keyword: t.Nullable(KeywordPlain),
          }),
        ]),
      },
    },
  )

  // Create replacement (users and admins)
  .use(shouldBeUser())
  .post(
    '/',
    async ({ t, prisma, body, authedUser }) => {
      const sanitizedBody = sanitizeObject(body);
      await validateReplacement(sanitizedBody, prisma, t, 'create');
      const keyword = await checkChainReplacement(sanitizedBody, prisma);

      const replacement = await prisma.replacement.create({
        data: {
          novelId: sanitizedBody.novelId,
          from: sanitizedBody.from,
          to: sanitizedBody.to,
          matchingType: sanitizedBody.matchingType ?? 'FULL',
          keywordId: keyword?.id,
          createdById: authedUser.id,
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
        matchingType: t.Optional(MatchingType),
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

  // Update replacement (own for users, any for admins)
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body, authedUser }) => {
      const sanitizedBody = sanitizeObject({ ...body, id });
      const existingReplacement = await validateReplacement(
        sanitizedBody,
        prisma,
        t,
        'update',
      );
      assertOwnsResource(existingReplacement?.createdById, authedUser);
      const keyword = await checkChainReplacement(sanitizedBody, prisma);

      const replacement = await prisma.replacement.update({
        where: { id },
        data: {
          from: sanitizedBody.from,
          to: sanitizedBody.to,
          matchingType: sanitizedBody.matchingType,
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
        matchingType: MatchingType,
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

  // Delete replacement (own for users, any for admins)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id }, authedUser }) => {
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

      assertOwnsResource(existingReplacement.createdById, authedUser);

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
): Promise<Replacement | null> {
  let currentReplacement: Replacement | null = null;

  if (mode === 'update') {
    currentReplacement = await prisma.replacement.findUnique({
      where: { id: body.id },
    });

    if (!currentReplacement) {
      throw new HttpError({
        statusCode: 404,
        message: t({
          en: 'Replacement not found',
          ar: 'البديل غير موجود',
        }),
      });
    }
  }

  const existingReplacement = await prisma.replacement.findFirst({
    where: {
      from: body.from,
      novelId: body.novelId,
      ...(mode === 'update' && body.id ? { id: { not: body.id } } : {}),
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

  return currentReplacement;
}

async function checkChainReplacement(
  body: { from: string; to: string; novelId: string },
  prisma: PrismaClient,
) {
  const keyword = await prisma.keyword.findFirst({
    where: {
      name: body.to,
      novelId: body.novelId,
    },
  });

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
