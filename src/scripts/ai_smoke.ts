import { env } from '@/env';
import { getBillingConfig } from '@/lib/billing/config';
import { openRouterProvider } from '@/lib/ai/openrouter-provider';
import { AiProviderError } from '@/lib/ai/provider';
import { prisma } from '@/lib/db';

// One tiny Gemini call and one Seedream image with the configured OpenRouter key
// (about $0.02). Prints the data policy used, tokens and cost; writes nothing.
async function run(label: string, task: () => Promise<{ dataPolicy: string; usage: unknown; providerId?: string }>) {
  const started = performance.now();
  try {
    const result = await task();
    console.log(`${label}: ok in ${Math.round(performance.now() - started)} ms, data policy ${result.dataPolicy}, id ${result.providerId ?? '?'}`);
    console.log(`  usage ${JSON.stringify(result.usage)}`);
  } catch (error) {
    process.exitCode = 1;
    const detail = error instanceof AiProviderError ? `${error.code}: ${error.message}` : String(error);
    console.error(`${label}: FAILED ${detail}`);
  }
}

try {
  if (!env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY first');
  // The models chosen in the dashboard (Settings → AI).
  const { textModel, imageModel } = await getBillingConfig(prisma);
  const signal = new AbortController().signal;
  await run(`chat ${textModel}`, () =>
    openRouterProvider.chat({
      model: textModel,
      system: 'Answer in one short sentence.',
      prompt: 'Say hello to a reader of web novels.',
      maxTokens: 60,
      userId: 'smoke-test',
      signal,
    }),
  );
  await run(`image ${imageModel}`, () =>
    openRouterProvider.image({
      model: imageModel,
      prompt: 'A small paper lantern glowing on a wooden desk, soft light, simple background.',
      aspectRatio: '1:1',
      format: 'jpeg',
      userId: 'smoke-test',
      signal,
    }),
  );
} finally {
  await prisma.$disconnect();
}
