import type { Prisma } from '@prisma/client';
import { getBillingConfig } from './config';
import { applyLensChange } from './ledger';

export type TrialGift = { lenses: number };

/**
 * Gives a newly registered reader the trial lenses (`Lens_Trial_Gift`) once,
 * inside the caller's transaction. With 0 it does nothing, so no celebration
 * appears. Never call it for guests or dashboard-created accounts.
 */
export async function grantTrialGift(tx: Prisma.TransactionClient, userId: string): Promise<TrialGift | null> {
  const { trialLenses } = await getBillingConfig(tx);
  if (trialLenses <= 0) return null;
  const applied = await applyLensChange(tx, {
    userId,
    delta: trialLenses,
    type: 'TRIAL_GIFT',
    idempotencyKey: `trial:${userId}`,
  });
  return applied.replayed ? null : { lenses: trialLenses };
}
