import { HttpError } from '@/utils/errors';

type Translate = (messages: { en: string; ar: string }) => string;

/**
 * Stale-write check for synced updates: when the stored row changed after the
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
  if (Number.isNaN(base) || existing.updatedAt.getTime() <= base) return;

  throw new HttpError({
    statusCode: 409,
    code: 'STALE_WRITE',
    message: t({
      en: 'This item changed since you edited it',
      ar: 'تغيّر هذا العنصر منذ أن عدّلته',
    }),
    details: { current: await loadCurrent() },
  });
}
