import type { SyncErrorCode } from '@/lib/sync/error-codes';

export class HttpError extends Error {
  statusCode: number;
  /**
   * Machine-readable reason, sent as `code`; clients map it without reading the
   * localized message. Not named `code` here: Elysia reads an error's `code` as its error type.
   */
  errorCode?: SyncErrorCode;
  /** Extra response fields, such as the current row of a stale write. */
  details?: Record<string, unknown>;

  constructor({
    statusCode = 400,
    message = 'Bad Request',
    code,
    details,
  }: { statusCode?: number; message?: string; code?: SyncErrorCode; details?: Record<string, unknown> }) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = code;
    this.details = details;
  }
}

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
  }
}
