import type { PrismaClient } from '@prisma/client';
import { REVIEW_VERSION_KEY } from '@/lib/review-version';

export type ServiceStatus = 'ok' | 'down' | 'unconfigured';
export type ReadinessStatus = 'ok' | 'degraded' | 'down';

export type ServiceHealth = {
  status: ServiceStatus;
  latencyMs?: number;
};

export type Readiness = {
  status: ReadinessStatus;
  timestamp: string;
  services: {
    backend: ServiceHealth & { uptimeSeconds: number };
    database: ServiceHealth;
    chromeStore: ServiceHealth;
  };
  versions: {
    review: string | null;
    store: string | null;
  };
};

type ReadinessDeps = {
  prisma: Pick<PrismaClient, '$queryRaw' | 'config'>;
  extensionId?: string;
  fetchPublishedVersion: (extensionId: string) => Promise<string | null>;
  timeoutMs?: number;
  uptimeSeconds?: number;
  now?: () => Date;
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const timed = async <T>(
  name: string,
  task: () => Promise<T>,
  timeoutMs: number,
): Promise<{ health: ServiceHealth; value: T | null }> => {
  const startedAt = performance.now();
  try {
    const value = await withTimeout(task(), timeoutMs);
    return { health: { status: 'ok', latencyMs: Math.round(performance.now() - startedAt) }, value };
  } catch (error) {
    // Details stay in server logs; the endpoint is public.
    console.error(`Health check failed: ${name}`, error);
    return { health: { status: 'down', latencyMs: Math.round(performance.now() - startedAt) }, value: null };
  }
};

/**
 * Checks each dependency. The database is required (`down`); the Chrome Web Store is
 * only needed for review-version deploys (`degraded`).
 */
export const checkReadiness = async ({
  prisma,
  extensionId,
  fetchPublishedVersion,
  timeoutMs = 5_000,
  uptimeSeconds = process.uptime(),
  now = () => new Date(),
}: ReadinessDeps): Promise<Readiness> => {
  const [database, chromeStore] = await Promise.all([
    timed(
      'database',
      async () => {
        await prisma.$queryRaw`SELECT 1`;
        const config = await prisma.config.findUnique({ where: { key: REVIEW_VERSION_KEY } });
        return config?.value ?? null;
      },
      timeoutMs,
    ),
    extensionId
      ? timed('chromeStore', () => fetchPublishedVersion(extensionId), timeoutMs)
      : Promise.resolve({ health: { status: 'unconfigured' } as ServiceHealth, value: null }),
  ]);

  const status: ReadinessStatus =
    database.health.status !== 'ok' ? 'down' : chromeStore.health.status !== 'ok' ? 'degraded' : 'ok';

  return {
    status,
    timestamp: now().toISOString(),
    services: {
      backend: { status: 'ok', uptimeSeconds: Math.round(uptimeSeconds) },
      database: database.health,
      chromeStore: chromeStore.health,
    },
    versions: {
      review: database.value,
      store: chromeStore.value,
    },
  };
};
