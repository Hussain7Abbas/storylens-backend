import type { Prisma, PrismaClient } from '@prisma/client';
import {
  KeywordPlain,
  MatchingType,
  ReplacementPlain,
} from '@/lib/db';
import { Elysia, t } from 'elysia';
import { paginationSchema, sortingSchema, staleWriteSchema } from '@/schemas/common';
import { assertNotStale } from '@/lib/sync/precondition';
import { createWithReplay, findReplay } from '@/lib/sync/replay';
import { assertOwnsResource, authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitizeObject } from '@/utils/sanitize';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';
import { orderByIds, queryWeightedSearchIds } from '@/utils/weighted-search';

const replacementInclude = {
  keyword: true,
} as const;

const replacementShape = t.Composite([
  ReplacementPlain,
  t.Object({
    keyword: t.Nullable(KeywordPlain),
  }),
]);

type Translate = ({ en, ar }: { en: string; ar: string }) => string;

export const replacements = new Elysia({
  prefix: '/replacements',
  tags: ['Replacements'],
})
  .use(setup)
  .use(authorize('user'))

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
          code: 'NOT_FOUND',
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

  // Create replacement (readers and moderators). The client sends the ID, so a replay
  // returns the same row without rewriting chains again.
  .post(
    '/',
    async ({ t, prisma, body, authedUser }) => {
      const findReplacement = () =>
        prisma.replacement.findUnique({ where: { id: body.id }, include: replacementInclude });
      const isReplay = (row: { createdById: string | null; novelId: string }) =>
        row.createdById === authedUser.id && row.novelId === body.novelId;

      const replay = await findReplay(findReplacement, isReplay, t);
      if (replay) return replay;

      const sanitizedBody = sanitizeObject(body);
      const novel = await prisma.novel.findUnique({ where: { id: sanitizedBody.novelId }, select: { id: true } });
      if (!novel) {
        throw new HttpError({
          statusCode: 404,
          code: 'PARENT_NOT_FOUND',
          message: t({ en: 'Novel not found', ar: 'الرواية غير موجودة' }),
        });
      }
      await validateReplacement({ ...sanitizedBody, exceptId: body.id }, prisma, t);

      return createWithReplay(
        () =>
          prisma.$transaction(async (tx) => {
            const keyword = await rewriteChain(sanitizedBody, tx);
            return tx.replacement.create({
              data: {
                id: body.id,
                novelId: sanitizedBody.novelId,
                from: sanitizedBody.from,
                to: sanitizedBody.to,
                matchingType: sanitizedBody.matchingType ?? 'FULL',
                keywordId: keyword?.id,
                createdById: authedUser.id,
              },
              include: replacementInclude,
            });
          }),
        findReplacement,
        isReplay,
        t,
      );
    },
    {
      body: t.Object({
        id: t.String({ format: 'uuid' }),
        novelId: t.String({ format: 'uuid' }),
        from: t.String({ minLength: 1 }),
        to: t.String({ minLength: 1 }),
        matchingType: t.Optional(MatchingType),
      }),
      response: {
        200: replacementShape,
      },
    },
  )

  // Update replacement (own for readers, any for moderators). Partial: rules are checked
  // against the stored row merged with the sent fields.
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body, authedUser }) => {
      const existing = await prisma.replacement.findUnique({ where: { id } });
      if (!existing) throw replacementNotFound(t);

      assertOwnsResource(existing.createdById, authedUser);
      await assertNotStale(
        existing,
        body.baseUpdatedAt,
        () => prisma.replacement.findUniqueOrThrow({ where: { id }, include: replacementInclude }),
        t,
      );

      const sanitizedBody = sanitizeObject(body);
      const merged = {
        novelId: existing.novelId,
        from: sanitizedBody.from ?? existing.from,
        to: sanitizedBody.to ?? existing.to,
      };
      await validateReplacement({ ...merged, exceptId: id }, prisma, t);

      return prisma.$transaction(async (tx) => {
        const keyword = await rewriteChain(merged, tx);
        return tx.replacement.update({
          where: { id },
          data: {
            from: sanitizedBody.from,
            to: sanitizedBody.to,
            matchingType: sanitizedBody.matchingType,
            keywordId: keyword?.id ?? null,
          },
          include: replacementInclude,
        });
      });
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        baseUpdatedAt: t.String({ format: 'date-time' }),
        from: t.Optional(t.String({ minLength: 1 })),
        to: t.Optional(t.String({ minLength: 1 })),
        matchingType: t.Optional(MatchingType),
      }),
      response: {
        200: replacementShape,
        409: staleWriteSchema(replacementShape),
      },
    },
  )

  // Delete replacement (own for readers, any for moderators); unconditional
  .delete(
    '/:id',
    async ({ t, prisma, params: { id }, authedUser }) => {
      const existingReplacement = await prisma.replacement.findUnique({
        where: { id },
      });

      if (!existingReplacement) throw replacementNotFound(t);

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

function replacementNotFound(t: Translate): HttpError {
  return new HttpError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: t({
      en: 'Replacement not found',
      ar: 'البديل غير موجود',
    }),
  });
}

/** `from` is unique per novel, and no pair may replace in both directions. */
async function validateReplacement(
  body: { exceptId: string; from: string; to: string; novelId: string },
  prisma: PrismaClient,
  t: Translate,
): Promise<void> {
  const existingReplacement = await prisma.replacement.findFirst({
    where: {
      from: body.from,
      novelId: body.novelId,
      id: { not: body.exceptId },
    },
  });

  if (existingReplacement) {
    throw new HttpError({
      statusCode: 409,
      code: 'REPLACEMENT_EXISTS',
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
      id: { not: body.exceptId },
    },
  });

  if (bidirectionalReplacement) {
    throw new HttpError({
      statusCode: 400,
      code: 'REPLACEMENT_BIDIRECTIONAL',
      message: t({
        en: 'There is a bidirectional replacement',
        ar: 'هناك بديل متبادل',
      }),
    });
  }
}

/**
 * Chain rewrite: replacements whose `to` is this one's `from` now point to its `to`.
 * Returns the keyword named `to`, which the replacement links to.
 */
async function rewriteChain(
  body: { from: string; to: string; novelId: string },
  prisma: Prisma.TransactionClient,
) {
  const keyword = await prisma.keyword.findFirst({
    where: {
      OR: [{ nameAr: body.to }, { nameEn: body.to }],
      novelId: body.novelId,
    },
  });

  await prisma.replacement.updateMany({
    where: {
      to: body.from,
      novelId: body.novelId,
    },
    data: {
      to: body.to,
      keywordId: keyword?.id ?? null,
    },
  });

  return keyword;
}
