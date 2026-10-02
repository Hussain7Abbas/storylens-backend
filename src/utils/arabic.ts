/**
 * Arabic diacritics (حركات) that never change which word is written: tanween,
 * the short vowels, shadda, sukun, the dagger alif, Quranic annotation marks
 * and tatweel. The hamza and madda marks (U+0653–U+0655) stay because they
 * form letters (أ إ آ ؤ ئ). Keep this set identical to the extension's
 * `src/utils/arabic.ts` and the `arabic_diacritics` migration.
 */
const ARABIC_DIACRITICS = /[\u{0640}\u{064B}-\u{0652}\u{0656}-\u{065F}\u{0670}\u{06D6}-\u{06DC}\u{06DF}-\u{06E4}\u{06E7}\u{06E8}\u{06EA}-\u{06ED}]/gu;

/** Keyword and alias names are stored without diacritics; pages match by letters only. */
export function stripArabicDiacritics(value: string): string {
  return value.normalize('NFC').replace(ARABIC_DIACRITICS, '').normalize('NFC');
}

/** A keyword or alias name as stored: trimmed and without diacritics; null when nothing is left. */
export function cleanKeywordName(value: string): string | null {
  return stripArabicDiacritics(value.trim()).trim() || null;
}
