import { Prisma } from '@prisma/client';
import { HttpError } from '@/utils/errors';

type Translate = (messages: { en: string; ar: string }) => string;

function idConflict(t: Translate): HttpError {
  return new HttpError({
    statusCode: 409,
    code: 'ID_CONFLICT',
    message: t({
      en: 'This ID is already used by another item',
      ar: 'هذا المعرّف مستخدم لعنصر آخر',
    }),
  });
}

/**
 * Client-ID replay for synced creates. A create that reached the server but
 * whose response was lost is sent again with the same `id`: when that row
 * exists and `matches` (same creator and parent), the route returns it as is
 * and skips every side effect; any other row with the ID is `ID_CONFLICT`.
 * Returns null when the ID is new. Run it before duplicate and rule checks.
 */
export async function findReplay<T>(
  find: () => Promise<T | null>,
  matches: (row: T) => boolean,
  t: Translate,
): Promise<T | null> {
  const existing = await find();
  if (!existing) return null;
  if (matches(existing)) return existing;
  throw idConflict(t);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Runs a synced create; when an identical replay created the same `id` in the
 * meantime (two sends at once), returns that row instead of failing. Postgres
 * may report the replay on the ID or on another unique column (a name), so any
 * unique violation reads the ID again; a violation without that row is real.
 */
export async function createWithReplay<T>(
  create: () => Promise<T>,
  find: () => Promise<T | null>,
  matches: (row: T) => boolean,
  t: Translate,
): Promise<T> {
  try {
    return await create();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const replayed = await find();
    if (!replayed) throw error;
    if (matches(replayed)) return replayed;
    throw idConflict(t);
  }
}
