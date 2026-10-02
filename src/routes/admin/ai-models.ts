import { Elysia, t } from 'elysia';
import { getModelCatalog } from '@/lib/ai/model-catalog';
import { getBillingConfig } from '@/lib/billing/config';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

const modelSchema = t.Object({
  id: t.String(),
  name: t.String(),
  contextLength: t.Nullable(t.Number()),
  promptPerMillionUsd: t.Number(),
  completionPerMillionUsd: t.Number(),
  requestUsd: t.Number(),
  webSearchUsd: t.Nullable(t.Number()),
  imageUsd: t.Nullable(t.Number()),
  imageTokens: t.Nullable(t.Number()),
  free: t.Boolean(),
});

/**
 * OpenRouter's text and image models with their prices, for choosing the
 * `AI_Text_Model` and `AI_Image_Model` configs in Settings → AI.
 */
export const adminAiModels = new Elysia({ prefix: '/ai-models', tags: ['Admin: AI pricing'] })
  .use(setup)
  .use(authorize('admin'))
  .get(
    '/',
    async ({ prisma, query }) => {
      const config = await getBillingConfig(prisma);
      try {
        const catalog = await getModelCatalog({ refresh: query.refresh === true });
        return { ...catalog, selected: { text: config.textModel, image: config.imageModel } };
      } catch (error) {
        console.error('[ai] could not load the OpenRouter model list', error);
        throw new HttpError({ statusCode: 502, message: 'Could not load the model list from OpenRouter. Try again.' });
      }
    },
    {
      query: t.Object({ refresh: t.Optional(t.Boolean()) }),
      response: {
        200: t.Object({
          text: t.Array(modelSchema),
          image: t.Array(modelSchema),
          fetchedAt: t.String(),
          selected: t.Object({ text: t.String(), image: t.String() }),
        }),
      },
      detail: { summary: 'List OpenRouter models with prices' },
    },
  );
