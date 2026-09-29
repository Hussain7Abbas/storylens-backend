import { Elysia, t } from 'elysia';
import { MatchingType } from '@/lib/db';
import { authorize } from '@/middleware/authorize';
import { adminAliasSchema, styleBody, styleInclude } from '@/schemas/admin-keywords';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';
import { aliasNameColumns } from '@/utils/translation';
import { assertStyleRefs, styleData } from './keyword-styles';

function notFound(what: 'Alias' | 'Keyword'): never {
  throw new HttpError({ statusCode: 404, message: `${what} not found` });
}

function nameTaken(): never {
  throw new HttpError({ statusCode: 409, message: 'This keyword already has an alias with that name' });
}

/** Explicit language names; otherwise they follow `name` by its script. `null` clears one. */
function languageNames(
  body: { nameAr?: string | null; nameEn?: string | null },
  derived: { nameAr: string | null; nameEn: string | null },
) {
  const pick = (value: string | null | undefined, fallback: string | null) =>
    value === undefined ? fallback : value === null ? null : sanitize(value) || null;
  return { nameAr: pick(body.nameAr, derived.nameAr), nameEn: pick(body.nameEn, derived.nameEn) };
}

const aliasFields = {
  ...styleBody,
  nameAr: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  nameEn: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  matchingType: t.Optional(MatchingType),
  overrideStyle: t.Optional(t.Boolean()),
};

export const adminKeywordAliases = new Elysia({ prefix: '/keyword-aliases', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))

  .post(
    '/',
    async ({ prisma, authedUser, body }) => {
      const name = sanitize(body.name);
      const keyword = await prisma.keyword.findUnique({ where: { id: body.keywordId }, select: { id: true } });
      if (!keyword) notFound('Keyword');
      await assertStyleRefs(prisma, body);
      const taken = await prisma.keywordAlias.findFirst({ where: { keywordId: keyword.id, name }, select: { id: true } });
      if (taken) nameTaken();
      return prisma.keywordAlias.create({
        data: {
          ...styleData(body),
          name,
          ...languageNames(body, aliasNameColumns(name)),
          matchingType: body.matchingType ?? 'FULL',
          overrideStyle: body.overrideStyle ?? false,
          keywordId: keyword.id,
          createdById: authedUser.id,
        },
        include: styleInclude,
      });
    },
    {
      body: t.Object({
        keywordId: t.String({ format: 'uuid' }),
        name: t.String({ minLength: 1, maxLength: 300 }),
        ...aliasFields,
      }),
      response: { 200: adminAliasSchema },
      detail: { summary: 'Add an alias to a keyword' },
    },
  )

  .put(
    '/:id',
    async ({ prisma, params: { id }, body }) => {
      const existing = await prisma.keywordAlias.findUnique({ where: { id } });
      if (!existing) notFound('Alias');
      await assertStyleRefs(prisma, body);
      const name = body.name === undefined ? undefined : sanitize(body.name);
      if (name && name !== existing.name) {
        const taken = await prisma.keywordAlias.findFirst({
          where: { keywordId: existing.keywordId, name, id: { not: id } },
          select: { id: true },
        });
        if (taken) nameTaken();
      }
      return prisma.keywordAlias.update({
        where: { id },
        data: {
          ...styleData(body),
          name,
          ...languageNames(
            body,
            name && name !== existing.name
              ? aliasNameColumns(name, existing)
              : { nameAr: existing.nameAr, nameEn: existing.nameEn },
          ),
          matchingType: body.matchingType,
          overrideStyle: body.overrideStyle,
        },
        include: styleInclude,
      });
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({ name: t.Optional(t.String({ minLength: 1, maxLength: 300 })), ...aliasFields }),
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
