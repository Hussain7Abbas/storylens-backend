import type { Prisma } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { KeywordCategoryPlain, KeywordNaturePlain } from '@/lib/db';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

type StyleInput = {
  description?: string | null;
  categoryId?: string | null;
  natureId?: string | null;
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

/** Style fields for Prisma: `undefined` keeps a value, `null` or blank clears it. */
export function styleData(body: StyleInput) {
  return {
    description:
      body.description === undefined ? undefined : body.description === null ? null : sanitize(body.description) || null,
    categoryId: body.categoryId,
    natureId: body.natureId,
    imageId: body.imageId,
  };
}

const orderByName = [{ nameEn: 'asc' }, { nameAr: 'asc' }] satisfies Prisma.KeywordCategoryOrderByWithRelationInput[];

export const adminKeywordCategories = new Elysia({ prefix: '/keyword-categories', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))

  .get('/', async ({ prisma }) => ({ data: await prisma.keywordCategory.findMany({ orderBy: orderByName }) }), {
    response: { 200: t.Object({ data: t.Array(KeywordCategoryPlain) }) },
    detail: { summary: 'List keyword categories' },
  });

export const adminKeywordNatures = new Elysia({ prefix: '/keyword-natures', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))

  .get('/', async ({ prisma }) => ({ data: await prisma.keywordNature.findMany({ orderBy: orderByName }) }), {
    response: { 200: t.Object({ data: t.Array(KeywordNaturePlain) }) },
    detail: { summary: 'List keyword natures' },
  });
