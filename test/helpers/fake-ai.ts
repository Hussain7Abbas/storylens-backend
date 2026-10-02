import { type AiProvider, AiProviderError, type ChatInput, type ImageInput } from '@/lib/ai/provider';
import type { AiStreamErrorCode } from '@/lib/ai/cloud/error-codes';

/** What the next provider call does. */
export type Step =
  | { kind: 'ok'; text?: string; costUsd?: number }
  | { kind: 'fail'; code: AiStreamErrorCode }
  | { kind: 'hang' }
  | { kind: 'policy-fallback'; text?: string };

/** A scripted provider that records what it was asked (tests read `chats` and `images`). */
export function fakeAi() {
  const steps: Step[] = [];
  const chats: ChatInput[] = [];
  const images: ImageInput[] = [];

  const next = async (signal: AbortSignal): Promise<Step> => {
    const step = steps.shift() ?? { kind: 'ok' };
    if (step.kind === 'fail') throw new AiProviderError(step.code, `fake ${step.code}`, { costUsd: 0.0001 });
    if (step.kind === 'hang') {
      await new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new AiProviderError('AI_CANCELLED', 'cancelled'));
        signal.addEventListener('abort', () => reject(new AiProviderError('AI_CANCELLED', 'cancelled')), { once: true });
      });
    }
    return step;
  };

  const provider: AiProvider = {
    async chat(input) {
      chats.push(input);
      const step = await next(input.signal);
      const text = step.kind === 'ok' || step.kind === 'policy-fallback' ? (step.text ?? 'fake answer') : '';
      return {
        text,
        usage: { inputTokens: 100, outputTokens: 20, costUsd: step.kind === 'ok' ? (step.costUsd ?? 0.001) : 0.001 },
        providerId: `gen-${chats.length}`,
        dataPolicy: step.kind === 'policy-fallback' ? 'allow' : 'deny',
      };
    },
    async image(input) {
      images.push(input);
      await next(input.signal);
      return { mimeType: 'image/jpeg', base64: btoa('fake-image'), usage: { costUsd: 0.018 }, providerId: `img-${images.length}`, dataPolicy: 'deny' };
    },
  };

  return { provider, steps, chats, images };
}
