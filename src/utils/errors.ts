import type { AiErrorCode } from '@/lib/ai/cloud/error-codes';
import type { BillingErrorCode } from '@/lib/billing/error-codes';
import type { SyncErrorCode } from '@/lib/sync/error-codes';

/** Every machine-readable code the API sends; each list is a client contract. */
export type ApiErrorCode = SyncErrorCode | BillingErrorCode | AiErrorCode;

export class HttpError extends Error {
  statusCode: number;
  /**
   * Machine-readable reason, sent as `code`; clients map it without reading the
   * localized message. Not named `code` here: Elysia reads an error's `code` as its error type.
   */
  errorCode?: ApiErrorCode;
  /** Extra response fields, such as the current row of a stale write. */
  details?: Record<string, unknown>;

  constructor({
    statusCode = 400,
    message = 'Bad Request',
    code,
    details,
  }: { statusCode?: number; message?: string; code?: ApiErrorCode; details?: Record<string, unknown> }) {
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
