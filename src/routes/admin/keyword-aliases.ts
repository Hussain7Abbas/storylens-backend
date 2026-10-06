import type { PrismaClient } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { MatchingType } from '@/lib/db';
import { mergeTranslationAlias } from '@/lib/keywords/merge';
import { authorize } from '@/middleware/authorize';
import { adminAliasSchema, styleBody, styleInclude } from '@/schemas/admin-keywords';
import { setup } from '@/setup';
import { cleanKeywordName } from '@/utils/arabic';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';
import { assertStyleRefs, styleData } from './keyword-styles';

function notFound(what: 'Alias' | 'Keyword'): never {
  throw new HttpError({ statusCode: 404, message: `${what} not found` });
}

function nameTaken(): never {
  throw new HttpError({ statusCode: 409, code: 'ALIAS_NAME_TAKEN', message: 'This keyword already has an alias with that name' });
}

function nameRequired(): never {
  throw new HttpError({ statusCode: 422, code: 'NAME_REQUIRED', message: 'An Arabic or English name is required' });
}

/** A sent name, trimmed; blank or `null` clears it, `undefined` keeps it. */
function cleanName(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value === null ? null : cleanKeywordName(sanitize(value));
}

/** Alias names are unique per keyword in each language. */
async function assertNamesFree(
  prisma: PrismaClient,
  keywordId: string,
  names: { nameAr?: string | null; nameEn?: string | null },
  exceptId?: string,
) {
  const filters = [
    ...(names.nameAr ? [{ nameAr: names.nameAr }] : []),
    ...(names.nameEn ? [{ nameEn: names.nameEn }] : []),
  ];
  if (!filters.length) return;
  const taken = await prisma.keywordAlias.findFirst({
    where: { keywordId, OR: filters, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) nameTaken();
}

const aliasFields = {
  ...styleBody,
  // Translation link: the alias of the same keyword that holds this one's
  // other-language name. It is merged into this alias and deleted.
  translationAliasId: t.Optional(t.String({ format: 'uuid' })),
  nameAr: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  nameEn: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  matchingType: t.Optional(MatchingType),
  fuzzyMatchArabicCharacters: t.Optional(t.Boolean()),
  overrideStyle: t.Optional(t.Boolean()),
};

export const adminKeywordAliases = new Elysia({ prefix: '/keyword-aliases', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))

  .post(
    '/',
    async ({ prisma, authedUser, body, t }) => {
      const names = { nameAr: cleanName(body.nameAr) ?? null, nameEn: cleanName(body.nameEn) ?? null };
      if (!names.nameAr && !names.nameEn) nameRequired();
      const keyword = await prisma.keyword.findUnique({ where: { id: body.keywordId }, select: { id: true } });
      if (!keyword) notFound('Keyword');
      await assertStyleRefs(prisma, body);
      await assertNamesFree(prisma, keyword.id, names);
      return prisma.$transaction(async (tx) => {
        const linked = body.translationAliasId
          ? await mergeTranslationAlias(tx, {
              target: { keywordId: keyword.id, ...names },
              sourceId: body.translationAliasId,
              t,
            })
          : {};
        return tx.keywordAlias.create({
          data: {
            ...styleData(body),
            ...names,
            ...linked,
            matchingType: body.matchingType ?? 'FULL',
            fuzzyMatchArabicCharacters: body.fuzzyMatchArabicCharacters ?? true,
            overrideStyle: body.overrideStyle ?? false,
            keywordId: keyword.id,
            createdById: authedUser.id,
          },
          include: styleInclude,
        });
      });
    },
    {
      body: t.Object({
        keywordId: t.String({ format: 'uuid' }),
        ...aliasFields,
      }),
      response: { 200: adminAliasSchema },
      detail: { summary: 'Add an alias to a keyword' },
    },
  )

  .put(
    '/:id',
    async ({ prisma, params: { id }, body, t }) => {
      const existing = await prisma.keywordAlias.findUnique({ where: { id } });
      if (!existing) notFound('Alias');
      await assertStyleRefs(prisma, body);
      const names = { nameAr: cleanName(body.nameAr), nameEn: cleanName(body.nameEn) };
      const nameAr = names.nameAr === undefined ? existing.nameAr : names.nameAr;
      const nameEn = names.nameEn === undefined ? existing.nameEn : names.nameEn;
      if (!nameAr && !nameEn) nameRequired();
      await assertNamesFree(
        prisma,
        existing.keywordId,
        {
          nameAr: nameAr !== existing.nameAr ? nameAr : undefined,
          nameEn: nameEn !== existing.nameEn ? nameEn : undefined,
        },
        id,
      );
      return prisma.$transaction(async (tx) => {
        const linked = body.translationAliasId
          ? await mergeTranslationAlias(tx, {
              target: { id, keywordId: existing.keywordId, nameAr, nameEn },
              sourceId: body.translationAliasId,
              t,
            })
          : {};
        return tx.keywordAlias.update({
          where: { id },
          data: {
            ...styleData(body),
            ...names,
            ...linked,
            matchingType: body.matchingType,
            fuzzyMatchArabicCharacters: body.fuzzyMatchArabicCharacters,
            overrideStyle: body.overrideStyle,
          },
          include: styleInclude,
        });
      });
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object(aliasFields),
      response: { 200: adminAliasSchema },
      detail: { summary: 'Update a keyword alias' },
    },
  )

  .delete(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const existing = await prisma.keywordAlias.findUnique({ where: { id }, include: styleInclude });
      if (!existing) notFound('Alias');
      await prisma.keywordAlias.delete({ where: { id } });
      return existing;
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: adminAliasSchema },
      detail: { summary: 'Delete a keyword alias' },
    },
  );
