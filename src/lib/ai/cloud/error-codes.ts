/**
 * Error codes of the cloud AI routes, sent as HTTP errors before an action
 * starts or in the stream's `error` frame. A contract with the extension:
 * never rename one.
 */
export const AI_ERROR_CODES = [
  'AI_UNAVAILABLE',
  'AI_FEATURE_NOT_FOUND',
  'AI_FEATURE_DISABLED',
  'PROMPT_TOO_LARGE',
  'AI_RATE_LIMITED',
  'NOVEL_CONTEXT_EXISTS',
  'ACTION_NOT_RETRYABLE',
  'AI_PROVIDER_FAILED',
  'AI_TIMEOUT',
  'AI_EMPTY_OUTPUT',
  'AI_REFUSED',
  'AI_CANCELLED',
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Codes that can end a running action (sent in the stream's `error` frame). */
export type AiStreamErrorCode = Extract<
  AiErrorCode,
  'AI_PROVIDER_FAILED' | 'AI_TIMEOUT' | 'AI_EMPTY_OUTPUT' | 'AI_REFUSED' | 'AI_CANCELLED'
>;
