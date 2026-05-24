export {
  createOpenRouterClient,
  DEFAULT_OPENROUTER_MODEL,
  resolveOpenRouterModel,
} from './client';
export type { OpenRouterClientOptions } from './client';

export { detectChapterSelectors } from './agents/chapter-selector-agent';
export type {
  ChapterSelectorAgentOptions,
  ChapterSelectorAgentOutput,
} from './agents/chapter-selector-agent';

export {
  chapterSelectorAgentInputSchema,
  chapterSelectorAgentResultSchema,
  nodeSelectorFormValuesSchema,
  novelFormAutofillSchema,
  selectorFieldSchema,
  selectorSourceSchema,
  toNodeSelectorFormValues,
  toNovelFormValues,
  websiteSelectorSchema,
} from './schemas/chapter-selector';
export type {
  ChapterSelectorAgentInput,
  ChapterSelectorAgentResult,
  NodeSelectorFormValues,
  NovelFormAutofill,
  SelectorField,
  SelectorSource,
  WebsiteSelector,
} from './schemas/chapter-selector';

export {
  extractPageContextForAgent,
  getHostnameFromUrl,
  prepareHtmlForAgent,
} from './utils/html';
export { validateWebsiteSelectors } from './utils/validate-selectors';
export type { SelectorValidation } from './utils/validate-selectors';
