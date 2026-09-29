import type { TSchema } from 'elysia';

/**
 * A deprecated route or field. `removeAfter` is the date support may end: the
 * API advertises it as `Sunset`, and `test/deprecations.test.ts` fails once it
 * passes so the removal cannot be forgotten.
 */
export type Deprecation = {
  /** Date it was deprecated, `YYYY-MM-DD`. */
  since: string;
  /** Last date it must keep working, `YYYY-MM-DD`. */
  removeAfter: string;
  /** What callers should use instead, such as `GET /api/user/novels/search`. */
  replacement?: string;
  /** Migration notes or tracking issue. */
  link?: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a `YYYY-MM-DD` date as UTC midnight; throws on anything else. */
export function parseDeprecationDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (!DATE_PATTERN.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid deprecation date "${value}", expected YYYY-MM-DD`);
  }
  return date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `removeAfter` still works all day, so it ends at the next UTC midnight. */
export function endOfDay(date: Date): Date {
  return new Date(date.getTime() + DAY_MS);
}

/** One-line human summary used in OpenAPI descriptions and logs. */
export function describeDeprecation({ since, removeAfter, replacement }: Deprecation): string {
  const use = replacement ? ` Use ${replacement} instead.` : '';
  return `Deprecated since ${since}; removed after ${removeAfter}.${use}`;
}

/**
 * Response headers for a deprecated route: `Deprecation` (RFC 9745),
 * `Sunset` (RFC 8594) and, with a link, `Link; rel="deprecation"`.
 */
export function deprecationHeaders(deprecation: Deprecation): Record<string, string> {
  const since = parseDeprecationDate(deprecation.since);
  const sunset = parseDeprecationDate(deprecation.removeAfter);
  if (sunset <= since) {
    throw new Error(`Deprecation removeAfter ${deprecation.removeAfter} must be after since ${deprecation.since}`);
  }

  return {
    deprecation: `@${Math.floor(since.getTime() / 1000)}`,
    sunset: endOfDay(sunset).toUTCString(),
    ...(deprecation.link ? { link: `<${deprecation.link}>; rel="deprecation"` } : {}),
  };
}

/**
 * Marks a request or response schema field deprecated in OpenAPI (Orval turns it
 * into `@deprecated` in generated clients). Use this instead of a bare
 * `deprecated: true`, so the field carries a removal date.
 */
export function deprecate<T extends TSchema>(schema: T, deprecation: Deprecation): T {
  deprecationHeaders(deprecation);
  const note = describeDeprecation(deprecation);
  return {
    ...schema,
    deprecated: true,
    description: schema.description ? `${schema.description} ${note}` : note,
  };
}

const USAGE_LOG_INTERVAL_MS = 60 * 60 * 1000;
// Keys include the caller's version header, so bound the memory they can use.
const USAGE_LOG_MAX_KEYS = 1000;
const lastUsageLog = new Map<string, number>();

/**
 * Whether a compatibility event (deprecated-route hit, refused outdated client)
 * should be logged: once per key per hour, enough to see who still depends on
 * old behavior without flooding the logs.
 */
export function shouldLogHourly(key: string, now = Date.now()): boolean {
  const last = lastUsageLog.get(key);
  if (last !== undefined && now - last < USAGE_LOG_INTERVAL_MS) return false;
  if (lastUsageLog.size >= USAGE_LOG_MAX_KEYS) lastUsageLog.clear();
  lastUsageLog.set(key, now);
  return true;
}
