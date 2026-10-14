import { descriptionField, type Language, scriptLanguage } from '@/utils/translation';

export type DescriptionInput = {
  description?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
};

/** Additive writes: each translated field is independent; retain the legacy shared value. */
export function descriptionData(body: DescriptionInput, language: Language = 'en'): DescriptionInput {
  const result: DescriptionInput = {
    ...(body.descriptionAr === undefined ? {} : { descriptionAr: body.descriptionAr }),
    ...(body.descriptionEn === undefined ? {} : { descriptionEn: body.descriptionEn }),
  };
  if (body.description !== undefined) {
    result.description = body.description;
    // Older clients have only a shared field. Infer its script when possible.
    const field = descriptionField(body.description ? scriptLanguage(body.description) ?? language : language);
    if (result[field] === undefined) result[field] = body.description;
  } else {
    const current = body[descriptionField(language)];
    const other = body[descriptionField(language === 'ar' ? 'en' : 'ar')];
    if (current !== undefined || other !== undefined) result.description = current !== undefined ? current : other;
  }
  return result;
}
