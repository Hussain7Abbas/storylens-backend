import { WebsiteNovelBiasPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { shouldBeAdmin, shouldBeGuest } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

export const websiteNovelBiases = new Elysia({
  prefix: '/website-novel-biases',
  tags: ['WebsiteNovelBiases'],
})
  .use(setup)
  .use(shouldBeGuest())

  // Get all biases for a novel
  .get(
    '/',
    async ({ prisma, query: { novelId } }) => {
      const biases = await prisma.websiteNovelBias.findMany({
        where: { novelId },
        include: {
          websiteSelector: true,
        },
      });

      return biases;
    },
    {
      query: t.Object({
        novelId: t.String({ format: 'uuid' }),
      }),
      response: {
        200: t.Array(
          t.Composite([
            WebsiteNovelBiasPlain,
            t.Object({
              websiteSelector: t.Object({
                id: t.String(),
                website: t.String(),
                novelXpathValue: t.Nullable(t.String()),
                novelXpathRegex: t.Nullable(t.String()),
                novelUrlRegex: t.Nullable(t.String()),
                chapterXpathValue: t.Nullable(t.String()),
                chapterXpathRegex: t.Nullable(t.String()),
                chapterUrlRegex: t.Nullable(t.String()),
                createdAt: t.Date(),
                updatedAt: t.Date(),
              }),
            }),
          ]),
        ),
      },
    },
  )

  // Upsert bias (admin only); biasValue === 0 deletes the row
  .use(shouldBeAdmin())
  .post(
    '/',
    async ({ t, prisma, body, set }) => {
      const { websiteSelectorId, novelId, biasValue } = body;

      const websiteSelector = await prisma.websiteSelector.findUnique({
        where: { id: websiteSelectorId },
      });

      if (!websiteSelector) {
        throw new HttpError({
          statusCode: 404,
          message: t({
            en: 'Website selector not found',
            ar: 'محدد الموقع غير موجود',
          }),
        });
      }

      const novel = await prisma.novel.findUnique({ where: { id: novelId } });

      if (!novel) {
        throw new HttpError({
          statusCode: 404,
          message: t({ en: 'Novel not found', ar: 'الرواية غير موجودة' }),
        });
      }

      if (biasValue === 0) {
        await prisma.websiteNovelBias.deleteMany({
          where: { websiteSelectorId, novelId },
        });
        set.status = 204;
        return;
      }

      const bias = await prisma.websiteNovelBias.upsert({
        where: {
          websiteSelectorId_novelId: { websiteSelectorId, novelId },
        },
        create: { websiteSelectorId, novelId, biasValue },
        update: { biasValue },
        include: { websiteSelector: true },
      });

      return bias;
    },
    {
      body: t.Object({
        websiteSelectorId: t.String({ format: 'uuid' }),
        novelId: t.String({ format: 'uuid' }),
        biasValue: t.Integer(),
      }),
      response: {
        200: t.Composite([
          WebsiteNovelBiasPlain,
          t.Object({
            websiteSelector: t.Object({
              id: t.String(),
              website: t.String(),
              novelXpathValue: t.Nullable(t.String()),
              novelXpathRegex: t.Nullable(t.String()),
              novelUrlRegex: t.Nullable(t.String()),
              chapterXpathValue: t.Nullable(t.String()),
              chapterXpathRegex: t.Nullable(t.String()),
              chapterUrlRegex: t.Nullable(t.String()),
              createdAt: t.Date(),
              updatedAt: t.Date(),
            }),
          }),
        ]),
        204: t.Void(),
      },
    },
  )

  // Delete bias by ID (admin only)
  .delete(
    '/:id',
    async ({ t, prisma, params: { id } }) => {
      const existing = await prisma.websiteNovelBias.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new HttpError({
          statusCode: 404,
          message: t({ en: 'Bias not found', ar: 'التحيز غير موجود' }),
        });
      }

      await prisma.websiteNovelBias.delete({ where: { id } });

      return existing;
    },
    {
      params: t.Object({
        id: t.String({ format: 'uuid' }),
      }),
      response: {
        200: WebsiteNovelBiasPlain,
      },
    },
  );
