import { t } from 'elysia';
import { AI_INSTRUCTION_MAX_LENGTH } from '@/lib/ai/instructions';

export const aiInstructionsSchema = t.Object({
  keywordPrompt: t.String({ maxLength: AI_INSTRUCTION_MAX_LENGTH }),
  imagePrompt: t.String({ maxLength: AI_INSTRUCTION_MAX_LENGTH }),
  chapterCoverPrompt: t.String({ maxLength: AI_INSTRUCTION_MAX_LENGTH }),
  chapterContextPrompt: t.String({ maxLength: AI_INSTRUCTION_MAX_LENGTH }),
  pageSummaryPrompt: t.String({ maxLength: AI_INSTRUCTION_MAX_LENGTH }),
});
export const adminAiInstructionsSchema = t.Object({
  prompts: aiInstructionsSchema,
  defaults: aiInstructionsSchema,
  revisions: t.Object({
    keywordPrompt: t.Nullable(t.String({ format: 'date-time' })),
    imagePrompt: t.Nullable(t.String({ format: 'date-time' })),
    chapterCoverPrompt: t.Nullable(t.String({ format: 'date-time' })),
    chapterContextPrompt: t.Nullable(t.String({ format: 'date-time' })),
    pageSummaryPrompt: t.Nullable(t.String({ format: 'date-time' })),
  }),
  maxLength: t.Number(),
});
