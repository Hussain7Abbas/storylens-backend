/**
 * Error codes of the billing routes (lenses, requests, gifts). Like the sync
 * codes they are a contract with the website, dashboard and extension: never
 * rename one.
 */
export const BILLING_ERROR_CODES = [
  'BILLING_UNAVAILABLE',
  'REGISTERED_ACCOUNT_REQUIRED',
  'LENS_AMOUNT_OUT_OF_RANGE',
  'PRICE_CHANGED',
  'TOO_MANY_PENDING_REQUESTS',
  'REQUEST_RATE_LIMITED',
  'REQUEST_NOT_PENDING',
  'REQUEST_USER_DELETED',
  'CONTACT_INVALID',
  'GUEST_ACCOUNT',
  'NOT_A_READER',
  'BALANCE_TOO_LOW',
  'INSUFFICIENT_LENSES',
  'INVALID_CONFIG_VALUE',
  'WEB_ORIGIN_REQUIRED',
] as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number];
