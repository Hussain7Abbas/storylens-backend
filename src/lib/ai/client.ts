import { OpenRouter } from '@openrouter/sdk';

export type OpenRouterClientOptions = {
  apiKey?: string;
  defaultModel?: string;
};

export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';

export function createOpenRouterClient(options: OpenRouterClientOptions = {}) {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is required. Set it in your environment or pass apiKey.',
    );
  }

  return new OpenRouter({ apiKey });
}

export function resolveOpenRouterModel(model?: string) {
  return model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}
