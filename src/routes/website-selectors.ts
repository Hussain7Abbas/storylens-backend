import { Elysia, t } from 'elysia';
import { shouldBeAdmin, shouldBeGuest } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import {
  serializeWebsiteSelector,
  websiteSelectorBodySchema,
  websiteSelectorResponseSchema,
} from '@/utils/website-selector';

export const websiteSelectors = new Elysia({
  prefix: '/website-selectors',
  tags: ['WebsiteSelectors'],
})
  .use(setup)
  .use(shouldBeGuest())

  /**
   * Get website selector by hostname (guest, user, admin)
   */
  .get(
    '/:website',
    async ({ prisma, params: { website } }) => {
      const selector = await prisma.websiteSelector.findUnique({
        where: { website },
      });

      if (!selector) {
        throw new HttpError({
          message: 'Website selector not found',
          statusCode: 404,
        });
      }

      return serializeWebsiteSelector(selector);
    },
    {
      params: t.Object({
        website: t.String({ minLength: 1 }),
      }),
      response: {
        200: websiteSelectorResponseSchema,
      },
    },
  )

  /**
   * List / create / update / delete (admin only)
   */
  .use(shouldBeAdmin())
  .get(
    '/',
    async ({ prisma }) => {
      const selectors = await prisma.websiteSelector.findMany({
        orderBy: {
          website: 'asc',
        },
      });

      return {
        data: selectors.map(serializeWebsiteSelector),
      };
    },
    {
      response: {
        200: t.Object({
          data: t.Array(websiteSelectorResponseSchema),
        }),
      },
    },
  )
  .post(
    '/',
    async ({ prisma, body }) => {
      const existingSelector = await prisma.websiteSelector.findUnique({
        where: { website: body.website },
      });

      if (existingSelector) {
        throw new HttpError({
          message: 'Website selector already exists',
          statusCode: 409,
        });
      }

      const selector = await prisma.websiteSelector.create({
        data: {
          website: body.website,
          novelXpathValue: body.novel.xpath?.value ?? null,
          novelXpathRegex: body.novel.xpath?.regex ?? null,
          novelUrlRegex: body.novel.url?.regex ?? null,
          chapterXpathValue: body.chapter.xpath?.value ?? null,
          chapterXpathRegex: body.chapter.xpath?.regex ?? null,
          chapterUrlRegex: body.chapter.url?.regex ?? null,
        },
      });

      return serializeWebsiteSelector(selector);
    },
    {
      body: websiteSelectorBodySchema,
      response: {
        200: websiteSelectorResponseSchema,
      },
    },
  )
  .put(
    '/:website',
    async ({ prisma, params: { website }, body }) => {
      const existingSelector = await prisma.websiteSelector.findUnique({
        where: { website },
      });

      if (!existingSelector) {
        throw new HttpError({
          message: 'Website selector not found',
          statusCode: 404,
        });
      }

      const selector = await prisma.websiteSelector.update({
        where: { website },
        data: {
          novelXpathValue: body.novel.xpath?.value ?? null,
          novelXpathRegex: body.novel.xpath?.regex ?? null,
          novelUrlRegex: body.novel.url?.regex ?? null,
          chapterXpathValue: body.chapter.xpath?.value ?? null,
          chapterXpathRegex: body.chapter.xpath?.regex ?? null,
          chapterUrlRegex: body.chapter.url?.regex ?? null,
        },
      });

      return serializeWebsiteSelector(selector);
    },
    {
      params: t.Object({
        website: t.String({ minLength: 1 }),
      }),
      body: t.Omit(websiteSelectorBodySchema, ['website']),
      response: {
        200: websiteSelectorResponseSchema,
      },
    },
  )
  .delete(
    '/:website',
    async ({ prisma, params: { website } }) => {
      const existingSelector = await prisma.websiteSelector.findUnique({
        where: { website },
      });

      if (!existingSelector) {
        throw new HttpError({
          message: 'Website selector not found',
          statusCode: 404,
        });
      }

      await prisma.websiteSelector.delete({
        where: { website },
      });

      return serializeWebsiteSelector(existingSelector);
    },
    {
      params: t.Object({
        website: t.String({ minLength: 1 }),
      }),
      response: {
        200: websiteSelectorResponseSchema,
      },
    },
  );
