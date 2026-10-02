import { ConfigPlain } from '@/lib/db';
import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { validateConfigValue } from '@/lib/billing/config';

/**
 * Application configuration (for example `Review_Version`), managed from the
 * dashboard at `/api/admin/configs`.
 */
export const adminConfigs = new Elysia({
  prefix: '/configs',
  tags: ['Admin: Configs'],
})
  .use(setup)
  .use(authorize('admin'))

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
      detail: { summary: 'List configs' },
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
      detail: { summary: 'View a config' },
    },
  )

  /**
   * Create or update config
   */
  .put(
    '/',
    async ({ prisma, body }) => {
      // Billing and cloud AI keys must parse; other keys stay free-form.
      const invalid = validateConfigValue(body.key, body.value);
      if (invalid) {
        throw new HttpError({ code: 'INVALID_CONFIG_VALUE', message: invalid, details: { key: body.key } });
      }
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
      detail: { summary: 'Create or update a config' },
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
      detail: { summary: 'Delete a config' },
    },
  );
