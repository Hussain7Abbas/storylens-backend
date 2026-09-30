import type { KeywordCategory, KeywordNature } from '@prisma/client';
import { HttpError } from '@/utils/errors';

type Translate = (messages: { en: string; ar: string }) => string;
type Lookup = KeywordCategory | KeywordNature;
export type LookupNames = { nameAr?: string | null; nameEn?: string | null };

/** Empty or blank names are stored as null, so they never collide. */
export function cleanLookupName(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value?.trim() || null;
}

/** The provided non-empty names, as `OR` filters for the per-language uniqueness check. */
export function lookupNameFilters(names: LookupNames): ({ nameAr: string } | { nameEn: string })[] {
  return [
    ...(names.nameAr ? [{ nameAr: names.nameAr }] : []),
    ...(names.nameEn ? [{ nameEn: names.nameEn }] : []),
  ];
}

export function lookupNameTaken(message: string): HttpError {
  return new HttpError({ statusCode: 409, code: 'LOOKUP_NAME_TAKEN', message });
}

/**
 * Categories and natures have no creator, so a moderator's replay (same `id`)
 * returns the existing row only when its names and color match what was sent.
 */
export function isLookupReplay(
  row: Lookup,
  body: LookupNames & { color: string },
): boolean {
  return (
    (row.nameAr ?? null) === (cleanLookupName(body.nameAr) ?? null) &&
    (row.nameEn ?? null) === (cleanLookupName(body.nameEn) ?? null) &&
    row.color.toLowerCase() === body.color.toLowerCase()
  );
}

export function assertLookupHasName(names: LookupNames, t: Translate): void {
  if (!names.nameAr && !names.nameEn) {
    throw new HttpError({
      statusCode: 422,
      code: 'NAME_REQUIRED',
      message: t({ en: 'An Arabic or English name is required', ar: 'الاسم العربي أو الإنجليزي مطلوب' }),
    });
  }
}
