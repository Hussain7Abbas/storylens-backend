import { IMAGE_DESCRIPTION_OUTPUT, parseImageDescription } from '@/lib/ai/image-description';
import type { ReasoningEffort, ImageQuality } from '@/lib/ai/generation-settings';
import type { AiFeaturePrice, PrismaClient } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { env } from '@/env';
import { type CallRecord, failAttempt, startAction, succeedAttempt } from '@/lib/ai/cloud/actions';
import type { AiStreamErrorCode } from '@/lib/ai/cloud/error-codes';
import {
  assertCloudAvailable,
  assertNovelNeedsContext,
  assertPromptSize,
  assertReaderLimits,
  assertUnderSpendCap,
  featureFor,
} from '@/lib/ai/cloud/limits';
import { type Frame, ndjsonResponse, wantsStream } from '@/lib/ai/cloud/stream';
import { IMAGE_BRIEF_RULES, CHAPTER_COVER_BRIEF_RULES, systemRules } from '@/lib/ai/cloud/system-rules';
import { setCreditsExhaustedHandler } from '@/lib/ai/openrouter-provider';
import { AiProviderError, type AiUsage, getAiProvider } from '@/lib/ai/provider';
import type { AuthUserPayload } from '@/lib/auth/session';
import { type BillingConfig, getBillingConfig } from '@/lib/billing/config';
import { prisma as db } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

/** Novel research reads this many web results (Exa, $0.007 a request). */
const RESEARCH_RESULTS = 5;

/** JSON mode (tests and scripts) maps stream codes to statuses. */
const STREAM_STATUS: Record<AiStreamErrorCode, number> = {
  AI_PROVIDER_FAILED: 502,
  AI_EMPTY_OUTPUT: 502,
  AI_TIMEOUT: 504,
  AI_REFUSED: 422,
  AI_CANCELLED: 499,
};

async function emailOwner(subject: string, text: string): Promise<void> {
  const config = await getBillingConfig(db);
  const to = config.notifyEmail ?? env.DASHBOARD_ADMIN_EMAIL;
  if (!to) return;
  await sendEmail({ to, subject, text, html: `<p>${text}</p>` });
}

setCreditsExhaustedHandler(() => {
  void emailOwner(
    'Story Lens Cloud AI: OpenRouter credits are used up',
    'OpenRouter refused a cloud AI request because the key has no credits left. Readers are being refunded. Add credits or turn AI_Cloud_Enabled off.',
  ).catch(() => undefined);
});

let capAlertDay = '';

/** Every check that runs before charging; failures charge nothing. */
async function precheck(
  prisma: PrismaClient,
  user: AuthUserPayload,
  config: BillingConfig,
  input: { feature: string; prompt: string; novelId?: string },
  modality: 'text' | 'image',
): Promise<AiFeaturePrice> {
  if (user.isGuest) {
    throw new HttpError({
      statusCode: 403,
      code: 'REGISTERED_ACCOUNT_REQUIRED',
      message: 'Create a free account to use Story Lens Cloud AI',
    });
  }
  assertCloudAvailable(config);
  const price = await featureFor(prisma, input.feature, modality);
  assertPromptSize(price, input.prompt);
  if (price.key === 'novel_context') await assertNovelNeedsContext(prisma, input.novelId);
  await assertReaderLimits(prisma, user.id, config);
  try {
    await assertUnderSpendCap(prisma, config);
  } catch (error) {
    const today = new Date().toISOString().slice(0, 10);
    if (capAlertDay !== today) {
      capAlertDay = today;
      void emailOwner(
        'Story Lens Cloud AI reached its daily spending cap',
        'Cloud AI is paused until midnight UTC. Raise or clear AI_Daily_Spend_Cap_USD in Configs to resume sooner.',
      ).catch(() => undefined);
    }
    throw error;
  }
  return price;
}

type Outcome =
  | { ok: true; frame: Frame }
  | { ok: false; code: AiStreamErrorCode; message: string; refunded: boolean; balance: number };

function failureOf(error: unknown): { code: AiStreamErrorCode; message: string; usage: AiUsage } {
  if (error instanceof AiProviderError) return { code: error.code, message: error.message, usage: error.usage };
  console.error('[ai] provider call failed', error);
  return { code: 'AI_PROVIDER_FAILED', message: 'The AI request failed', usage: {} };
}

const callStatus = (code: AiStreamErrorCode): CallRecord['status'] => (code === 'AI_CANCELLED' ? 'cancelled' : 'failed');

function logAttempt(feature: string, status: string, durationMs: number, usage: AiUsage): void {
  console.log(
    `AI ${feature} ${status} ${Math.round(durationMs)}ms in=${usage.inputTokens ?? '?'} out=${usage.outputTokens ?? '?'} cost=${usage.costUsd ?? '?'}`,
  );
}

/** Runs a text action and settles it. Never throws: failures are refunded and returned. */
async function runText(
  prisma: PrismaClient,
  input: { user: AuthUserPayload; price: AiFeaturePrice; model: string; reasoningEffort: ReasoningEffort; reasoningTokenAllowance: number; actionId: string; attempt: number; prompt: string; language: 'en' | 'ar'; signal: AbortSignal },
  balance: number,
  lensesCharged: number,
): Promise<Outcome> {
  const started = performance.now();
  const { price, model } = input;
  try {
    const result = await getAiProvider().chat({
      model,
      system: systemRules(price.key, input.language),
      prompt: input.prompt,
      maxTokens: price.maxOutputTokens,
      reasoningEffort: input.reasoningEffort,
      reasoningTokenAllowance: input.reasoningTokenAllowance,
      ...(price.key === 'novel_context' ? { webSearch: { maxResults: RESEARCH_RESULTS } } : {}),
      userId: input.user.id,
      signal: input.signal,
    });
    const durationMs = performance.now() - started;
    await succeedAttempt(prisma, input.actionId, input.attempt, [
      { attempt: input.attempt, step: 'main', model, status: 'succeeded', usage: result.usage, durationMs, providerId: result.providerId, dataPolicy: result.dataPolicy },
    ]);
    logAttempt(price.key, 'succeeded', durationMs, result.usage);
    return {
      ok: true,
      frame: { type: 'result', output: result.text, model, attempt: input.attempt, lensesCharged, balance },
    };
  } catch (error) {
    const durationMs = performance.now() - started;
    const failure = failureOf(error);
    const settled = await failAttempt(prisma, {
      actionId: input.actionId,
      userId: input.user.id,
      attempt: input.attempt,
      calls: [{ attempt: input.attempt, step: 'main', model, status: callStatus(failure.code), errorCode: failure.code, usage: failure.usage, durationMs }],
    });
    logAttempt(price.key, failure.code, durationMs, failure.usage);
    return { ok: false, code: failure.code, message: failure.message, ...settled };
  }
}

/** Synthesize a visual brief when needed, then draw it. Never throws. */
async function runImage(
  prisma: PrismaClient,
  input: { user: AuthUserPayload; price: AiFeaturePrice; textModel: string; imageModel: string; reasoningEffort: ReasoningEffort; reasoningTokenAllowance: number; imageQuality: ImageQuality; actionId: string; prompt: string; promptIsDescription?: boolean; referenceImageUrls?: string[]; signal: AbortSignal },
  balance: number,
  lensesCharged: number,
): Promise<Outcome> {
  const { price } = input;
  // Every image, including regeneration, resolves a validated description first.
  const briefModel = input.textModel;
  const calls: CallRecord[] = [];
  let started = performance.now();
  let step: CallRecord['step'] = 'brief';
  let model = briefModel;
  try {
    const availableReferences = input.referenceImageUrls ?? [];
    const brief = await getAiProvider().chat({
      model: briefModel,
      system: `${price.key === 'chapter_cover' ? CHAPTER_COVER_BRIEF_RULES : IMAGE_BRIEF_RULES}\n\n${IMAGE_DESCRIPTION_OUTPUT}`,
      prompt: JSON.stringify({ source: input.prompt, availableReferenceImageUrls: availableReferences }),
      maxTokens: price.maxOutputTokens,
      reasoningEffort: input.reasoningEffort,
      reasoningTokenAllowance: input.reasoningTokenAllowance,
      userId: input.user.id,
      signal: input.signal,
    });
    let description: ReturnType<typeof parseImageDescription>;
    try { description = parseImageDescription(brief.text, availableReferences); }
    catch { throw new AiProviderError('AI_PROVIDER_FAILED', 'Text AI returned an invalid image description or reference selection.', brief.usage); }
    calls.push({ attempt: 1, step, model, status: 'succeeded', usage: brief.usage, durationMs: performance.now() - started, providerId: brief.providerId, dataPolicy: brief.dataPolicy });

    started = performance.now();
    step = 'main';
    model = input.imageModel;
    const image = await getAiProvider().image({
      model: input.imageModel,
      prompt: description.imageDescription,
      aspectRatio: price.key === 'chapter_cover' ? '16:9' : '1:1',
      referenceImageUrls: description.referenceImageUrls,
      format: 'jpeg',
      quality: input.imageQuality,
      userId: input.user.id,
      signal: input.signal,
    });
    const durationMs = performance.now() - started;
    calls.push({ attempt: 1, step, model, status: 'succeeded', usage: image.usage, durationMs, providerId: image.providerId, dataPolicy: image.dataPolicy });
    await succeedAttempt(prisma, input.actionId, 1, calls);
    logAttempt(price.key, 'succeeded', durationMs, image.usage);
    return {
      ok: true,
      frame: {
        type: 'result',
        mimeType: image.mimeType,
        data: image.base64,
        imageDescription: description.imageDescription,
        revisedPrompt: description.imageDescription,
        model: input.imageModel,
        attempt: 1,
        lensesCharged,
        balance,
      },
    };
  } catch (error) {
    const durationMs = performance.now() - started;
    const failure = failureOf(error);
    calls.push({ attempt: 1, step, model, status: callStatus(failure.code), errorCode: failure.code, usage: failure.usage, durationMs });
    const settled = await failAttempt(prisma, { actionId: input.actionId, userId: input.user.id, attempt: 1, calls });
    logAttempt(price.key, failure.code, durationMs, failure.usage);
    return { ok: false, code: failure.code, message: failure.message, ...settled };
  }
}

/** Streams the action (NDJSON) or, for tests and scripts, answers JSON when it ends. */
function respond(
  accept: string | null | undefined,
  started: { actionId: string; attempt: number; lensesCharged: number; balance: number },
  run: () => Promise<Outcome>,
): Response | Promise<Record<string, unknown>> {
  if (wantsStream(accept)) {
    return ndjsonResponse(async (send) => {
      send({ type: 'started', ...started });
      const outcome = await run();
      if (outcome.ok) send(outcome.frame);
      else {
        send({
          type: 'error',
          error: { code: outcome.code, message: outcome.message },
          refunded: outcome.refunded,
          balance: outcome.balance,
        });
      }
    });
  }
  return run().then((outcome) => {
    if (outcome.ok) {
      const { type: _type, ...result } = outcome.frame;
      return { actionId: started.actionId, ...result };
    }
    throw new HttpError({
      statusCode: STREAM_STATUS[outcome.code],
      code: outcome.code,
      message: outcome.message,
      details: { refunded: outcome.refunded, balance: outcome.balance },
    });
  });
}

/**
 * Story Lens Cloud AI, mounted at `/api/user/ai`: the extension's prompts run on
 * OpenRouter and are paid with lenses. Prompts, answers and images are never
 * stored or logged.
 */
export const aiCloud = new Elysia({ prefix: '/ai', tags: ['AI'] })
  .use(setup)
  .use(authorize('user'))

  .post(
    '/prompts',
    async ({ prisma, authedUser, body, request }) => {
      const config = await getBillingConfig(prisma);
      const price = await precheck(prisma, authedUser, config, body, 'text');
      const started = await startAction(prisma, {
        userId: authedUser.id,
        price,
        actionId: body.actionId,
        attempt: body.attempt,
        novelId: body.novelId ?? null,
      });
      return respond(
        request.headers.get('accept'),
        { actionId: body.actionId, attempt: body.attempt, lensesCharged: started.lensesCharged, balance: started.balance },
        () =>
          runText(
            prisma,
            {
              user: authedUser,
              price,
              model: config.textModel,
              reasoningEffort: config.reasoningEffort,
              reasoningTokenAllowance: config.reasoningTokenAllowance,
              actionId: body.actionId,
              attempt: body.attempt,
              prompt: body.prompt,
              language: body.responseLanguage,
              signal: request.signal,
            },
            started.balance,
            started.lensesCharged,
          ),
      );
    },
    {
      body: t.Object({
        actionId: t.String({ format: 'uuid' }),
        attempt: t.Union([t.Literal(1), t.Literal(2)]),
        feature: t.String({ maxLength: 64 }),
        prompt: t.String({ minLength: 1, maxLength: 400_000 }),
        responseLanguage: t.Union([t.Literal('en'), t.Literal('ar')]),
        novelId: t.Optional(t.String({ format: 'uuid' })),
      }),
      detail: {
        summary: 'Run a Story Lens Cloud AI text action',
        description:
          'Streams NDJSON frames (`started`, `heartbeat`, then `result` with `output` or `error` with `code`, `refunded` and `balance`) when `Accept: application/x-ndjson`; otherwise answers JSON when done.',
      },
    },
  )

  .post(
    '/images',
    async ({ prisma, authedUser, body, request }) => {
      const config = await getBillingConfig(prisma);
      const price = await precheck(prisma, authedUser, config, body, 'image');
      const started = await startAction(prisma, { userId: authedUser.id, price, actionId: body.actionId, attempt: 1 });
      return respond(
        request.headers.get('accept'),
        { actionId: body.actionId, attempt: 1, lensesCharged: started.lensesCharged, balance: started.balance },
        () =>
          runImage(
            prisma,
            { user: authedUser, price, textModel: config.textModel, imageModel: config.imageModel, reasoningEffort: config.reasoningEffort, reasoningTokenAllowance: config.reasoningTokenAllowance, imageQuality: config.imageQuality, actionId: body.actionId, prompt: body.prompt, promptIsDescription: body.promptIsDescription, referenceImageUrls: body.referenceImageUrls, signal: request.signal },
            started.balance,
            started.lensesCharged,
          ),
      );
    },
    {
      body: t.Object({
        actionId: t.String({ format: 'uuid' }),
        feature: t.Union([t.Literal('character_image'), t.Literal('chapter_cover')]),
        promptIsDescription: t.Optional(t.Boolean()),
        referenceImageUrls: t.Optional(t.Array(t.String({ pattern: '^https?://[^\\s]+$', maxLength: 2048 }), { maxItems: 8 })),
        prompt: t.String({ minLength: 1, maxLength: 400_000 }),
      }),
      detail: {
        summary: 'Draw a character image or chapter cover with Story Lens Cloud AI',
        description:
          'Streams NDJSON frames like `/ai/prompts`; the `result` frame carries `mimeType`, base64 `data` and `revisedPrompt`.',
      },
    },
  );
