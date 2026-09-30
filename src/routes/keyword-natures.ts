import { Elysia, t } from 'elysia';
import { KeywordNaturePlain } from '@/lib/db';
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

export const keywordNatures = new Elysia({
  prefix: '/keyword-natures',
  tags: ['KeywordNatures'],
})
  .use(setup)
  .use(authorize('user'))

  // Get all keyword natures
  .get(
    '/',
    async ({ prisma, query: { pagination, sorting } }) => {
      const { skip, take } = parsePaginationProps(pagination);

      const [natures, total] = await Promise.all([
        prisma.keywordNature.findMany({
          skip,
          take,
          orderBy: getNestedColumnObject(sorting?.column, sorting?.direction),
        }),
        prisma.keywordNature.count(),
      ]);

      return { data: natures, total };
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
          _count: {
            select: {
              keywordVersions: true,
            },
          },
        },
      });

      if (!nature) {
        throw new HttpError({
          statusCode: 404,
          code: 'NOT_FOUND',
          message: t({ en: 'Nature not found', ar: 'الطبيعة غير موجودة' }),
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
            _count: t.Object({ keywordVersions: t.Number() }),
          }),
        ]),
      },
    },
  )

  // Create keyword nature (moderator by default). The client sends the ID, so a replay
  // with the same names and color returns the same row.
  .post(
    '/',
    async ({ t, prisma, body }) => {
      const findNature = () => prisma.keywordNature.findUnique({ where: { id: body.id } });
      const isReplay = (row: NatureRow) => isLookupReplay(row, body);

      const replay = await findReplay(findNature, isReplay, t);
      if (replay) return replay;

      const names = { nameAr: cleanLookupName(body.nameAr) ?? null, nameEn: cleanLookupName(body.nameEn) ?? null };
      assertLookupHasName(names, t);
      await assertNamesFree(prisma, t, names, body.id);

      return createWithReplay(
        () =>
          prisma.keywordNature.create({
            data: {
              id: body.id,
              ...names,
              color: body.color,
              description: body.description,
            },
          }),
        findNature,
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
        description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
      response: {
        200: KeywordNaturePlain,
      },
    },
  )

  // Update keyword nature (moderator by default). Partial: only sent fields change.
  .put(
    '/:id',
    async ({ t, prisma, params: { id }, body }) => {
      const existing = await prisma.keywordNature.findUnique({ where: { id } });
      if (!existing) throw notFound(t);

      await assertNotStale(existing, body.baseUpdatedAt, () => prisma.keywordNature.findUniqueOrThrow({ where: { id } }), t);

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

      return compareAndSwap(() => prisma.keywordNature.update({
        where: { id, updatedAt: existing.updatedAt },
        data: {
          ...names,
          color: body.color,
          description: body.description,
        },
      }), () => prisma.keywordNature.findUniqueOrThrow({ where: { id } }), t);
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
        description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
      response: {
        200: KeywordNaturePlain,
        409: staleWriteSchema(KeywordNaturePlain),
      },
    },
  )

  // Delete keyword nature (moderator by default); refused while a version or alias uses it
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const existing = await prisma.keywordNature.findUnique({
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

      if (!existing) throw notFound(t);

      if (existing._count.keywordVersions > 0 || existing._count.keywordAliases > 0) {
        throw new HttpError({
          statusCode: 400,
          code: 'NATURE_IN_USE',
          message: t({
            en: 'Cannot delete nature with keywords',
            ar: 'لا يمكن حذف طبيعة تحتوي على كلمات مفتاحية',
          }),
        });
      }

      await prisma.keywordNature.delete({
        where: { id },
      });

      const { _count: _usage, ...nature } = existing;
      return nature;
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

type NatureRow = Awaited<ReturnType<PrismaClient['keywordNature']['findUniqueOrThrow']>>;
type Translate = (messages: { en: string; ar: string }) => string;

function notFound(t: Translate): HttpError {
  return new HttpError({
    statusCode: 404,
    code: 'NOT_FOUND',
    message: t({ en: 'Nature not found', ar: 'الطبيعة غير موجودة' }),
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
  const conflict = await prisma.keywordNature.findFirst({ where: { id: { not: exceptId }, OR: filters } });
  if (conflict) {
    throw lookupNameTaken(t({ en: 'Nature name already exists', ar: 'اسم الطبيعة موجود بالفعل' }));
  }
}
