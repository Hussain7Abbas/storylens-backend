import { type LensTransaction, type LensTransactionType, Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '@/utils/errors';

/**
 * The lens ledger. `lensBalance` changes only here, always with one
 * `LensTransaction` row whose unique `idempotencyKey` makes the change
 * exactly-once. A conditional update keeps balances from going negative under
 * concurrency (a CHECK constraint backs it up).
 */

export type LensChange = {
  userId: string;
  /** Signed change in whole lenses; never 0. */
  delta: number;
  type: LensTransactionType;
  idempotencyKey: string;
  note?: string | null;
  billingRequestId?: string | null;
  aiActionId?: string | null;
  aiFeature?: string | null;
  createdById?: string | null;
};

export type AppliedLensChange = {
  transaction: LensTransaction;
  /** The user's balance after the change (the current one for a replay). */
  balance: number;
  /** True when the key was already used: nothing changed. */
  replayed: boolean;
};

type Tx = Prisma.TransactionClient;

async function currentBalance(tx: Tx, userId: string): Promise<number | null> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { lensBalance: true } });
  return user?.lensBalance ?? null;
}

/**
 * Applies one balance change inside the caller's transaction. A debit that would
 * go below zero throws `INSUFFICIENT_LENSES` (402) for AI charges and
 * `BALANCE_TOO_LOW` (409) otherwise, and writes nothing.
 */
export async function applyLensChange(tx: Tx, change: LensChange): Promise<AppliedLensChange> {
  if (!Number.isSafeInteger(change.delta) || change.delta === 0) {
    throw new Error(`Invalid lens change ${change.delta} for ${change.idempotencyKey}`);
  }

  const existing = await tx.lensTransaction.findUnique({ where: { idempotencyKey: change.idempotencyKey } });
  if (existing) {
    return { transaction: existing, balance: (await currentBalance(tx, existing.userId)) ?? 0, replayed: true };
  }

  const rows = await tx.$queryRaw<Array<{ lensBalance: number }>>`
    UPDATE "User" SET "lensBalance" = "lensBalance" + ${change.delta}
    WHERE "id" = ${change.userId} AND "lensBalance" + ${change.delta} >= 0
    RETURNING "lensBalance"`;

  const updated = rows[0];
  if (!updated) {
    const balance = await currentBalance(tx, change.userId);
    if (balance === null) throw new HttpError({ statusCode: 404, message: 'User not found', code: 'NOT_FOUND' });
    if (change.type === 'AI_CHARGE') {
      throw new HttpError({
        statusCode: 402,
        message: 'Not enough lenses',
        code: 'INSUFFICIENT_LENSES',
        details: { required: -change.delta, balance, ...(change.aiFeature ? { feature: change.aiFeature } : {}) },
      });
    }
    throw new HttpError({
      statusCode: 409,
      message: 'The balance cannot go below zero',
      code: 'BALANCE_TOO_LOW',
      details: { balance },
    });
  }

  const balance = updated.lensBalance;
  const transaction = await tx.lensTransaction.create({
    data: {
      userId: change.userId,
      type: change.type,
      delta: change.delta,
      balanceAfter: balance,
      idempotencyKey: change.idempotencyKey,
      note: change.note ?? null,
      billingRequestId: change.billingRequestId ?? null,
      aiActionId: change.aiActionId ?? null,
      aiFeature: change.aiFeature ?? null,
      createdById: change.createdById ?? null,
    },
  });
  return { transaction, balance, replayed: false };
}

function isIdempotencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('idempotencyKey') : String(target ?? '').includes('idempotencyKey');
}

/**
 * Runs `applyLensChange` (and optional related writes) in its own transaction.
 * Two identical changes racing each other: the loser's transaction rolls back on
 * the unique key and it returns the winner's row as a replay.
 */
export async function withLensChange(
  prisma: PrismaClient,
  change: LensChange,
  work?: (tx: Tx, applied: AppliedLensChange) => Promise<void>,
): Promise<AppliedLensChange> {
  try {
    return await prisma.$transaction(async (tx) => {
      const applied = await applyLensChange(tx, change);
      if (!applied.replayed) await work?.(tx, applied);
      return applied;
    });
  } catch (error) {
    if (!isIdempotencyConflict(error)) throw error;
    const transaction = await prisma.lensTransaction.findUniqueOrThrow({
      where: { idempotencyKey: change.idempotencyKey },
    });
    const user = await prisma.user.findUnique({ where: { id: transaction.userId }, select: { lensBalance: true } });
    return { transaction, balance: user?.lensBalance ?? 0, replayed: true };
  }
}

export type BalanceMismatch = { userId: string; balance: number; ledger: number };

/** Users whose `lensBalance` differs from the sum of their ledger rows. */
export async function auditBalances(prisma: PrismaClient, userIds?: string[]): Promise<BalanceMismatch[]> {
  const filter = userIds?.length ? Prisma.sql`WHERE u."id" IN (${Prisma.join(userIds)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ userId: string; balance: number; ledger: bigint }>>`
    SELECT u."id" AS "userId", u."lensBalance" AS "balance", COALESCE(SUM(t."delta"), 0) AS "ledger"
    FROM "User" u LEFT JOIN "LensTransaction" t ON t."userId" = u."id"
    ${filter}
    GROUP BY u."id", u."lensBalance"
    HAVING u."lensBalance" <> COALESCE(SUM(t."delta"), 0)`;
  return rows.map((row) => ({ userId: row.userId, balance: row.balance, ledger: Number(row.ledger) }));
}
