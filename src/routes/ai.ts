import { detectChapterSelectors } from '@/lib/ai';
import { Elysia, t } from 'elysia';
import { env } from '@/env';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

const selectorFieldResponse = t.Object({
  value: t.String(),
  regex: t.String(),
});

const selectorSourceResponse = t.Object({
  xpath: t.Nullable(selectorFieldResponse),
  url: t.Nullable(selectorFieldResponse),
});

export const ai = new Elysia({
  prefix: '/ai',
  tags: ['AI'],
})
  .use(setup)

  .post(
    '/chapter-selectors',
    async ({ t, body }) => {
      if (!env.OPENROUTER_API_KEY) {
        throw new HttpError({
          statusCode: 503,
          message: t({
            en: 'OpenRouter is not configured on the server',
            ar: 'OpenRouter غير مُعد على الخادم',
          }),
        });
      }

      try {
        const output = await detectChapterSelectors(
          {
            url: body.url,
            html: body.html,
            model: body.model,
          },
          {
            apiKey: env.OPENROUTER_API_KEY,
            model: body.model ?? env.OPENROUTER_MODEL,
          },
        );

        return {
          result: output.result,
          nodeSelectorForm: output.nodeSelectorForm,
          novelForm: output.novelForm,
          validation: output.validation,
          usage: output.usage,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown AI agent error';

        throw new HttpError({
          statusCode: 502,
          message: t({
            en: `Failed to detect chapter selectors: ${message}`,
            ar: `فشل اكتشاف محددات الفصل: ${message}`,
          }),
        });
      }
    },
    {
      body: t.Object({
        url: t.String({ format: 'uri' }),
        html: t.String({ minLength: 1 }),
        model: t.Optional(t.String()),
      }),
      response: {
        200: t.Object({
          result: t.Object({
            website: t.String(),
            selectors: t.Object({
              website: t.String(),
              novel: selectorSourceResponse,
              chapter: selectorSourceResponse,
            }),
            novelForm: t.Object({
              name: t.String(),
              description: t.Optional(t.String()),
              slugs: t.Array(t.String()),
            }),
            confidence: t.Union([
              t.Literal('high'),
              t.Literal('medium'),
              t.Literal('low'),
            ]),
            notes: t.Optional(t.String()),
          }),
          nodeSelectorForm: t.Object({
            website: t.String(),
            novelXpath: t.String(),
            novelXpathRegex: t.String(),
            novelUrlRegex: t.String(),
            chapterXpath: t.String(),
            chapterXpathRegex: t.String(),
            chapterUrlRegex: t.String(),
          }),
          novelForm: t.Object({
            name: t.String(),
            description: t.String(),
            slugs: t.Array(t.String()),
          }),
          validation: t.Object({
            novelSlug: t.Nullable(t.String()),
            novelName: t.Nullable(t.String()),
            chapter: t.Nullable(t.Number()),
            errors: t.Array(t.String()),
          }),
          usage: t.Optional(
            t.Object({
              inputTokens: t.Optional(t.Number()),
              outputTokens: t.Optional(t.Number()),
              cost: t.Optional(t.Number()),
            }),
          ),
        }),
      },
    },
  );
