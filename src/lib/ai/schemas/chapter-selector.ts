import { z } from 'zod';

export const selectorFieldSchema = z.object({
  value: z.string(),
  regex: z.string(),
});

export const selectorSourceSchema = z.object({
  xpath: selectorFieldSchema.nullable(),
  url: selectorFieldSchema.nullable(),
});

export const websiteSelectorSchema = z.object({
  website: z.string().min(1),
  novel: selectorSourceSchema,
  chapter: selectorSourceSchema,
});

export const novelFormAutofillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  slugs: z.array(z.string().min(1)).min(1),
});

export const chapterSelectorAgentResultSchema = z.object({
  website: z.string().min(1),
  selectors: websiteSelectorSchema,
  novelForm: novelFormAutofillSchema,
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().optional(),
});

export const nodeSelectorFormValuesSchema = z.object({
  website: z.string(),
  novelXpath: z.string(),
  novelXpathRegex: z.string(),
  novelUrlRegex: z.string(),
  chapterXpath: z.string(),
  chapterXpathRegex: z.string(),
  chapterUrlRegex: z.string(),
});

export const chapterSelectorAgentInputSchema = z.object({
  url: z.string().url(),
  html: z.string().min(1),
  model: z.string().optional(),
});

export type SelectorField = z.infer<typeof selectorFieldSchema>;
export type SelectorSource = z.infer<typeof selectorSourceSchema>;
export type WebsiteSelector = z.infer<typeof websiteSelectorSchema>;
export type NovelFormAutofill = z.infer<typeof novelFormAutofillSchema>;
export type ChapterSelectorAgentResult = z.infer<
  typeof chapterSelectorAgentResultSchema
>;
export type NodeSelectorFormValues = z.infer<typeof nodeSelectorFormValuesSchema>;
export type ChapterSelectorAgentInput = z.infer<
  typeof chapterSelectorAgentInputSchema
>;

export function toNodeSelectorFormValues(
  result: ChapterSelectorAgentResult,
  _sampleUrl: string,
): NodeSelectorFormValues {
  return {
    website: result.website,
    novelXpath: result.selectors.novel.xpath?.value ?? '',
    novelXpathRegex: result.selectors.novel.xpath?.regex ?? '(.*)',
    novelUrlRegex: result.selectors.novel.url?.regex ?? '/novel/([^/]+)/',
    chapterXpath: result.selectors.chapter.xpath?.value ?? '',
    chapterXpathRegex: result.selectors.chapter.xpath?.regex ?? '\\d+',
    chapterUrlRegex: result.selectors.chapter.url?.regex ?? '(\\d+)(?!.*\\d)',
  };
}

export function toNovelFormValues(result: ChapterSelectorAgentResult) {
  return {
    name: result.novelForm.name,
    description: result.novelForm.description ?? '',
    slugs: result.novelForm.slugs,
  };
}
