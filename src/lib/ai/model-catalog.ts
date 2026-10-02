import { z } from 'zod';

/**
 * OpenRouter's public model list, for picking the text and image models in the
 * dashboard (Settings → AI). Prices are converted from USD per token to the
 * units the dashboard shows. Cached for 10 minutes.
 */

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_MS = 10 * 60 * 1000;

/**
 * OpenRouter bills image output per image token and the token count per image
 * depends on the model family (its images API reported 4,175 for Seedream,
 * Gemini images use about 1,290 and OpenAI's about 1,056 at medium quality).
 * Estimates only: the dashboard also shows the real average cost per action.
 */
export function imageTokensFor(modelId: string): number {
  if (modelId.startsWith('google/')) return 1_290;
  if (modelId.startsWith('openai/')) return 1_056;
  return 4_175;
}

const price = z.union([z.string(), z.number()]).nullish();
const modelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().nullish(),
  architecture: z
    .object({
      input_modalities: z.array(z.string()).nullish(),
      output_modalities: z.array(z.string()).nullish(),
    })
    .nullish(),
  pricing: z
    .object({
      prompt: price,
      completion: price,
      request: price,
      web_search: price,
      image_output: price,
      image_token: price,
    })
    .nullish(),
});
const listSchema = z.object({ data: z.array(z.unknown()) });

export type CatalogModel = {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per million input tokens. */
  promptPerMillionUsd: number;
  /** USD per million output tokens. */
  completionPerMillionUsd: number;
  /** USD added to every request. */
  requestUsd: number;
  /** USD per web search request, when the model offers native search. */
  webSearchUsd: number | null;
  /** Image models: estimated USD per generated image (see `imageTokensFor`). */
  imageUsd: number | null;
  /** Image models: the image tokens assumed for `imageUsd`. */
  imageTokens: number | null;
  free: boolean;
};

const usd = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Normalizes one listed model; null for routers and models without usable prices. */
export function toCatalogModel(raw: unknown): CatalogModel | null {
  const parsed = modelSchema.safeParse(raw);
  if (!parsed.success) return null;
  const model = parsed.data;
  const prompt = usd(model.pricing?.prompt);
  const completion = usd(model.pricing?.completion);
  // `openrouter/auto` and similar routers report -1.
  if (prompt === null || completion === null || prompt < 0 || completion < 0) return null;
  const imageToken = usd(model.pricing?.image_output) ?? usd(model.pricing?.image_token);
  const tokens = imageToken === null ? null : imageTokensFor(model.id);
  const request = usd(model.pricing?.request) ?? 0;
  return {
    id: model.id,
    name: model.name ?? model.id,
    contextLength: model.context_length ?? null,
    promptPerMillionUsd: prompt * 1_000_000,
    completionPerMillionUsd: completion * 1_000_000,
    requestUsd: request,
    webSearchUsd: usd(model.pricing?.web_search),
    imageUsd: imageToken === null || tokens === null ? null : imageToken * tokens,
    imageTokens: tokens,
    free: prompt === 0 && completion === 0 && request === 0 && !imageToken,
  };
}

/** Text models: text in, text only out. */
export function isTextModel(raw: unknown): boolean {
  const parsed = modelSchema.safeParse(raw);
  if (!parsed.success) return false;
  const output = parsed.data.architecture?.output_modalities ?? ['text'];
  const input = parsed.data.architecture?.input_modalities ?? ['text'];
  return input.includes('text') && output.includes('text') && !output.includes('image');
}

export type ModelCatalog = { text: CatalogModel[]; image: CatalogModel[]; fetchedAt: string };

let cached: { at: number; catalog: ModelCatalog } | null = null;

async function list(url: string, fetcher: typeof fetch): Promise<unknown[]> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`OpenRouter model list failed with status ${response.status}`);
  return listSchema.parse(await response.json()).data;
}

const byName = (a: CatalogModel, b: CatalogModel) => a.id.localeCompare(b.id);

export async function getModelCatalog(
  { refresh = false, fetcher = fetch }: { refresh?: boolean; fetcher?: typeof fetch } = {},
): Promise<ModelCatalog> {
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.catalog;
  const [all, images] = await Promise.all([list(MODELS_URL, fetcher), list(`${MODELS_URL}?output_modalities=image`, fetcher)]);
  const catalog: ModelCatalog = {
    text: all.filter(isTextModel).map(toCatalogModel).filter((model): model is CatalogModel => model !== null).sort(byName),
    image: images
      .map(toCatalogModel)
      .filter((model): model is CatalogModel => model !== null && model.imageUsd !== null)
      .sort(byName),
    fetchedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), catalog };
  return catalog;
}
