import { describe, expect, it } from 'bun:test';
import { getModelCatalog, imageTokensFor, isTextModel, toCatalogModel } from '@/lib/ai/model-catalog';

const gemini = {
  id: 'google/gemini-2.5-flash',
  name: 'Google: Gemini 2.5 Flash',
  context_length: 1_048_576,
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  pricing: { prompt: '0.0000003', completion: '0.0000025', web_search: '0.014' },
};
const seedream = {
  id: 'bytedance-seed/seedream-5-0-flash',
  name: 'Seedream 5.0 Flash',
  architecture: { input_modalities: ['text'], output_modalities: ['image'] },
  pricing: { prompt: '0', completion: '0', image_output: '0.00000431137724550898' },
};
const router = { id: 'openrouter/auto', architecture: { output_modalities: ['text'] }, pricing: { prompt: '-1', completion: '-1' } };

describe('model catalog', () => {
  it('converts per-token prices', () => {
    expect(toCatalogModel(gemini)).toMatchObject({
      promptPerMillionUsd: 0.3,
      completionPerMillionUsd: 2.5,
      webSearchUsd: 0.014,
      imageUsd: null,
      free: false,
    });
  });

  it('estimates the cost of one image from image tokens', () => {
    expect(imageTokensFor('google/gemini-3.1-flash-image')).toBe(1_290);
    expect(imageTokensFor('openai/gpt-image-2')).toBe(1_056);
    expect(imageTokensFor('bytedance-seed/seedream-5-0-flash')).toBe(4_175);
    expect(toCatalogModel(seedream)?.imageUsd).toBeCloseTo(0.018, 4);
  });

  it('drops routers and keeps only text-out models in the text list', () => {
    expect(toCatalogModel(router)).toBeNull();
    expect(isTextModel(gemini)).toBe(true);
    expect(isTextModel(seedream)).toBe(false);
  });

  it('builds both lists from OpenRouter', async () => {
    const fetcher = (async (url: string) =>
      Response.json({ data: String(url).includes('output_modalities=image') ? [seedream] : [gemini, seedream, router] })) as unknown as typeof fetch;
    const catalog = await getModelCatalog({ refresh: true, fetcher });
    expect(catalog.text.map((model) => model.id)).toEqual(['google/gemini-2.5-flash']);
    expect(catalog.image.map((model) => model.id)).toEqual(['bytedance-seed/seedream-5-0-flash']);
  });
});
