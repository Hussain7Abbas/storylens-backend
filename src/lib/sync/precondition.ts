import { Prisma } from '@prisma/client';
import { HttpError } from '@/utils/errors';

type Translate = (messages: { en: string; ar: string }) => string;

/**
 * Stale-write check for synced updates: when the stored revision differs from
 * `baseUpdatedAt` the client edited from, answer 409 `STALE_WRITE` with the
 * current row (in the route's 200 shape) so the client can merge. Compares at
 * millisecond precision, the precision of Prisma `DateTime` (`timestamp(3)`).
 * Run it after the 404 and ownership checks and before rule checks.
 */
export async function assertNotStale(
  existing: { updatedAt: Date },
  baseUpdatedAt: string,
  loadCurrent: () => Promise<unknown>,
  t: Translate,
): Promise<void> {
  const base = Date.parse(baseUpdatedAt);
  if (!Number.isNaN(base) && existing.updatedAt.getTime() === base) return;

  throw await staleWrite(loadCurrent, t);
}

async function staleWrite(loadCurrent: () => Promise<unknown>, t: Translate): Promise<HttpError> {

  return new HttpError({
    statusCode: 409,
    code: 'STALE_WRITE',
    message: t({
      en: 'This item changed since you edited it',
      ar: 'تغيّر هذا العنصر منذ أن عدّلته',
    }),
    details: { current: await loadCurrent() },
  });
}

/**
 * The pre-read above allows rule checks. The database update must also compare
 * the old revision, since another writer can commit between that read and the
 * update. PostgreSQL rechecks this predicate after waiting for a row lock.
 */
export async function compareAndSwap<T>(
  update: () => Promise<T>,
  loadCurrent: () => Promise<unknown>,
  t: Translate,
): Promise<T> {
  try {
    return await update();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2025') throw error;
    throw await staleWrite(loadCurrent, t);
  }
}
