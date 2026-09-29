import { t } from 'elysia';
import { HttpError } from '@/utils/errors';

export const LANGUAGES = ['ar', 'en'] as const;

export type Language = (typeof LANGUAGES)[number];

export const languageSchema = t.Union(LANGUAGES.map((language) => t.Literal(language)));

/** The request's language from `Accept-Language`; anything but Arabic reads English. */
export function toLanguage(acceptLanguage: string | undefined): Language {
  return acceptLanguage?.split(',')[0]?.trim().toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

export function nameField(language: Language): 'nameAr' | 'nameEn' {
  return language === 'ar' ? 'nameAr' : 'nameEn';
}

export function descriptionField(language: Language): 'descriptionAr' | 'descriptionEn' {
  return language === 'ar' ? 'descriptionAr' : 'descriptionEn';
}

/** Body fields for a translated name pair; each language is optional but one is required. */
export const translatedNameBody = {
  nameAr: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  nameEn: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
};

export const translatedDescriptionBody = {
  descriptionAr: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  descriptionEn: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
};

type Translate = (messages: { en: string; ar: string }) => string;

export function assertHasName(
  names: { nameAr?: string | null; nameEn?: string | null },
  translate: Translate,
): void {
  if (!names.nameAr?.trim() && !names.nameEn?.trim()) {
    throw new HttpError({
      statusCode: 422,
      message: translate({
        en: 'An Arabic or English name is required',
        ar: 'الاسم العربي أو الإنجليزي مطلوب',
      }),
    });
  }
}

const ARABIC_LETTER = /(?=\p{L})\p{Script=Arabic}/u;
const LATIN_LETTER = /(?=\p{L})\p{Script=Latin}/u;

/** The language a name is written in, from its script; null when it has no letters. */
export function scriptLanguage(text: string): Language | null {
  if (ARABIC_LETTER.test(text)) return 'ar';
  if (LATIN_LETTER.test(text)) return 'en';
  return null;
}

type AliasNames = { name: string; nameAr?: string | null; nameEn?: string | null };

/**
 * An alias's name in each language. Aliases added before `nameAr`/`nameEn` existed
 * (or by clients that only send `name`) have neither, so `name` fills its script's language.
 */
export function aliasNames(alias: AliasNames): Record<Language, string | null> {
  const names: Record<Language, string | null> = { ar: alias.nameAr || null, en: alias.nameEn || null };
  const language = scriptLanguage(alias.name);
  if (language && !names[language] && !Object.values(names).includes(alias.name)) names[language] = alias.name;
  return names;
}

/**
 * Language columns for an alias saved with `name`: the name's script column takes it,
 * and a column that held the previous name (a rename) follows it or is cleared.
 */
export function aliasNameColumns(
  name: string,
  previous?: AliasNames,
): { nameAr: string | null; nameEn: string | null } {
  const names = previous ? aliasNames(previous) : { ar: null, en: null };
  for (const language of LANGUAGES) {
    if (previous && names[language] === previous.name) names[language] = null;
  }
  const language = scriptLanguage(name);
  if (language) names[language] = name;
  return { nameAr: names.ar, nameEn: names.en };
}

/** Display name for logs, prompts and fallbacks when either translation may be missing. */
export function anyName(item: { nameAr?: string | null; nameEn?: string | null }): string {
  return item.nameAr ?? item.nameEn ?? '';
}
