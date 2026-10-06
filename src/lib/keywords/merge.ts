import type { Prisma } from '@prisma/client';
import { HttpError } from '@/utils/errors';

type Tx = Prisma.TransactionClient;

type Translate = (messages: { en: string; ar: string }) => string;

export type AliasNameRow = { id: string; nameAr: string | null; nameEn: string | null };

export const NAME_COLUMNS = ['nameAr', 'nameEn'] as const;

export type NameColumn = (typeof NAME_COLUMNS)[number];

/** Names already used by `aliases` in each language (the per-keyword unique constraints). */
export function takenAliasNames(aliases: AliasNameRow[]) {
  return {
    nameAr: new Set(aliases.flatMap((alias) => (alias.nameAr ? [alias.nameAr] : []))),
    nameEn: new Set(aliases.flatMap((alias) => (alias.nameEn ? [alias.nameEn] : []))),
  };
}

/**
 * Moves what hangs off `source` (aliases, chapter links, replacements) onto
 * `target`, then deletes `source`. An alias that shares a name in one language
 * with a target alias fills the target alias's missing translation when the two
 * agree; otherwise it moves with only the names the target does not have yet.
 */
export async function absorb(
  tx: Tx,
  source: { id: string; aliases: AliasNameRow[] },
  target: { id: string; aliases: AliasNameRow[] },
) {
  for (const alias of source.aliases) {
    const taken = takenAliasNames(target.aliases);
    const existing = target.aliases.find((other) =>
      NAME_COLUMNS.some((column) => alias[column] && other[column] === alias[column]),
    );
    const compatible =
      existing && NAME_COLUMNS.every((column) => !alias[column] || !existing[column] || alias[column] === existing[column]);

    if (existing && compatible) {
      const names = {
        nameAr: existing.nameAr ?? (alias.nameAr && !taken.nameAr.has(alias.nameAr) ? alias.nameAr : null),
        nameEn: existing.nameEn ?? (alias.nameEn && !taken.nameEn.has(alias.nameEn) ? alias.nameEn : null),
      };
      if (names.nameAr !== existing.nameAr || names.nameEn !== existing.nameEn) {
        await tx.keywordAlias.update({ where: { id: existing.id }, data: names });
        Object.assign(existing, names);
      }
      continue;
    }

    const names = {
      nameAr: alias.nameAr && !taken.nameAr.has(alias.nameAr) ? alias.nameAr : null,
      nameEn: alias.nameEn && !taken.nameEn.has(alias.nameEn) ? alias.nameEn : null,
    };
    if (!names.nameAr && !names.nameEn) continue;
    await tx.keywordAlias.update({ where: { id: alias.id }, data: { keywordId: target.id, ...names } });
    target.aliases.push({ ...alias, ...names });
  }
  await tx.keywordsChapters.updateMany({ where: { keywordId: source.id }, data: { keywordId: target.id } });
  await tx.replacement.updateMany({ where: { keywordId: source.id }, data: { keywordId: target.id } });
  await tx.keyword.delete({ where: { id: source.id } });
}

// ---------------------------------------------------------------------------
// Translation links
// ---------------------------------------------------------------------------

/**
 * Codes of the refusals a translation link can hit. They are a contract with the
 * extension, whose `rules/validation.ts` mirrors every one of them locally, and
 * with the dashboard's forms; never rename one.
 */
export type TranslationLinkCode =
  | 'TRANSLATION_SELF'
  | 'TRANSLATION_OTHER_NOVEL'
  | 'TRANSLATION_OTHER_KEYWORD'
  | 'TRANSLATION_SAME_LANGUAGE'
  | 'TRANSLATION_HAS_VERSIONS';

function refuse(code: TranslationLinkCode, t: Translate): never {
  const messages: Record<TranslationLinkCode, { en: string; ar: string }> = {
    TRANSLATION_SELF: {
      en: 'An item cannot be the translation of itself',
      ar: 'لا يمكن أن يكون العنصر ترجمةً لنفسه',
    },
    TRANSLATION_OTHER_NOVEL: {
      en: 'Both keywords must belong to the same novel',
      ar: 'يجب أن تكون الكلمتان المفتاحيتان في الرواية نفسها',
    },
    TRANSLATION_OTHER_KEYWORD: {
      en: 'Both aliases must belong to the same keyword',
      ar: 'يجب أن يكون الاسمان المستعاران للكلمة المفتاحية نفسها',
    },
    TRANSLATION_SAME_LANGUAGE: {
      en: 'Both items are already named in the same language',
      ar: 'العنصران مسمّيان بالفعل باللغة نفسها',
    },
    TRANSLATION_HAS_VERSIONS: {
      en: 'A keyword with later versions cannot be linked without losing its version history',
      ar: 'لا يمكن ربط كلمة مفتاحية لها إصدارات لاحقة دون فقدان سجل إصداراتها',
    },
  };
  throw new HttpError({ statusCode: 409, code, message: t(messages[code]) });
}

type NamedRow = { nameAr: string | null; nameEn: string | null };

/** The source's names for the languages `target` has no name in yet. */
function missingNames(target: NamedRow, source: NamedRow, t: Translate): Partial<NamedRow> {
  const names: Partial<NamedRow> = {};
  for (const column of NAME_COLUMNS) {
    if (!source[column]) continue;
    if (!target[column]) {
      names[column] = source[column];
      continue;
    }
    // Two different names in one language mean these are not one entity.
    if (target[column] !== source[column]) refuse('TRANSLATION_SAME_LANGUAGE', t);
  }
  return names;
}

/**
 * Merges the keyword that holds a keyword's other-language name into it: the
 * surviving `target` takes the names `source` has and it lacks, `source`'s
 * aliases, chapter links and replacements move onto it, and `source` is deleted.
 * A `source` that no longer exists is ignored, so a replayed write (a lost
 * response sent again) succeeds instead of failing on the row it already merged.
 * Style (category, nature, image, description) is not copied: the caller's form
 * sends the values it filled in from the translation. Run inside the same
 * transaction as the target's own write, before it, so the names it takes are
 * free of the unique constraints.
 */
export async function mergeTranslationKeyword(
  tx: Tx,
  {
    target,
    sourceId,
    t,
    assertMayAbsorb,
  }: {
      /** The surviving keyword. */
    target: { id: string; novelId: string; nameAr: string | null; nameEn: string | null };
    sourceId: string;
    t: Translate;
    /** Reader routes check that the caller may delete the absorbed keyword. */
    assertMayAbsorb?: (source: { createdById: string | null }) => void;
  },
): Promise<Partial<NamedRow>> {
  if (sourceId === target.id) refuse('TRANSLATION_SELF', t);
  const source = await tx.keyword.findUnique({
    where: { id: sourceId },
    include: { aliases: true, versions: { select: { id: true } } },
  });
  if (!source) return {};
  if (source.novelId !== target.novelId) refuse('TRANSLATION_OTHER_NOVEL', t);
  // The absorbed keyword's versions cascade with it, so only a base version may go.
  if (source.versions.length > 1) refuse('TRANSLATION_HAS_VERSIONS', t);
  assertMayAbsorb?.(source);

  const names = missingNames(target, source, t);
  // Free the unique names before the target takes them.
  await tx.keyword.update({ where: { id: source.id }, data: { nameAr: null, nameEn: null } });
  await absorb(tx, source, { id: target.id, aliases: await tx.keywordAlias.findMany({ where: { keywordId: target.id } }) });
  return names;
}

/**
 * Merges the alias that holds an alias's other-language name into it: the
 * surviving `target` takes the names `source` has and it lacks, and `source` is
 * deleted. Both aliases must belong to one keyword, so no alias ever moves
 * between keywords; link the keywords themselves for that. A `source` that no
 * longer exists is ignored, as in `mergeTranslationKeyword`.
 */
export async function mergeTranslationAlias(
  tx: Tx,
  {
    target,
    sourceId,
    t,
    assertMayAbsorb,
  }: {
    /** The surviving alias; `id` is absent while it is still being created. */
    target: { id?: string; keywordId: string; nameAr: string | null; nameEn: string | null };
    sourceId: string;
    t: Translate;
    assertMayAbsorb?: (source: { createdById: string | null }) => void;
  },
): Promise<Partial<NamedRow>> {
  if (sourceId === target.id) refuse('TRANSLATION_SELF', t);
  const source = await tx.keywordAlias.findUnique({ where: { id: sourceId } });
  if (!source) return {};
  if (source.keywordId !== target.keywordId) refuse('TRANSLATION_OTHER_KEYWORD', t);
  assertMayAbsorb?.(source);

  const names = missingNames(target, source, t);
  await tx.keywordAlias.delete({ where: { id: source.id } });
  return names;
}
