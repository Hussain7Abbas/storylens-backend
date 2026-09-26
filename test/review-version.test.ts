import { describe, expect, it } from 'bun:test';
import type { PrismaClient } from '@prisma/client';
import {
  checkReviewVersion,
  isValidExtensionVersion,
  parsePublishedVersion,
  REVIEW_VERSION_KEY,
} from '../src/lib/review-version';

const createConfigStore = (initial?: string) => {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(REVIEW_VERSION_KEY, initial);

  const config = {
    findUnique: async ({ where }: { where: { key: string } }) => {
      const value = store.get(where.key);
      return value === undefined ? null : { key: where.key, value };
    },
    deleteMany: async ({ where }: { where: { key: string; value: string } }) => {
      if (store.get(where.key) !== where.value) return { count: 0 };
      store.delete(where.key);
      return { count: 1 };
    },
  };

  return { store, prisma: { config } as unknown as Pick<PrismaClient, 'config'> };
};

const run = async (reviewVersion: string | undefined, publishedVersion: string | null, extensionId = 'abc') => {
  const { store, prisma } = createConfigStore(reviewVersion);
  let syncs = 0;
  const result = await checkReviewVersion({
    prisma,
    extensionId,
    fetchPublishedVersion: async () => publishedVersion,
    startSync: () => {
      syncs += 1;
    },
  });
  return { result, syncs, remaining: store.get(REVIEW_VERSION_KEY) };
};

describe('review version watcher', () => {
  it('does nothing without a review version', async () => {
    expect(await run(undefined, '1.5.1')).toEqual({ result: { status: 'idle' }, syncs: 0, remaining: undefined });
  });

  it('waits while the store still serves an older version', async () => {
    expect(await run('1.5.1', '1.5.0')).toEqual({
      result: { status: 'pending', reviewVersion: '1.5.1', publishedVersion: '1.5.0' },
      syncs: 0,
      remaining: '1.5.1',
    });
  });

  it('waits when the store has no published version', async () => {
    const { result, syncs } = await run('1.5.1', null);
    expect({ status: result.status, syncs }).toEqual({ status: 'pending', syncs: 0 });
  });

  it('clears the review version and syncs once the version is published', async () => {
    expect(await run('1.5.1', '1.5.1')).toEqual({
      result: { status: 'deploying', reviewVersion: '1.5.1' },
      syncs: 1,
      remaining: undefined,
    });
  });

  it('keeps the review version when the extension id is missing', async () => {
    expect(await run('1.5.1', '1.5.1', '')).toEqual({
      result: { status: 'unconfigured', reviewVersion: '1.5.1' },
      syncs: 0,
      remaining: '1.5.1',
    });
  });

  it('does not sync when a newer version replaced the config mid-check', async () => {
    const { store, prisma } = createConfigStore('1.5.1');
    let syncs = 0;
    const result = await checkReviewVersion({
      prisma,
      extensionId: 'abc',
      fetchPublishedVersion: async () => {
        store.set(REVIEW_VERSION_KEY, '1.5.2');
        return '1.5.1';
      },
      startSync: () => {
        syncs += 1;
      },
    });
    expect({ status: result.status, syncs, remaining: store.get(REVIEW_VERSION_KEY) }).toEqual({
      status: 'pending',
      syncs: 0,
      remaining: '1.5.2',
    });
  });
});

describe('Chrome update response parsing', () => {
  it('reads the published version', () => {
    const xml =
      '<gupdate><app appid="abc" status="ok"><updatecheck codebase="https://x/y.crx" hash_sha256="f0" status="ok" version="2026.920.1710"/></app></gupdate>';
    expect(parsePublishedVersion(xml)).toBe('2026.920.1710');
  });

  it('returns null for unknown or unpublished items', () => {
    expect(parsePublishedVersion('<gupdate><app appid="abc" status="error-unknownApplication"/></gupdate>')).toBeNull();
    expect(parsePublishedVersion('<gupdate><app appid="abc" status="ok"><updatecheck status="noupdate"/></app></gupdate>')).toBeNull();
  });

  it('validates Chrome extension versions', () => {
    expect(['1', '1.5', '1.5.0', '1.5.0.2'].every(isValidExtensionVersion)).toBe(true);
    expect(['', 'v1.5.0', '1.5.0-beta', '1.5.0.1.2', '1..5'].some(isValidExtensionVersion)).toBe(false);
  });
});
