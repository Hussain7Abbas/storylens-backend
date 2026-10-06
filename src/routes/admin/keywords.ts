import type { Prisma } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { MatchingType } from '@/lib/db';
import { absorb, type AliasNameRow, mergeTranslationKeyword, takenAliasNames } from '@/lib/keywords/merge';
import { authorize } from '@/middleware/authorize';
import { adminListQuery, pageArgs } from '@/schemas/admin';
import { adminKeywordDetailSchema, keywordDetailInclude, styleBody } from '@/schemas/admin-keywords';
import { setup } from '@/setup';
import { cleanKeywordName, stripArabicDiacritics } from '@/utils/arabic';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';
import { languageSchema, nameField, scriptLanguage } from '@/utils/translation';
import { assertStyleRefs, styleData } from './keyword-styles';
import { lockKeywordVersions } from './version-ranges';

type Tx = Prisma.TransactionClient;

const keywordInclude = {
  // The base version (chapter 0 onwards) holds the description shown next to the name.
  versions: { orderBy: { startingChapter: 'asc' }, take: 1, select: { description: true } },
  aliases: { select: { nameAr: true, nameEn: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.KeywordInclude;

type KeywordRow = Prisma.KeywordGetPayload<{ include: typeof keywordInclude }>;

const adminKeywordSchema = t.Object({
  id: t.String(),
  novelId: t.String(),
  nameAr: t.Nullable(t.String()),
  nameEn: t.Nullable(t.String()),
  description: t.Nullable(t.String()),
  aliases: t.Array(t.String()),
});

function toKeyword({ versions, aliases, ...keyword }: KeywordRow) {
  return {
    id: keyword.id,
    novelId: keyword.novelId,
    nameAr: keyword.nameAr,
    nameEn: keyword.nameEn,
    description: versions[0]?.description ?? null,
    // Every name of each alias, translations included.
    aliases: [...new Set(aliases.flatMap((alias) => [alias.nameAr, alias.nameEn]))].filter(
      (name): name is string => !!name,
    ),
  };
}

function notFound(): never {
  throw new HttpError({ statusCode: 404, message: 'Keyword not found' });
}

function conflict(message: string): never {
  throw new HttpError({ statusCode: 409, message });
}

function assertSourceHasOnlyBaseVersion(source: { versions: unknown[] }) {
  if (source.versions.length > 1) {
    conflict('A keyword with later versions cannot be merged without losing its version history');
  }
}

async function loadPair(tx: Tx, id: string, targetId: string) {
  if (id === targetId) conflict('A keyword cannot be merged into itself');
  const [source, target] = await Promise.all([
    tx.keyword.findUnique({ where: { id }, include: { versions: { orderBy: { startingChapter: 'asc' } }, aliases: true } }),
    tx.keyword.findUnique({ where: { id: targetId }, include: { versions: true, aliases: true } }),
  ]);
  if (!source || !target) notFound();
  if (source.novelId !== target.novelId) conflict('Both keywords must belong to the same novel');
  return { source, target };
}

/** Adds the source keyword's names (either language) as one alias of the target. */
async function addNamesAsAliases(
  tx: Tx,
  target: {
    id: string;
    nameAr: string | null;
    nameEn: string | null;
    aliases: AliasNameRow[];
  },
  source: {
    nameAr: string | null;
    nameEn: string | null;
    matchingType: 'FULL' | 'PARTIAL';
    fuzzyMatchArabicCharacters: boolean;
    versions: { description: string | null; categoryId: string | null; natureId: string | null; imageId: string | null }[];
  },
) {
  const taken = takenAliasNames(target.aliases);
  const free = (column: 'nameAr' | 'nameEn') => {
    const name = source[column];
    return name && name !== target[column] && !taken[column].has(name) ? name : null;
  };
  const names = { nameAr: free('nameAr'), nameEn: free('nameEn') };
  if (!names.nameAr && !names.nameEn) return;
  const base = source.versions[0];
  const alias = await tx.keywordAlias.create({
    data: {
      keywordId: target.id,
      ...names,
      matchingType: source.matchingType,
      fuzzyMatchArabicCharacters: source.fuzzyMatchArabicCharacters,
      description: base?.description ?? null,
      categoryId: base?.categoryId ?? null,
      natureId: base?.natureId ?? null,
      imageId: base?.imageId ?? null,
    },
  });
  target.aliases.push(alias);
}

const pairBody = t.Object({ targetId: t.String({ format: 'uuid' }) });

export const adminKeywords = new Elysia({ prefix: '/keywords', tags: ['Admin: Keywords'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/',
    async ({ prisma, query }) => {
      // Names are stored without Arabic diacritics, so the search drops them too.
      const search = query.search === undefined ? undefined : stripArabicDiacritics(String(query.search)).trim();
      const where: Prisma.KeywordWhereInput = {
        novelId: query.novelId,
        // `missing`: keywords that still need this language's name.
        ...(query.missing ? { [nameField(query.missing)]: null } : {}),
        // `has`: keywords that already have this language's name.
        ...(query.has ? { NOT: { [nameField(query.has)]: null } } : {}),
        // `untranslated`: keywords named in exactly one language.
        ...(query.untranslated
          ? {
              AND: [
                {
                  OR: [
                    { nameAr: null, NOT: { nameEn: null } },
                    { nameEn: null, NOT: { nameAr: null } },
                  ],
                },
              ],
            }
          : {}),
        ...(search
          ? {
              OR: [
                { nameAr: { contains: search, mode: 'insensitive' } },
                { nameEn: { contains: search, mode: 'insensitive' } },
                {
                  aliases: {
                    some: {
                      OR: [
                        { nameAr: { contains: search, mode: 'insensitive' } },
                        { nameEn: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.keyword.findMany({
          where,
          include: keywordInclude,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          ...pageArgs(query),
        }),
        prisma.keyword.count({ where }),
      ]);
      return { data: rows.map(toKeyword), total };
    },
    {
      query: t.Object({
        ...adminListQuery,
        novelId: t.String({ format: 'uuid' }),
        missing: t.Optional(languageSchema),
        has: t.Optional(languageSchema),
        untranslated: t.Optional(t.BooleanString()),
      }),
      response: { 200: t.Object({ data: t.Array(adminKeywordSchema), total: t.Number() }) },
      detail: { summary: 'List a novel’s keywords, optionally by missing or present translation' },
    },
  )

  // A keyword always starts with its base version (chapter 0), which holds its details.
  .post(
    '/',
    async ({ prisma, authedUser, body, t }) => {
      const novel = await prisma.novel.findUnique({ where: { id: body.novelId }, select: { id: true } });
      if (!novel) throw new HttpError({ statusCode: 404, message: 'Novel not found' });
      const names = {
        nameAr: body.nameAr ? cleanKeywordName(sanitize(body.nameAr)) : null,
        nameEn: body.nameEn ? cleanKeywordName(sanitize(body.nameEn)) : null,
      };
      if (!names.nameAr && !names.nameEn) {
        throw new HttpError({ statusCode: 422, message: 'An Arabic or English name is required' });
      }
      await assertStyleRefs(prisma, body);
      for (const field of ['nameAr', 'nameEn'] as const) {
        const name = names[field];
        if (!name) continue;
        const taken = await prisma.keyword.findFirst({
          where: { novelId: novel.id, [field]: name },
          select: { id: true },
        });
        if (taken) conflict(`Another keyword in this novel is already named “${name}”`);
      }
      return prisma.$transaction(async (tx) => {
        const keyword = await tx.keyword.create({
          data: {
            ...names,
            matchingType: body.matchingType ?? 'FULL',
            fuzzyMatchArabicCharacters: body.fuzzyMatchArabicCharacters ?? true,
            novelId: novel.id,
            createdById: authedUser.id,
            versions: { create: { ...styleData(body), startingChapter: 0, createdById: authedUser.id } },
          },
        });
        // A translation link merges the keyword named in the other language into this one.
        const linked = body.translationKeywordId
          ? await mergeTranslationKeyword(tx, {
              target: { id: keyword.id, novelId: novel.id, nameAr: keyword.nameAr, nameEn: keyword.nameEn },
              sourceId: body.translationKeywordId,
              t,
            })
          : {};
        if (Object.keys(linked).length) {
          await tx.keyword.update({ where: { id: keyword.id }, data: linked });
        }
        return tx.keyword.findUniqueOrThrow({ where: { id: keyword.id }, include: keywordDetailInclude });
      });
    },
    {
      body: t.Object({
        novelId: t.String({ format: 'uuid' }),
        nameAr: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
        nameEn: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
        matchingType: t.Optional(MatchingType),
        fuzzyMatchArabicCharacters: t.Optional(t.Boolean()),
        // Translation link: the keyword holding this one's other-language name,
        // merged into it and deleted (`POST /:id/link` the other way round).
        translationKeywordId: t.Optional(t.String({ format: 'uuid' })),
        ...styleBody,
      }),
      response: { 200: adminKeywordDetailSchema },
      detail: { summary: 'Create a keyword with its base version' },
    },
  )

  .put(
    '/:id',
    async ({ prisma, params: { id }, body, t }) => {
      const existing = await prisma.keyword.findUnique({ where: { id } });
      if (!existing) notFound();

      const names: Record<'nameAr' | 'nameEn', string | null | undefined> = {
        nameAr: body.nameAr === undefined ? undefined : body.nameAr ? cleanKeywordName(sanitize(body.nameAr)) : null,
        nameEn: body.nameEn === undefined ? undefined : body.nameEn ? cleanKeywordName(sanitize(body.nameEn)) : null,
      };
      const nameAr = names.nameAr === undefined ? existing.nameAr : names.nameAr;
      const nameEn = names.nameEn === undefined ? existing.nameEn : names.nameEn;
      if (!nameAr && !nameEn) throw new HttpError({ statusCode: 422, message: 'An Arabic or English name is required' });

      for (const field of ['nameAr', 'nameEn'] as const) {
        const name = names[field];
        if (!name || name === existing[field]) continue;
        const taken = await prisma.keyword.findFirst({
          where: { novelId: existing.novelId, [field]: name, id: { not: id } },
          select: { id: true },
        });
        if (taken) conflict(`Another keyword in this novel is already named “${name}”`);
      }

      const keyword = await prisma.$transaction(async (tx) => {
        const linked = body.translationKeywordId
          ? await mergeTranslationKeyword(tx, {
              target: { id, novelId: existing.novelId, nameAr, nameEn },
              sourceId: body.translationKeywordId,
              t,
            })
          : {};
        return tx.keyword.update({
          where: { id },
          data: {
            ...names,
            ...linked,
            matchingType: body.matchingType,
            fuzzyMatchArabicCharacters: body.fuzzyMatchArabicCharacters,
          },
          include: keywordInclude,
        });
      });
      return toKeyword(keyword);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({
        nameAr: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
        nameEn: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
        matchingType: t.Optional(MatchingType),
        fuzzyMatchArabicCharacters: t.Optional(t.Boolean()),
        // Translation link: the keyword holding this one's other-language name,
        // merged into it and deleted (`POST /:id/link` the other way round).
        translationKeywordId: t.Optional(t.String({ format: 'uuid' })),
      }),
      response: { 200: adminKeywordSchema },
      detail: { summary: 'Set a keyword’s Arabic and English names and matching' },
    },
  )

  // Aliases and versions cascade; chapter links go first, replacements keep their text.
  .delete(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const existing = await prisma.keyword.findUnique({ where: { id }, include: keywordInclude });
      if (!existing) notFound();
      await prisma.$transaction([
        prisma.keywordsChapters.deleteMany({ where: { keywordId: id } }),
        prisma.keyword.delete({ where: { id } }),
      ]);
      return toKeyword(existing);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: { 200: adminKeywordSchema },
      detail: { summary: 'Delete a keyword with its aliases and versions' },
    },
  )

  // Link: the two keywords are the same character in different languages.
  .post(
    '/:id/link',
    async ({ prisma, params: { id }, body }) => {
      const keyword = await prisma.$transaction(async (tx) => {
        const { source, target } = await loadPair(tx, id, body.targetId);
        for (const field of ['nameAr', 'nameEn'] as const) {
          if (source[field] && target[field] && source[field] !== target[field]) {
            conflict('Both keywords already have a name in the same language');
          }
        }
        const nameAr = target.nameAr ?? source.nameAr;
        const nameEn = target.nameEn ?? source.nameEn;
        // Free the unique names before the target takes them.
        await tx.keyword.update({ where: { id: source.id }, data: { nameAr: null, nameEn: null } });
        await absorb(tx, source, target);
        return tx.keyword.update({ where: { id: target.id }, data: { nameAr, nameEn }, include: keywordInclude });
      });
      return toKeyword(keyword);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: pairBody,
      response: { 200: adminKeywordSchema },
      detail: { summary: 'Merge a keyword into its translation in the other language' },
    },
  )

  // Link to an alias: the keyword's lone name is that alias in its other language. The alias
  // takes the name, image, category and nature (see `mergeShared`), then the keyword is absorbed.
  .post(
    '/:id/link-alias',
    async ({ prisma, params: { id }, body }) => {
      const keyword = await prisma.$transaction(async (tx) => {
        // Serialize links to one alias before reading its names. Otherwise two
        // requests can both see an empty translation and the later one wins.
        await tx.$queryRaw`SELECT id FROM "KeywordAlias" WHERE id = ${body.aliasId} FOR UPDATE`;
        const [source, alias] = await Promise.all([
          tx.keyword.findUnique({
            where: { id },
            include: { versions: { orderBy: { startingChapter: 'asc' } }, aliases: true },
          }),
          tx.keywordAlias.findUnique({
            where: { id: body.aliasId },
            include: { keyword: { include: { aliases: true } } },
          }),
        ]);
        if (!source) notFound();
        if (!alias) throw new HttpError({ statusCode: 404, message: 'Alias not found' });
        if (alias.keywordId === source.id) conflict('A keyword cannot be linked to its own alias');
        if (alias.keyword.novelId !== source.novelId) conflict('Both keywords must belong to the same novel');
        assertSourceHasOnlyBaseVersion(source);
        const name = source.nameAr ?? source.nameEn;
        if (!name || (source.nameAr && source.nameEn)) {
          conflict('Only a keyword named in one language can be linked to an alias');
        }
        // Older keywords keep English names in `nameAr`, so the script decides the language.
        const language = scriptLanguage(name) ?? (source.nameAr ? 'ar' : 'en');
        const column = nameField(language);
        const current = alias[column];
        if (current && current !== name) {
          conflict(
            `The alias “${alias.nameAr ?? alias.nameEn}” already has the ${language === 'ar' ? 'Arabic' : 'English'} name “${current}”`,
          );
        }
        if (alias.keyword.aliases.some((other) => other.id !== alias.id && other[column] === name)) {
          conflict(`Another alias of this keyword is already named “${name}”`);
        }

        const base = source.versions[0];
        const sourceNewer = !!base && base.updatedAt > alias.updatedAt;
        const mergeShared = (own: string | null, other: string | null | undefined) =>
          other == null ? own : own == null || sourceNewer ? other : own;
        await tx.keywordAlias.update({
          where: { id: alias.id },
          data: {
            [column]: name,
            imageId: mergeShared(alias.imageId, base?.imageId),
            categoryId: mergeShared(alias.categoryId, base?.categoryId),
            natureId: mergeShared(alias.natureId, base?.natureId),
          },
        });
        await absorb(tx, source, alias.keyword);
        return tx.keyword.findUniqueOrThrow({ where: { id: alias.keywordId }, include: keywordInclude });
      });
      return toKeyword(keyword);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({ aliasId: t.String({ format: 'uuid' }) }),
      response: { 200: adminKeywordSchema },
      detail: {
        summary: 'Merge a keyword into an alias as that alias’s name in the other language',
      },
    },
  )

  // Alias: the keyword's names become aliases of the target character.
  .post(
    '/:id/alias',
    async ({ prisma, params: { id }, body }) => {
      const keyword = await prisma.$transaction(async (tx) => {
        const { source, target } = await loadPair(tx, id, body.targetId);
        await addNamesAsAliases(tx, target, source);
        await absorb(tx, source, target);
        return tx.keyword.findUniqueOrThrow({ where: { id: target.id }, include: keywordInclude });
      });
      return toKeyword(keyword);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: pairBody,
      response: { 200: adminKeywordSchema },
      detail: { summary: 'Turn a keyword into an alias of another keyword' },
    },
  )

  // Version: the keyword becomes a later version of the target character. Versions have no
  // name of their own, so the keyword's names are also kept as aliases to stay highlighted.
  .post(
    '/:id/version',
    async ({ prisma, params: { id }, body }) => {
      const keyword = await prisma.$transaction(async (tx) => {
        const { source, target } = await loadPair(tx, id, body.targetId);
        await lockKeywordVersions(tx, target.id);
        const targetVersions = await tx.keywordVersion.findMany({
          where: { keywordId: target.id },
          orderBy: { startingChapter: 'asc' },
        });
        const base = source.versions[0];
        const latest = targetVersions.at(-1);
        const lastStart = latest?.startingChapter ?? -1;
        const startingChapter = body.startingChapter ?? lastStart + 1;
        if (targetVersions.some((version) => version.startingChapter === startingChapter)) {
          conflict(`The target already has a version starting at chapter ${startingChapter}`);
        }
        const previous = targetVersions.filter((version) => version.startingChapter < startingChapter).at(-1);
        const next = targetVersions.find((version) => version.startingChapter > startingChapter);
        if (previous && (previous.endingChapter === null || previous.endingChapter >= startingChapter)) {
          await tx.keywordVersion.update({
            where: { id: previous.id },
            data: { endingChapter: startingChapter - 1 },
          });
        }
        await tx.keywordVersion.create({
          data: {
            keywordId: target.id,
            startingChapter,
            endingChapter: next ? next.startingChapter - 1 : null,
            description: base?.description ?? null,
            categoryId: base?.categoryId ?? null,
            natureId: base?.natureId ?? null,
            imageId: base?.imageId ?? null,
          },
        });
        await addNamesAsAliases(tx, target, source);
        await absorb(tx, source, target);
        return tx.keyword.findUniqueOrThrow({ where: { id: target.id }, include: keywordInclude });
      });
      return toKeyword(keyword);
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: t.Object({
        targetId: t.String({ format: 'uuid' }),
        startingChapter: t.Optional(t.Integer({ minimum: 0 })),
      }),
      response: { 200: adminKeywordSchema },
      detail: { summary: 'Turn a keyword into a version of another keyword' },
    },
  );
