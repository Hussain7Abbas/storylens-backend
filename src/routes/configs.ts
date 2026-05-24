import { ConfigPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

/**
 * Config routes for managing application configuration
 */
export const configs = new Elysia({
  prefix: '/configs',
  tags: ['Configs'],
})
  .use(setup)

  /**
   * Get all configs
   */
  .get(
    '/',
    async ({ prisma }) => {
      const configs = await prisma.config.findMany({
        orderBy: {
          key: 'asc',
        },
      });

      return {
        data: configs,
      };
    },
    {
      response: {
        200: t.Object({
          data: t.Array(ConfigPlain),
        }),
      },
    },
  )

  /**
   * Get config by key
   */
  .get(
    '/:key',
    async ({ prisma, params: { key } }) => {
      const config = await prisma.config.findUnique({
        where: { key },
      });

      if (!config) {
        throw new HttpError({ message: 'Config not found', statusCode: 404 });
      }

      return config;
    },
    {
      params: t.Object({
        key: t.String(),
      }),
      response: {
        200: ConfigPlain,
      },
    },
  )

  /**
   * Create or update config
   */
  .put(
    '/',
    async ({ prisma, body }) => {
      const config = await prisma.config.upsert({
        where: { key: body.key },
        update: {
          value: body.value,
        },
        create: {
          key: body.key,
          value: body.value,
        },
      });

      return config;
    },
    {
      body: t.Object({
        key: t.String(),
        value: t.String(),
      }),
      response: {
        200: ConfigPlain,
      },
    },
  )

  /**
   * Delete config
   */
  .delete(
    '/:key',
    async ({ prisma, params: { key } }) => {
      const existingConfig = await prisma.config.findUnique({
        where: { key },
      });

      if (!existingConfig) {
        throw new HttpError({ message: 'Config not found', statusCode: 404 });
      }

      await prisma.config.delete({
        where: { key },
      });

      return existingConfig;
    },
    {
      params: t.Object({
        key: t.String(),
      }),
      response: {
        200: ConfigPlain,
      },
    },
  );
