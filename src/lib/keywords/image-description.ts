import { t } from 'elysia';
import { deprecate } from '@/lib/compat/deprecation';

export const imageDescriptionFields = {
  imageDescription: t.Optional(t.Nullable(t.String({ maxLength: 180000 }))),
  imagePrompt: t.Optional(deprecate(t.Nullable(t.String({ maxLength: 180000 })), {
    since: '2026-10-24', removeAfter: '2027-04-30', replacement: 'imageDescription',
  })),
};

/** New spelling wins even when explicitly null; older clients remain writable. */
export function imageDescriptionValue(input: { imageDescription?: string | null; imagePrompt?: string | null }) {
  return input.imageDescription !== undefined ? input.imageDescription : input.imagePrompt;
}
