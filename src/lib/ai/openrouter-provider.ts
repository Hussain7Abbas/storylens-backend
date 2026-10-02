import { z } from 'zod';
import { env } from '@/env';
import {
  type AiProvider,
  AiProviderError,
  type AiUsage,
  type ChatInput,
  type ChatResult,
  type DataPolicy,
  type ImageInput,
  type ImageResult,
  registerAiProviderFactory,
} from './provider';

/**
 * OpenRouter's REST API for cloud AI. Plain `fetch` rather than the SDK: the SDK
 * has no images client and drops request fields it does not know.
 *
 * Every request prefers providers that do not keep or train on data
 * (`data_collection: "deny"`). When a model has no such provider, the call is
 * repeated once without the restriction and reported as `dataPolicy: "allow"`
 * (owner decision D18; the privacy policy discloses it).
 */

const API = 'https://openrouter.ai/api/v1';
const CHAT_TIMEOUT_MS = 120_000;
const RESEARCH_TIMEOUT_MS = 150_000;
const IMAGE_TIMEOUT_MS = 180_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const usageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
    cost: z.number().nullish(),
  })
  .nullish();

const chatResponseSchema = z.object({
  id: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({ content: z.union([z.string(), z.null()]).optional() }).optional(),
        error: z.object({ message: z.string().optional() }).nullish(),
      }),
    )
    .default([]),
  usage: usageSchema,
});

const imageResponseSchema = z.object({
  id: z.string().optional(),
  data: z.array(z.object({ b64_json: z.string().optional(), media_type: z.string().optional() })).default([]),
  usage: usageSchema,
});

const errorSchema = z.object({
  error: z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).optional(),
});

function toUsage(usage: z.infer<typeof usageSchema>): AiUsage {
  return {
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? undefined,
    costUsd: usage?.cost ?? undefined,
  };
}

const dataPolicyWarned = new Map<string, number>();

function warnFallback(model: string): void {
  const last = dataPolicyWarned.get(model) ?? 0;
  if (Date.now() - last < 60 * 60 * 1000) return;
  dataPolicyWarned.set(model, Date.now());
  console.warn(`AI_DATA_POLICY_FALLBACK ${model}: no provider matched data_collection=deny; used any provider`);
}

let creditsAlerted = 0;
let onCreditsExhausted: (() => void) | null = null;

/** Called (at most hourly) when OpenRouter reports that the owner's credits are used up. */
export function setCreditsExhaustedHandler(handler: () => void): void {
  onCreditsExhausted = handler;
}

/** Times out with `AI_TIMEOUT`; the caller's abort becomes `AI_CANCELLED`. */
function withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(ms);
  return { signal: AbortSignal.any([signal, timeout]), timedOut: () => timeout.aborted };
}

type Attempt = { response: Response; dataPolicy: DataPolicy };

/** POSTs with `data_collection: "deny"`, then once without it when no provider matches (D18). */
async function post(path: string, body: Record<string, unknown>, model: string, signal: AbortSignal): Promise<Attempt> {
  const send = (dataPolicy: DataPolicy) =>
    fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
        'X-Title': 'Story Lens',
        'HTTP-Referer': env.WEBSITE_URL,
      },
      body: JSON.stringify({ ...body, provider: { data_collection: dataPolicy } }),
      signal,
    });

  const response = await send('deny');
  if (response.status !== 404) return { response, dataPolicy: 'deny' };
  const text = await response.text();
  if (!/data polic/i.test(text)) return { response: new Response(text, { status: 404 }), dataPolicy: 'deny' };
  warnFallback(model);
  return { response: await send('allow'), dataPolicy: 'allow' };
}

async function failure(response: Response): Promise<AiProviderError> {
  const text = await response.text().catch(() => '');
  let message = text.slice(0, 300);
  try {
    message = errorSchema.parse(JSON.parse(text)).error?.message ?? message;
  } catch {
    // Not JSON; keep the text.
  }
  if (response.status === 402) {
    if (Date.now() - creditsAlerted > 60 * 60 * 1000) {
      creditsAlerted = Date.now();
      console.error('OPENROUTER_CREDITS_EXHAUSTED: the OpenRouter key has no credits left');
      onCreditsExhausted?.();
    }
    return new AiProviderError('AI_PROVIDER_FAILED', 'The AI provider is not available right now');
  }
  if (response.status === 403 || /moderat|flagged|safety|content polic/i.test(message)) {
    return new AiProviderError('AI_REFUSED', 'The AI provider refused this request');
  }
  if (response.status === 408 || response.status === 504) {
    return new AiProviderError('AI_TIMEOUT', 'The AI provider took too long');
  }
  return new AiProviderError('AI_PROVIDER_FAILED', `The AI provider failed (${response.status}): ${message}`);
}

function aborted(error: unknown, timedOut: () => boolean): AiProviderError | null {
  if (!(error instanceof Error) || (error.name !== 'AbortError' && error.name !== 'TimeoutError')) return null;
  return timedOut()
    ? new AiProviderError('AI_TIMEOUT', 'The AI provider took too long')
    : new AiProviderError('AI_CANCELLED', 'The request was cancelled');
}

async function chat(input: ChatInput): Promise<ChatResult> {
  const { signal, timedOut } = withTimeout(input.signal, input.webSearch ? RESEARCH_TIMEOUT_MS : CHAT_TIMEOUT_MS);
  try {
    const { response, dataPolicy } = await post(
      '/chat/completions',
      {
        model: input.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
        max_tokens: input.maxTokens,
        // Gemini 2.5 Flash bills thinking as output; these features do not need it.
        reasoning: { effort: 'none', exclude: true },
        usage: { include: true },
        user: input.userId,
        ...(input.webSearch ? { plugins: [{ id: 'web', engine: 'exa', max_results: input.webSearch.maxResults }] } : {}),
      },
      input.model,
      signal,
    );
    if (!response.ok) throw await failure(response);
    const parsed = chatResponseSchema.parse(await response.json());
    const usage = toUsage(parsed.usage);
    const choice = parsed.choices[0];
    if (choice?.error) throw new AiProviderError('AI_PROVIDER_FAILED', choice.error.message ?? 'The AI provider failed', usage);
    if (choice?.finish_reason === 'content_filter') {
      throw new AiProviderError('AI_REFUSED', 'The AI provider refused this request', usage);
    }
    const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    if (!text) throw new AiProviderError('AI_EMPTY_OUTPUT', 'The AI returned an empty answer', usage);
    return { text, usage, providerId: parsed.id, finishReason: choice?.finish_reason ?? undefined, dataPolicy };
  } catch (error) {
    throw aborted(error, timedOut) ?? error;
  }
}

async function image(input: ImageInput): Promise<ImageResult> {
  const { signal, timedOut } = withTimeout(input.signal, IMAGE_TIMEOUT_MS);
  try {
    const { response, dataPolicy } = await post(
      '/images',
      {
        model: input.model,
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        output_format: input.format,
        n: 1,
        user: input.userId,
      },
      input.model,
      signal,
    );
    if (!response.ok) throw await failure(response);
    const parsed = imageResponseSchema.parse(await response.json());
    const usage = toUsage(parsed.usage);
    const first = parsed.data[0];
    const mimeType = first?.media_type ?? `image/${input.format}`;
    if (!first?.b64_json || !mimeType.startsWith('image/')) {
      throw new AiProviderError('AI_EMPTY_OUTPUT', 'The AI returned no image', usage);
    }
    if (Math.floor((first.b64_json.length * 3) / 4) > MAX_IMAGE_BYTES) {
      throw new AiProviderError('AI_PROVIDER_FAILED', 'The generated image is too large', usage);
    }
    return { mimeType, base64: first.b64_json, usage, providerId: parsed.id, dataPolicy };
  } catch (error) {
    throw aborted(error, timedOut) ?? error;
  }
}

export const openRouterProvider: AiProvider = { chat, image };

registerAiProviderFactory(() => openRouterProvider);
