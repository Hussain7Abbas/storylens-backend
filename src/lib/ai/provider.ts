import type { AiStreamErrorCode } from './cloud/error-codes';

/**
 * What the cloud AI routes need from a model provider. OpenRouter implements
 * it (`openrouter-provider.ts`); tests inject a fake through `setAiProvider`.
 */

export type DataPolicy = 'deny' | 'allow';

export type AiUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /** USD as reported by the provider (before OpenRouter's credit fee). */
  costUsd?: number;
};

export type ChatInput = {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Lets the model search the web (novel context research). */
  webSearch?: { maxResults: number };
  /** The reader's opaque ID, for the provider's abuse tracking. */
  userId: string;
  signal: AbortSignal;
};

export type ChatResult = {
  text: string;
  usage: AiUsage;
  providerId?: string;
  finishReason?: string;
  dataPolicy: DataPolicy;
};

export type ImageInput = {
  model: string;
  prompt: string;
  aspectRatio: '1:1';
  format: 'jpeg';
  userId: string;
  signal: AbortSignal;
};

export type ImageResult = {
  mimeType: string;
  base64: string;
  usage: AiUsage;
  providerId?: string;
  dataPolicy: DataPolicy;
};

export interface AiProvider {
  chat(input: ChatInput): Promise<ChatResult>;
  image(input: ImageInput): Promise<ImageResult>;
}

/** A provider failure with the stream code the reader's extension understands. */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiStreamErrorCode,
    message: string,
    /** What the failed call cost anyway, when the provider reported it. */
    readonly usage: AiUsage = {},
  ) {
    super(message);
  }
}

let override: AiProvider | null = null;
let factory: (() => AiProvider) | null = null;

/** Registers how the real provider is built (done once by the OpenRouter module). */
export function registerAiProviderFactory(create: () => AiProvider): void {
  factory = create;
}

/** Tests replace the provider; `null` restores the real one. */
export function setAiProvider(provider: AiProvider | null): void {
  override = provider;
}

export function getAiProvider(): AiProvider {
  if (override) return override;
  if (!factory) throw new Error('No AI provider registered');
  return factory();
}

/** Whether cloud AI can reach a provider: an injected one, or an OpenRouter key. */
export function aiProviderConfigured(hasApiKey: boolean): boolean {
  return override !== null || hasApiKey;
}
