import { imageDescriptionValue } from '@/lib/keywords/image-description';
import { wordVfxSchema, wordVfxColorSchema } from '@/schemas/word-vfx';
import { assertNotStale, compareAndSwap } from '@/lib/sync/precondition';
import { staleWriteSchema } from '@/schemas/common';
import { descriptionData } from '@/lib/keywords/descriptions';
import { deleteLookup } from '@/lib/sync/delete-lookup';
import { assertLookupHasName, cleanLookupName, isLookupReplay, lookupNameFilters, lookupNameTaken, type LookupNames } from '@/lib/sync/lookups';
import { createWithReplay, findReplay } from '@/lib/sync/replay';
import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { KeywordCategoryPlain, KeywordNaturePlain } from '@/lib/db';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

type StyleInput = {
  description?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  categoryId?: string | null;
  natureId?: string | null;
  imageDescription?: string | null;
  imagePrompt?: string | null;
  imageId?: string | null;
};

/** 404s when a referenced category or nature is gone. */
export async function assertStyleRefs(prisma: Prisma.TransactionClient, body: StyleInput) {
  const [category, nature] = await Promise.all([
    body.categoryId ? prisma.keywordCategory.findUnique({ where: { id: body.categoryId } }) : null,
    body.natureId ? prisma.keywordNature.findUnique({ where: { id: body.natureId } }) : null,
  ]);
  if (body.categoryId && !category) throw new HttpError({ statusCode: 404, message: 'Category not found' });
  if (body.natureId && !nature) throw new HttpError({ statusCode: 404, message: 'Nature not found' });
}

function cleanDescription(value: string | null | undefined) {
  return value === undefined ? undefined : value === null ? null : sanitize(value) || null;
}

/** Style fields for Prisma: `undefined` keeps a value, `null` or blank clears it. */
export function styleData(body: StyleInput) {
  return {
    ...descriptionData({
      description: cleanDescription(body.description),
      descriptionAr: cleanDescription(body.descriptionAr),
      descriptionEn: cleanDescription(body.descriptionEn),
    }),
    categoryId: body.categoryId,
    natureId: body.natureId,
    imageDescription: cleanDescription(imageDescriptionValue(body)),
    imageId: body.imageId,
  };
}

const orderByName = [{ nameEn: 'asc' }, { nameAr: 'asc' }] satisfies Prisma.KeywordCategoryOrderByWithRelationInput[];
const lookupFields = {
  nameEn: t.Optional(t.Nullable(t.String())),
  nameAr: t.Optional(t.Nullable(t.String())),
  description: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
};
const colorSchema = t.String({ pattern: '^#[0-9A-Fa-f]{6}$' });
const categoryFields = {
  wordVfx: t.Optional(wordVfxSchema),
  wordVfxColor: t.Optional(wordVfxColorSchema),
  switchPositionWithNature: t.Optional(t.Boolean()),
};
const idParams = t.Object({ id: t.String({ format: 'uuid' }) });
const replacementQuery = t.Object({ replacementId: t.Optional(t.String({ format: 'uuid' })) });
type Translate = (messages: { en: string; ar: string }) => string;

async function lookupNames(prisma: PrismaClient, kind: 'keywordCategory' | 'keywordNature', body: LookupNames, id: string, t: Translate, existing?: LookupNames) {
  const names = { nameEn: cleanLookupName(body.nameEn), nameAr: cleanLookupName(body.nameAr) };
  assertLookupHasName({
    nameEn: names.nameEn === undefined ? existing?.nameEn : names.nameEn,
    nameAr: names.nameAr === undefined ? existing?.nameAr : names.nameAr,
  }, t);
  const filters = lookupNameFilters(names);
  if (filters.length) {
    const where = { id: { not: id }, OR: filters };
    const conflict = kind === 'keywordCategory'
      ? await prisma.keywordCategory.findFirst({ where })
      : await prisma.keywordNature.findFirst({ where });
    if (conflict) throw lookupNameTaken(t({ en: 'Name already exists', ar: 'الاسم موجود بالفعل' }));
  }
  return names;
}

export const adminKeywordCategories = new Elysia({ prefix: '/keyword-categories', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))
  .get('/', async ({ prisma }) => ({ data: await prisma.keywordCategory.findMany({ orderBy: orderByName }) }), {
    response: { 200: t.Object({ data: t.Array(KeywordCategoryPlain) }) },
    detail: { summary: 'List keyword categories' },
  })
  .post('/', async ({ prisma, body, t }) => {
    const current = () => prisma.keywordCategory.findUnique({ where: { id: body.id } });
    const isReplay = (row: Prisma.KeywordCategoryGetPayload<object>) => isLookupReplay(row, body)
      && (body.description === undefined || row.description === body.description)
      && (body.wordVfx === undefined || row.wordVfx === body.wordVfx)
      && (body.wordVfxColor === undefined || row.wordVfxColor === body.wordVfxColor)
      && (body.switchPositionWithNature === undefined || row.switchPositionWithNature === body.switchPositionWithNature);
    const replay = await findReplay(current, isReplay, t);
    if (replay) return replay;
    const names = await lookupNames(prisma, 'keywordCategory', body, body.id, t);
    return createWithReplay(() => prisma.keywordCategory.create({ data: { ...body, ...names } }), current, isReplay, t);
  }, {
    body: t.Object({ id: t.String({ format: 'uuid' }), ...lookupFields, color: colorSchema, ...categoryFields }),
    response: { 200: KeywordCategoryPlain },
    detail: { summary: 'Create keyword category' },
  })
  .put('/:id', async ({ prisma, params: { id }, body, t }) => {
    const existing = await prisma.keywordCategory.findUnique({ where: { id } });
    if (!existing) throw new HttpError({ statusCode: 404, message: 'Category not found' });
    const current = () => prisma.keywordCategory.findUniqueOrThrow({ where: { id } });
    await assertNotStale(existing, body.baseUpdatedAt, current, t);
    const names = await lookupNames(prisma, 'keywordCategory', body, id, t, existing);
    const { baseUpdatedAt: _, ...data } = body;
    return compareAndSwap(() => prisma.keywordCategory.update({
      where: { id, updatedAt: existing.updatedAt }, data: { ...data, ...names },
    }), current, t);
  }, {
    params: idParams,
    body: t.Object({ baseUpdatedAt: t.String({ format: 'date-time' }), ...lookupFields, color: t.Optional(colorSchema), ...categoryFields }),
    response: { 200: KeywordCategoryPlain, 409: staleWriteSchema(KeywordCategoryPlain) },
    detail: { summary: 'Update keyword category' },
  })
  .delete('/:id', async ({ prisma, params: { id }, query: { replacementId }, t }) => {
    const existing = await prisma.keywordCategory.findUnique({ where: { id } });
    if (!existing) throw new HttpError({ statusCode: 404, message: 'Category not found' });
    await deleteLookup(prisma, 'keywordCategory', id, replacementId, t);
    return existing;
  }, {
    params: idParams, query: replacementQuery,
    response: { 200: KeywordCategoryPlain },
    detail: { summary: 'Delete keyword category, optionally replacing linked data' },
  });

export const adminKeywordNatures = new Elysia({ prefix: '/keyword-natures', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))
  .get('/', async ({ prisma }) => ({ data: await prisma.keywordNature.findMany({ orderBy: orderByName }) }), {
    response: { 200: t.Object({ data: t.Array(KeywordNaturePlain) }) },
    detail: { summary: 'List keyword natures' },
  })
  .post('/', async ({ prisma, body, t }) => {
    const current = () => prisma.keywordNature.findUnique({ where: { id: body.id } });
    const isReplay = (row: Prisma.KeywordNatureGetPayload<object>) => isLookupReplay(row, body)
      && (body.description === undefined || row.description === body.description);
    const replay = await findReplay(current, isReplay, t);
    if (replay) return replay;
    const names = await lookupNames(prisma, 'keywordNature', body, body.id, t);
    return createWithReplay(() => prisma.keywordNature.create({ data: { ...body, ...names } }), current, isReplay, t);
  }, {
    body: t.Object({ id: t.String({ format: 'uuid' }), ...lookupFields, color: colorSchema }),
    response: { 200: KeywordNaturePlain },
    detail: { summary: 'Create keyword nature' },
  })
  .put('/:id', async ({ prisma, params: { id }, body, t }) => {
    const existing = await prisma.keywordNature.findUnique({ where: { id } });
    if (!existing) throw new HttpError({ statusCode: 404, message: 'Nature not found' });
    const current = () => prisma.keywordNature.findUniqueOrThrow({ where: { id } });
    await assertNotStale(existing, body.baseUpdatedAt, current, t);
    const names = await lookupNames(prisma, 'keywordNature', body, id, t, existing);
    const { baseUpdatedAt: _, ...data } = body;
    return compareAndSwap(() => prisma.keywordNature.update({
      where: { id, updatedAt: existing.updatedAt }, data: { ...data, ...names },
    }), current, t);
  }, {
    params: idParams,
    body: t.Object({ baseUpdatedAt: t.String({ format: 'date-time' }), ...lookupFields, color: t.Optional(colorSchema) }),
    response: { 200: KeywordNaturePlain, 409: staleWriteSchema(KeywordNaturePlain) },
    detail: { summary: 'Update keyword nature' },
  })
  .delete('/:id', async ({ prisma, params: { id }, query: { replacementId }, t }) => {
    const existing = await prisma.keywordNature.findUnique({ where: { id } });
    if (!existing) throw new HttpError({ statusCode: 404, message: 'Nature not found' });
    await deleteLookup(prisma, 'keywordNature', id, replacementId, t);
    return existing;
  }, {
    params: idParams, query: replacementQuery,
    response: { 200: KeywordNaturePlain },
    detail: { summary: 'Delete keyword nature, optionally replacing linked data' },
  });
