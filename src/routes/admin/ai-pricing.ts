import { Elysia, t } from 'elysia';
import { aiFeaturePriceSchema } from '@/lib/billing/serialize';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

/**
 * The pricing record of each AI feature: lenses per action, on/off and limits
 * (models are the `AI_Text_Model` and `AI_Image_Model` configs). Rows come from migrations (feature keys are a client contract), so
 * there is no create or delete.
 */
export const adminAiPricing = new Elysia({ prefix: '/ai-pricing', tags: ['Admin: AI pricing'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/',
    async ({ prisma }) => ({
      data: await prisma.aiFeaturePrice.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
    }),
    {
      response: { 200: t.Object({ data: t.Array(aiFeaturePriceSchema) }) },
      detail: { summary: 'List AI feature prices' },
    },
  )

  .put(
    '/:key',
    async ({ prisma, params, body, authedUser }) => {
      const existing = await prisma.aiFeaturePrice.findUnique({ where: { key: params.key } });
      if (!existing) throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'AI feature not found' });
      const text = (value: string | null | undefined) =>
        value === undefined ? undefined : value === null ? null : sanitize(value) || null;
      const name = (value: string | undefined) => {
        if (value === undefined) return undefined;
        const clean = sanitize(value);
        if (!clean) throw new HttpError({ statusCode: 422, message: 'Names cannot be empty' });
        return clean;
      };
      return prisma.aiFeaturePrice.update({
        where: { key: params.key },
        data: {
          nameEn: name(body.nameEn),
          nameAr: name(body.nameAr),
          descriptionEn: text(body.descriptionEn),
          descriptionAr: text(body.descriptionAr),
          lenses: body.lenses,
          enabled: body.enabled,
          maxPromptChars: body.maxPromptChars,
          maxOutputTokens: body.maxOutputTokens,
          sortOrder: body.sortOrder,
          updatedById: authedUser.id,
        },
      });
    },
    {
      params: t.Object({ key: t.String() }),
      body: t.Object({
        nameEn: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        nameAr: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        descriptionEn: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
        descriptionAr: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
        lenses: t.Optional(t.Integer({ minimum: 0, maximum: 10_000 })),
        enabled: t.Optional(t.Boolean()),
        maxPromptChars: t.Optional(t.Integer({ minimum: 1_000, maximum: 400_000 })),
        maxOutputTokens: t.Optional(t.Integer({ minimum: 100, maximum: 16_000 })),
        sortOrder: t.Optional(t.Integer({ minimum: 0, maximum: 10_000 })),
      }),
      response: { 200: aiFeaturePriceSchema },
      detail: { summary: 'Update an AI feature price' },
    },
  );
