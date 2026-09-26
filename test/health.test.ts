import { describe, expect, it } from 'bun:test';
import type { PrismaClient } from '@prisma/client';
import { checkReadiness } from '../src/lib/health';
import { app } from '../src/server';

type PrismaMock = {
  query?: () => Promise<unknown>;
  reviewVersion?: string;
};

const createPrisma = ({ query = async () => [{ '?column?': 1 }], reviewVersion }: PrismaMock = {}) =>
  ({
    $queryRaw: query,
    config: {
      findUnique: async () => (reviewVersion ? { key: 'Review_Version', value: reviewVersion } : null),
    },
  }) as unknown as Pick<PrismaClient, '$queryRaw' | 'config'>;

const never = () => new Promise<never>(() => {});
const fixedNow = () => new Date('2026-09-26T12:00:00.000Z');

describe('GET /health', () => {
  it('returns status and timestamp', async () => {
    const res = await app.handle(new Request('http://localhost/health'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(Number.isNaN(Date.parse(data.timestamp))).toBe(false);
  });
});

describe('readiness', () => {
  it('reports every service and both versions when healthy', async () => {
    const result = await checkReadiness({
      prisma: createPrisma({ reviewVersion: '1.5.1' }),
      extensionId: 'abc',
      fetchPublishedVersion: async () => '1.5.0',
      uptimeSeconds: 12.4,
      now: fixedNow,
    });

    expect(result).toMatchObject({
      status: 'ok',
      timestamp: '2026-09-26T12:00:00.000Z',
      services: {
        backend: { status: 'ok', uptimeSeconds: 12 },
        database: { status: 'ok' },
        chromeStore: { status: 'ok' },
      },
      versions: { review: '1.5.1', store: '1.5.0' },
    });
  });

  it('returns null review version when none is pending', async () => {
    const result = await checkReadiness({
      prisma: createPrisma(),
      extensionId: 'abc',
      fetchPublishedVersion: async () => '1.5.0',
    });
    expect(result.versions).toEqual({ review: null, store: '1.5.0' });
  });

  it('is down when the database fails', async () => {
    const result = await checkReadiness({
      prisma: createPrisma({
        query: async () => {
          throw new Error('connection refused');
        },
      }),
      extensionId: 'abc',
      fetchPublishedVersion: async () => '1.5.0',
    });
    expect(result.status).toBe('down');
    expect(result.services.database.status).toBe('down');
    expect(result.versions).toEqual({ review: null, store: '1.5.0' });
    expect(JSON.stringify(result)).not.toContain('connection refused');
  });

  it('is degraded when the store check fails or hangs', async () => {
    const failing = await checkReadiness({
      prisma: createPrisma({ reviewVersion: '1.5.1' }),
      extensionId: 'abc',
      fetchPublishedVersion: async () => {
        throw new Error('503');
      },
    });
    const hanging = await checkReadiness({
      prisma: createPrisma({ reviewVersion: '1.5.1' }),
      extensionId: 'abc',
      fetchPublishedVersion: never,
      timeoutMs: 20,
    });

    for (const result of [failing, hanging]) {
      expect(result.status).toBe('degraded');
      expect(result.services.chromeStore.status).toBe('down');
      expect(result.versions).toEqual({ review: '1.5.1', store: null });
    }
  });

  it('times out a hanging database', async () => {
    const result = await checkReadiness({
      prisma: createPrisma({ query: never }),
      extensionId: 'abc',
      fetchPublishedVersion: async () => '1.5.0',
      timeoutMs: 20,
    });
    expect(result.status).toBe('down');
  });

  it('marks the store unconfigured without an extension id', async () => {
    let fetched = false;
    const result = await checkReadiness({
      prisma: createPrisma(),
      fetchPublishedVersion: async () => {
        fetched = true;
        return '1.5.0';
      },
    });
    expect({ status: result.status, store: result.services.chromeStore, fetched }).toEqual({
      status: 'degraded',
      store: { status: 'unconfigured' },
      fetched: false,
    });
  });
});
