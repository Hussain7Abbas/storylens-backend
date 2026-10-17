import { deleteLookup } from '@/lib/sync/delete-lookup';
import { wordVfxSchema, wordVfxColorSchema } from '@/schemas/word-vfx';
import { KeywordCategoryPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import type { PrismaClient } from '@prisma/client';
import { paginationSchema, sortingSchema, staleWriteSchema } from '@/schemas/common';
import {
  assertLookupHasName,
  cleanLookupName,
  isLookupReplay,
  type LookupNames,
  lookupNameFilters,
  lookupNameTaken,
} from '@/lib/sync/lookups';
import { assertNotStale, compareAndSwap } from '@/lib/sync/precondition';
import { createWithReplay, findReplay } from '@/lib/sync/replay';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { getNestedColumnObject, parsePaginationProps } from '@/utils/helpers';

const categoryEffectSchema = t.Union(['NONE', 'SPARKLES', 'HEAT', 'SHAKING', 'GLITCHING'].map((effect) => t.Literal(effect)));

export const keywordCategories = new Elysia({
  prefix: '/keyword-categories',
  tags: ['KeywordCategories'],
})
  .use(setup)
  .use(authorize('user'))

  // Get all keyword categories
  .get(
    '/',
    async ({ prisma, query: { pagination, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      const [categories, total] = await Promise.all([
        prisma.keywordCategory.findMany({
          skip,
          take,
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
          _count: {
            select: {
              keywordVersions: true,
              keywordAliases: true,
            },
          },
        },
      });

      if (!category) {
        throw new HttpError({
          statusCode: 404,
          code: 'NOT_FOUND',
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
            _count: t.Object({
              keywordVersions: t.Number(),
              keywordAliases: t.Number(),
            }),
          }),
        ]),
      },
    },
  )

  // Create keyword category (moderator by default). The client sends the ID, so a replay
  // with the same names and color returns the same row.
  .post(
    '/',
    async ({ t, prisma, body }) => {
      const findCategory = () => prisma.keywordCategory.findUnique({ where: { id: body.id } });
      const isReplay = (row: CategoryRow) =>
        isLookupReplay(row, body) &&
        (body.effect === undefined || row.effect === body.effect) &&
        (body.wordVfx === undefined || row.wordVfx === body.wordVfx) &&
        (body.wordVfxColor === undefined || row.wordVfxColor === body.wordVfxColor) &&
        (body.switchPositionWithNature === undefined || row.switchPositionWithNature === body.switchPositionWithNature);

      const replay = await findReplay(findCategory, isReplay, t);
      if (replay) return replay;

      const names = { nameAr: cleanLookupName(body.nameAr) ?? null, nameEn: cleanLookupName(body.nameEn) ?? null };
      assertLookupHasName(names, t);
      await assertNamesFree(prisma, t, names, body.id);

      return createWithReplay(
        () =>
          prisma.keywordCategory.create({
            data: {
              id: body.id,
              ...names,
              color: body.color,
              effect: body.effect,
              wordVfx: body.wordVfx,
              wordVfxColor: body.wordVfxColor,
              switchPositionWithNature: body.switchPositionWithNature,
              description: body.description,
            },
          }),
        findCategory,
        isReplay,
        t,
      );
    },
    {
      body: t.Object({
        id: t.String({ format: 'uuid' }),
        nameEn: t.Optional(t.Nullable(t.String())),
        nameAr: t.Optional(t.Nullable(t.String())),
        color: t.String({ pattern: '^#[0-9A-Fa-f]{6}$' }),
        effect: t.Optional(categoryEffectSchema),
        wordVfx: t.Optional(wordVfxSchema),
        wordVfxColor: t.Optional(wordVfxColorSchema),
        switchPositionWithNature: t.Optional(t.Boolean()),
        description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
      response: {
        200: KeywordCategoryPlain,
      },
    },
  )

  // Update keyword category (moderator by default). Partial: only sent fields change.
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body }) => {
      const existing = await prisma.keywordCategory.findUnique({ where: { id } });
      if (!existing) throw notFound(t);

      await assertNotStale(existing, body.baseUpdatedAt, () => prisma.keywordCategory.findUniqueOrThrow({ where: { id } }), t);

      const names = { nameAr: cleanLookupName(body.nameAr), nameEn: cleanLookupName(body.nameEn) };
      assertLookupHasName(
        {
          nameAr: names.nameAr === undefined ? existing.nameAr : names.nameAr,
          nameEn: names.nameEn === undefined ? existing.nameEn : names.nameEn,
        },
        t,
      );
      await assertNamesFree(
        prisma,
        t,
        {
          nameAr: names.nameAr !== existing.nameAr ? names.nameAr : undefined,
          nameEn: names.nameEn !== existing.nameEn ? names.nameEn : undefined,
        },
        id,
      );

      return compareAndSwap(() => prisma.keywordCategory.update({
        where: { id, updatedAt: existing.updatedAt },
        data: {
          ...names,
          color: body.color,
          effect: body.effect,
          wordVfx: body.wordVfx,
          wordVfxColor: body.wordVfxColor,
          switchPositionWithNature: body.switchPositionWithNature,
          description: body.description,
        },
      }), () => prisma.keywordCategory.findUniqueOrThrow({ where: { id } }), t);
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      body: t.Object({
        baseUpdatedAt: t.String({ format: 'date-time' }),
        nameEn: t.Optional(t.Nullable(t.String())),
        nameAr: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.String({ pattern: '^#[0-9A-Fa-f]{6}$' })),
        effect: t.Optional(categoryEffectSchema),
        wordVfx: t.Optional(wordVfxSchema),
        wordVfxColor: t.Optional(wordVfxColorSchema),
        switchPositionWithNature: t.Optional(t.Boolean()),
        description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
      response: {
        200: KeywordCategoryPlain,
        409: staleWriteSchema(KeywordCategoryPlain),
      },
    },
  )

  // Delete, optionally moving every linked version/alias in the same transaction.
  .delete('/:id', async ({ t, prisma, params: { id }, query: { replacementId } }) => {
    const existing = await prisma.keywordCategory.findUnique({ where: { id } });
    if (!existing) throw notFound(t);
    await deleteLookup(prisma, 'keywordCategory', id, replacementId, t);
    return existing;
  }, {
    params: t.Object({ id: t.String({ format: 'uuid' }) }),
    query: t.Object({ replacementId: t.Optional(t.String({ format: 'uuid' })) }),
    response: { 200: KeywordCategoryPlain },
  });

type CategoryRow = Awaited<ReturnType<PrismaClient['keywordCategory']['findUniqueOrThrow']>>;
type Translate = (messages: { en: string; ar: string }) => string;

function notFound(t: Translate): HttpError {
  return new HttpError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: t({ en: 'Category not found', ar: 'الفئة غير موجودة' }),
  });
}

/** Names are unique in each language they are given in; `exceptId` is the row being saved. */
async function assertNamesFree(
  prisma: PrismaClient,
  t: Translate,
  names: LookupNames,
  exceptId: string,
): Promise<void> {
  const filters = lookupNameFilters(names);
  if (!filters.length) return;
  const conflict = await prisma.keywordCategory.findFirst({ where: { id: { not: exceptId }, OR: filters } });
  if (conflict) {
    throw lookupNameTaken(t({ en: 'Category name already exists', ar: 'اسم الفئة موجود بالفعل' }));
  }
}
