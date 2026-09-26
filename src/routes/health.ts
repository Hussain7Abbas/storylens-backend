import { Elysia, t } from 'elysia';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { checkReadiness } from '@/lib/health';
import { fetchPublishedChromeVersion } from '@/lib/review-version';

const serviceStatus = t.Union([t.Literal('ok'), t.Literal('down'), t.Literal('unconfigured')]);
const serviceHealth = t.Object({
  status: serviceStatus,
  latencyMs: t.Optional(t.Number()),
});

const readinessSchema = t.Object({
  status: t.Union([t.Literal('ok'), t.Literal('degraded'), t.Literal('down')]),
  timestamp: t.String(),
  services: t.Object({
    backend: t.Object({ status: serviceStatus, uptimeSeconds: t.Number() }),
    database: serviceHealth,
    chromeStore: serviceHealth,
  }),
  versions: t.Object({
    review: t.Nullable(t.String()),
    store: t.Nullable(t.String()),
  }),
});

/**
 * Public health routes for uptime monitors and deploy checks.
 */
export const health = new Elysia({
  prefix: '/health',
  tags: ['Health'],
})
  /**
   * Liveness: the API process is responding
   */
  .get('/', () => ({ status: 'ok' as const, timestamp: new Date().toISOString() }), {
    response: {
      200: t.Object({ status: t.Literal('ok'), timestamp: t.String() }),
    },
  })

  /**
   * Readiness: each service's health plus the review and published extension versions.
   * Responds 503 when the database is down.
   */
  .get(
    '/ready',
    async ({ set }) => {
      const readiness = await checkReadiness({
        prisma,
        extensionId: env.CHROME_EXTENSION_ID,
        fetchPublishedVersion: fetchPublishedChromeVersion,
      });

      if (readiness.status === 'down') set.status = 503;

      return readiness;
    },
    {
      response: {
        200: readinessSchema,
        503: readinessSchema,
      },
    },
  );
