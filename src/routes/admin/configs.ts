import { Prisma } from '@prisma/client';
import { isAiInstructionKey } from '@/lib/ai/instructions';
import { LENS_INVENTORY_KEY, lockLensInventory } from '@/lib/billing/inventory';
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
      const config = await prisma.$transaction(async (tx) => {
        let updatedAt: Date | undefined;
        if (body.key === LENS_INVENTORY_KEY || isAiInstructionKey(body.key)) {
          if (body.key === LENS_INVENTORY_KEY) await lockLensInventory(tx);
          else await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${body.key}))`);
          const current = await tx.config.findUnique({ where: { key: body.key } });
          updatedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1));
          if (body.baseUpdatedAt !== undefined && body.baseUpdatedAt !== (current?.updatedAt.toISOString() ?? null)) {
            throw new HttpError({ statusCode: 409, code: 'CONFIG_STALE', message: body.key === LENS_INVENTORY_KEY ? 'The available balance changed. Reload it before saving.' : 'This AI prompt changed. Reload it before saving.' });
          }
        }
        return tx.config.upsert({
          where: { key: body.key }, update: { value: body.value, updatedAt }, create: { key: body.key, value: body.value },
        });
      });

      return config;
    },
    {
      body: t.Object({
        key: t.String(),
        value: t.String(),
        baseUpdatedAt: t.Optional(t.Nullable(t.String({ format: 'date-time' }))),
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
      const existingConfig = await prisma.$transaction(async (tx) => {
        if (key === LENS_INVENTORY_KEY) await lockLensInventory(tx);
        else if (isAiInstructionKey(key)) await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
        const current = await tx.config.findUnique({ where: { key } });
        if (!current) throw new HttpError({ message: 'Config not found', statusCode: 404 });
        await tx.config.delete({ where: { key } });
        return current;
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
