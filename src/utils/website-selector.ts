import type { WebsiteSelector } from '@prisma/client';
import { t } from 'elysia';

const xpathSchema = t.Object({
  value: t.String({ minLength: 1 }),
  regex: t.String({ minLength: 1 }),
});

const urlSchema = t.Object({
  regex: t.String({ minLength: 1 }),
});

const selectorSectionSchema = t.Object({
  xpath: t.Nullable(xpathSchema),
  url: t.Nullable(urlSchema),
});

export const websiteSelectorResponseSchema = t.Object({
  id: t.String(),
  website: t.String(),
  novel: selectorSectionSchema,
  chapter: selectorSectionSchema,
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const websiteSelectorBodySchema = t.Object({
  website: t.String({ minLength: 1 }),
  novel: selectorSectionSchema,
  chapter: selectorSectionSchema,
});

export function serializeWebsiteSelector(selector: WebsiteSelector) {
  return {
    id: selector.id,
    website: selector.website,
    novel: {
      xpath:
        selector.novelXpathValue && selector.novelXpathRegex
          ? {
              value: selector.novelXpathValue,
              regex: selector.novelXpathRegex,
            }
          : null,
      url: selector.novelUrlRegex ? { regex: selector.novelUrlRegex } : null,
    },
    chapter: {
      xpath:
        selector.chapterXpathValue && selector.chapterXpathRegex
          ? {
              value: selector.chapterXpathValue,
              regex: selector.chapterXpathRegex,
            }
          : null,
      url: selector.chapterUrlRegex
        ? { regex: selector.chapterUrlRegex }
        : null,
    },
    createdAt: selector.createdAt,
    updatedAt: selector.updatedAt,
  };
}
