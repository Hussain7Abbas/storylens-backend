import type { AiFeaturePrice, PrismaClient } from '@prisma/client';
import { env } from '@/env';
import type { BillingConfig } from '@/lib/billing/config';
import { MICROS_PER_USD } from '@/lib/billing/money';
import { HttpError } from '@/utils/errors';
import { aiProviderConfigured } from '../provider';

/**
 * Checks before a cloud AI action is charged. Each failure is a plain HTTP
 * error with a code, so nothing is charged and nothing streams.
 */

export type Modality = 'text' | 'image';

export function modalityOf(feature: string): Modality {
  return feature === 'character_image' ? 'image' : 'text';
}

export function assertCloudAvailable(config: BillingConfig): void {
  if (!config.cloudAiEnabled) {
    throw new HttpError({
      statusCode: 503,
      code: 'AI_UNAVAILABLE',
      message: 'Story Lens Cloud AI is turned off',
      details: { reason: 'disabled' },
    });
  }
  if (!aiProviderConfigured(Boolean(env.OPENROUTER_API_KEY))) {
    throw new HttpError({
      statusCode: 503,
      code: 'AI_UNAVAILABLE',
      message: 'Story Lens Cloud AI is not configured',
      details: { reason: 'not-configured' },
    });
  }
}

/** The pricing record of an enabled feature served by this route. */
export async function featureFor(prisma: PrismaClient, key: string, modality: Modality): Promise<AiFeaturePrice> {
  const price = await prisma.aiFeaturePrice.findUnique({ where: { key } });
  if (!price || modalityOf(key) !== modality) {
    throw new HttpError({ statusCode: 404, code: 'AI_FEATURE_NOT_FOUND', message: 'Unknown AI feature' });
  }
  if (!price.enabled) {
    throw new HttpError({
      statusCode: 503,
      code: 'AI_FEATURE_DISABLED',
      message: 'This AI feature is turned off',
      details: { feature: key },
    });
  }
  return price;
}

export function assertPromptSize(price: AiFeaturePrice, prompt: string): void {
  if (prompt.length > price.maxPromptChars) {
    throw new HttpError({
      statusCode: 413,
      code: 'PROMPT_TOO_LARGE',
      message: `This request is too long for Story Lens Cloud (${price.maxPromptChars} characters)`,
      details: { maxChars: price.maxPromptChars },
    });
  }
}

/** Research runs only for a novel whose context is still empty. */
export async function assertNovelNeedsContext(prisma: PrismaClient, novelId: string | undefined): Promise<void> {
  if (!novelId) throw new HttpError({ statusCode: 422, message: 'novelId is required for novel_context' });
  const novel = await prisma.novel.findUnique({ where: { id: novelId }, select: { context: true } });
  if (!novel) throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Novel not found' });
  if (novel.context?.trim()) {
    throw new HttpError({
      statusCode: 409,
      code: 'NOVEL_CONTEXT_EXISTS',
      message: 'This novel already has a context',
    });
  }
}

const TEN_MINUTES = 10 * 60 * 1000;
const RUNNING_WINDOW = 15 * 60 * 1000;

/** Per-reader limits (decision D16), counted in the database. */
export async function assertReaderLimits(prisma: PrismaClient, userId: string, config: BillingConfig): Promise<void> {
  const now = Date.now();
  const [running, recent] = await Promise.all([
    prisma.aiAction.count({
      where: { userId, status: 'RUNNING', updatedAt: { gte: new Date(now - RUNNING_WINDOW) } },
    }),
    prisma.aiAction.findMany({
      where: { userId, createdAt: { gte: new Date(now - TEN_MINUTES) } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
      take: config.readerMaxPer10Min,
    }),
  ]);
  const limited = (retryAfterSeconds: number): never => {
    throw new HttpError({
      statusCode: 429,
      code: 'AI_RATE_LIMITED',
      message: 'Too many AI requests at once. Please wait a moment.',
      details: { retryAfterSeconds },
    });
  };
  if (running >= config.readerMaxRunning) limited(10);
  if (recent.length >= config.readerMaxPer10Min) {
    const oldest = recent[0]?.createdAt.getTime() ?? now;
    limited(Math.max(1, Math.ceil((oldest + TEN_MINUTES - now) / 1000)));
  }
}

/** Today's (UTC) recorded provider spend, in micro-dollars. */
export async function spentTodayMicros(prisma: PrismaClient): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const total = await prisma.aiCall.aggregate({ where: { createdAt: { gte: start } }, _sum: { costUsd: true } });
  return Math.round(Number(total._sum.costUsd ?? 0) * MICROS_PER_USD);
}

/** The optional daily cap (empty by default, D16). Returns true the first time it trips today. */
export async function assertUnderSpendCap(prisma: PrismaClient, config: BillingConfig): Promise<void> {
  if (config.dailySpendCapMicros === null) return;
  if ((await spentTodayMicros(prisma)) < config.dailySpendCapMicros) return;
  throw new HttpError({
    statusCode: 503,
    code: 'AI_UNAVAILABLE',
    message: 'Story Lens Cloud AI reached its daily limit. Try again tomorrow.',
    details: { reason: 'spend-cap' },
  });
}
