import { t } from 'elysia';
import { deprecate } from '@/lib/compat/deprecation';

// Ordinary chapter lists never expose context payloads or private reservation tokens.
export const chapterPublicSelect = {
  id: true,
  name: true,
  number: true,
  novelId: true,
  imageId: true,
  createdAt: true,
  updatedAt: true,
} as const;
export const PublicChapter = t.Object(
  {
    id: t.String(),
    name: t.String(),
    number: t.Integer(),
    novelId: t.String(),
    imageId: t.Nullable(t.String()),
    createdAt: t.Date(),
    updatedAt: t.Date(),
    description: t.Optional(
      deprecate(t.Nullable(t.String()), {
        since: '2026-10-17',
        removeAfter: '2027-04-30',
        replacement: 'Chapter context.summary',
      }),
    ),
  },
  { additionalProperties: false },
);
export function legacyChapterContext(summary: string) {
  return { schemaVersion: 1 as const, summary, scenes: [], stateChanges: [] };
}
