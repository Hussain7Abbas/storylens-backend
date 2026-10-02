import { type AiAction, type AiFeaturePrice, Prisma, type PrismaClient } from '@prisma/client';
import { applyLensChange } from '@/lib/billing/ledger';
import { usdToDecimal } from '@/lib/billing/money';
import { HttpError } from '@/utils/errors';
import type { AiUsage, DataPolicy } from '../provider';

/**
 * Charging for cloud AI (decision D5). An action is charged once when its first
 * attempt starts, and refunded once if that attempt delivers nothing. A second
 * attempt (language correction, unreadable answer) is free and allowed only
 * after a success. Every provider request is an `AiCall` row, without content.
 */

/** Text features get a free second attempt; images do not. */
export function maxAttempts(feature: string): number {
  return feature === 'character_image' ? 1 : 2;
}

export type StartedAction = { action: AiAction; balance: number; lensesCharged: number };

async function balanceOf(prisma: Prisma.TransactionClient | PrismaClient, userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lensBalance: true } });
  return user.lensBalance;
}

function idConflict(): never {
  throw new HttpError({ statusCode: 409, code: 'ID_CONFLICT', message: 'This action ID is already used' });
}

function notRetryable(reason: 'running' | 'failed' | 'limit'): never {
  throw new HttpError({
    statusCode: 409,
    code: 'ACTION_NOT_RETRYABLE',
    message: 'This AI action cannot be tried again; start a new one',
    details: { reason },
  });
}

/** Records the action and charges for it (attempt 1), or claims a free retry (attempt 2). */
export async function startAction(
  prisma: PrismaClient,
  input: { userId: string; price: AiFeaturePrice; actionId: string; attempt: 1 | 2; novelId?: string | null },
): Promise<StartedAction> {
  const { userId, price, actionId } = input;

  if (input.attempt === 2) {
    const action = await prisma.aiAction.findUnique({ where: { id: actionId } });
    if (!action || action.userId !== userId || action.feature !== price.key) idConflict();
    if (maxAttempts(price.key) < 2) notRetryable('limit');
    const { count } = await prisma.aiAction.updateMany({
      where: { id: actionId, status: 'SUCCEEDED', attempts: { lt: maxAttempts(price.key) } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) notRetryable(action.status === 'RUNNING' ? 'running' : action.status === 'FAILED' ? 'failed' : 'limit');
    return { action, balance: await balanceOf(prisma, userId), lensesCharged: 0 };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const action = await tx.aiAction.create({
        data: { id: actionId, userId, feature: price.key, lensesCharged: price.lenses, novelId: input.novelId ?? null },
      });
      if (price.lenses === 0) return { action, balance: await balanceOf(tx, userId), lensesCharged: 0 };
      // Not enough lenses throws INSUFFICIENT_LENSES and rolls the action back.
      const charged = await applyLensChange(tx, {
        userId,
        delta: -price.lenses,
        type: 'AI_CHARGE',
        idempotencyKey: `ai-charge:${actionId}`,
        aiActionId: actionId,
        aiFeature: price.key,
      });
      return { action, balance: charged.balance, lensesCharged: price.lenses };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') idConflict();
    throw error;
  }
}

export type CallRecord = {
  attempt: number;
  step: 'main' | 'brief';
  model: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  errorCode?: string;
  usage: AiUsage;
  durationMs: number;
  providerId?: string;
  dataPolicy?: DataPolicy;
};

export async function recordCall(
  prisma: Prisma.TransactionClient | PrismaClient,
  actionId: string,
  call: CallRecord,
): Promise<void> {
  await prisma.aiCall.create({
    data: {
      actionId,
      attempt: call.attempt,
      step: call.step,
      model: call.model,
      status: call.status,
      errorCode: call.errorCode ?? null,
      inputTokens: call.usage.inputTokens ?? null,
      outputTokens: call.usage.outputTokens ?? null,
      reasoningTokens: call.usage.reasoningTokens ?? null,
      costUsd: call.usage.costUsd === undefined ? null : usdToDecimal(call.usage.costUsd),
      durationMs: Math.round(call.durationMs),
      providerId: call.providerId ?? null,
      dataPolicy: call.dataPolicy ?? null,
    },
  });
}

/** The attempt delivered: attempt 1 marks the action succeeded. */
export async function succeedAttempt(
  prisma: PrismaClient,
  actionId: string,
  attempt: number,
  calls: CallRecord[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const call of calls) await recordCall(tx, actionId, call);
    if (attempt === 1) {
      await tx.aiAction.updateMany({ where: { id: actionId, status: 'RUNNING' }, data: { status: 'SUCCEEDED' } });
    } else {
      await tx.aiAction.update({ where: { id: actionId }, data: { updatedAt: new Date() } });
    }
  });
}

/**
 * The attempt delivered nothing. A failed first attempt fails the action and
 * refunds its lenses; a failed second attempt refunds nothing (the first one
 * delivered). Returns whether lenses came back and the balance now.
 */
export async function failAttempt(
  prisma: PrismaClient,
  input: { actionId: string; userId: string; attempt: number; calls: CallRecord[] },
): Promise<{ refunded: boolean; balance: number }> {
  return prisma.$transaction(async (tx) => {
    for (const call of input.calls) await recordCall(tx, input.actionId, call);
    const refunded = input.attempt === 1 ? await failAndRefund(tx, input.actionId) : false;
    return { refunded, balance: await balanceOf(tx, input.userId) };
  });
}

/** Moves a running action to FAILED and refunds it once. */
async function failAndRefund(tx: Prisma.TransactionClient, actionId: string): Promise<boolean> {
  const { count } = await tx.aiAction.updateMany({
    where: { id: actionId, status: 'RUNNING' },
    data: { status: 'FAILED' },
  });
  if (count === 0) return false;
  const action = await tx.aiAction.findUniqueOrThrow({ where: { id: actionId } });
  if (action.lensesCharged === 0) return false;
  await applyLensChange(tx, {
    userId: action.userId,
    delta: action.lensesCharged,
    type: 'AI_REFUND',
    idempotencyKey: `ai-refund:${actionId}`,
    aiActionId: actionId,
    aiFeature: action.feature,
  });
  await tx.aiAction.update({ where: { id: actionId }, data: { refunded: true } });
  return true;
}

/** Refunds actions left RUNNING by a restart (the cron runs every 5 minutes). */
export async function sweepStuckActions(prisma: PrismaClient, olderThanMs = 15 * 60 * 1000): Promise<number> {
  const stuck = await prisma.aiAction.findMany({
    where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - olderThanMs) } },
    select: { id: true },
    take: 200,
  });
  let swept = 0;
  for (const { id } of stuck) {
    if (await prisma.$transaction((tx) => failAndRefund(tx, id))) swept++;
  }
  return swept;
}

/** Usage rows are kept 400 days; ledger rows keep their feature label. */
export async function pruneAiUsage(prisma: PrismaClient, olderThanDays = 400): Promise<number> {
  const { count } = await prisma.aiAction.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000) }, status: { not: 'RUNNING' } },
  });
  return count;
}
