/**
 * Error codes of the synced reader routes. They are a contract with the
 * extension's sync runner, which maps them to conflict kinds: never rename one.
 */
export const SYNC_ERROR_CODES = [
  'NOT_FOUND',
  'PARENT_NOT_FOUND',
  'NOT_OWNER',
  'STALE_WRITE',
  'ID_CONFLICT',
  'KEYWORD_NAME_TAKEN',
  'ALIAS_NAME_TAKEN',
  'REPLACEMENT_EXISTS',
  'LOOKUP_NAME_TAKEN',
  'UNIQUE_VIOLATION',
  'NAME_REQUIRED',
  'REPLACEMENT_BIDIRECTIONAL',
  'VERSION_CHAPTER_REQUIRED',
  'VERSION_NOT_AFTER_LATEST',
  'VERSION_ONLY_PROTECTED',
  'VERSION_BASE_PROTECTED',
  'CATEGORY_IN_USE',
  'NATURE_IN_USE',
  'CURSOR_EXPIRED',
] as const;

export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];
