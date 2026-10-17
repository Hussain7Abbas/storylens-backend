import type { Prisma } from '@prisma/client';
import { HttpError } from '@/utils/errors';

export const LENS_INVENTORY_KEY = 'AI_Lens_Balance';
export const MAX_LENS_INVENTORY = 999_999_999;

export function parseLensInventory(value: string | undefined): number {
  return value !== undefined && /^\d{1,9}$/.test(value.trim()) ? Number(value.trim()) : 0;
}

/** Config edits, deletion and deductions share a lock, including when the row is absent. */
export async function lockLensInventory(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('storylens:AI_Lens_Balance'))`;
}

/** Call after the reader ledger write in the SAME transaction; replays must skip this. */
export async function deductLensInventory(tx: Prisma.TransactionClient, lenses: number): Promise<void> {
  if (!Number.isSafeInteger(lenses) || lenses <= 0) throw new Error('Invalid inventory deduction');
  await lockLensInventory(tx);
  const row = await tx.config.findUnique({ where: { key: LENS_INVENTORY_KEY } });
  const balance = parseLensInventory(row?.value);
  if (balance < lenses) throw new HttpError({
    statusCode: 409, code: 'AI_LENS_BALANCE_TOO_LOW',
    message: `Only ${balance} lenses are available to sell or gift. Update the balance in Settings → AI.`,
    details: { balance, required: lenses },
  });
  await tx.config.update({ where: { key: LENS_INVENTORY_KEY }, data: { value: String(balance - lenses), updatedAt: new Date(Math.max(Date.now(), (row?.updatedAt.getTime() ?? 0) + 1)) } });
}
