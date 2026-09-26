import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';

/** Config key holding the extension version waiting for Chrome Web Store review. */
export const REVIEW_VERSION_KEY = 'Review_Version';

const CHROME_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
// Must be at least the extension's minimum Chrome version, otherwise the store reports no update.
const CHROME_PROD_VERSION = '150.0.0.0';
const BACKEND_ROOT = resolve(import.meta.dir, '../..');

export const isValidExtensionVersion = (version: string): boolean =>
  /^\d+(\.\d+){0,3}$/.test(version);

/** Reads the published version from a Chrome update-check XML response. */
export const parsePublishedVersion = (xml: string): string | null =>
  /<updatecheck\b[^>]*\bversion="([^"]+)"/.exec(xml)?.[1] ?? null;

/** Returns the version currently live on the Chrome Web Store, or null when none is published. */
export const fetchPublishedChromeVersion = async (extensionId: string): Promise<string | null> => {
  const url = new URL(CHROME_UPDATE_URL);
  url.searchParams.set('response', 'updatecheck');
  url.searchParams.set('acceptformat', 'crx3');
  url.searchParams.set('prodversion', CHROME_PROD_VERSION);
  url.searchParams.set('x', `id=${extensionId}&uc`);

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Chrome Web Store update check failed with status ${response.status}`);
  }

  return parsePublishedVersion(await response.text());
};

/**
 * Runs `make sync` outside the API's process tree. `make sync` stops this PM2 process,
 * so the background shell exits immediately and `make` is reparented away from the API.
 */
export const startDetachedSync = (): void => {
  const child = spawn('/bin/sh', ['-c', 'nohup make sync >> sync.log 2>&1 &'], {
    cwd: BACKEND_ROOT,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
};

export type ReviewVersionCheck =
  | { status: 'idle' }
  | { status: 'unconfigured'; reviewVersion: string }
  | { status: 'pending'; reviewVersion: string; publishedVersion: string | null }
  | { status: 'deploying'; reviewVersion: string };

type ReviewVersionDeps = {
  prisma: Pick<PrismaClient, 'config'>;
  extensionId?: string;
  fetchPublishedVersion: (extensionId: string) => Promise<string | null>;
  startSync: () => void;
};

/**
 * Deploys the backend once the extension version under review is live on the store.
 * The config is cleared before syncing so later cron ticks do not deploy again.
 */
export const checkReviewVersion = async ({
  prisma,
  extensionId,
  fetchPublishedVersion,
  startSync,
}: ReviewVersionDeps): Promise<ReviewVersionCheck> => {
  const config = await prisma.config.findUnique({ where: { key: REVIEW_VERSION_KEY } });
  if (!config) return { status: 'idle' };

  const reviewVersion = config.value;
  if (!extensionId) return { status: 'unconfigured', reviewVersion };

  const publishedVersion = await fetchPublishedVersion(extensionId);
  if (publishedVersion !== reviewVersion) {
    return { status: 'pending', reviewVersion, publishedVersion };
  }

  // Match the value too, so a newer version set meanwhile is not cleared.
  const { count } = await prisma.config.deleteMany({
    where: { key: REVIEW_VERSION_KEY, value: reviewVersion },
  });
  if (count === 0) return { status: 'pending', reviewVersion, publishedVersion };

  startSync();
  return { status: 'deploying', reviewVersion };
};
