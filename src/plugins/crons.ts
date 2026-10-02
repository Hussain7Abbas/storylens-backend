import { cron as elysiaCron } from '@elysiajs/cron';
import type { Prisma } from '@prisma/client';
import { Elysia } from 'elysia';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import {
  checkReviewVersion,
  fetchPublishedChromeVersion,
  startDetachedSync,
} from '@/lib/review-version';
import { deleteFile } from '@/lib/storage';
import { pruneAiUsage, sweepStuckActions } from '@/lib/ai/cloud/actions';
import { pruneFeed } from '@/lib/sync/feed';

const storageCleaner = elysiaCron({
  name: 'storage-cleaner',
  pattern: '0 4 * * *',
  run: async () => {
    console.log('Storage cleaner is running');

    // Put Your filter here
    const where: Prisma.FileWhereInput = {
      id: '',
    };

    const files = await prisma.file.findMany({ where });

    Promise.all(
      files.map(async (file) => {
        await deleteFile(file.provider_image_id);
      }),
    );

    await prisma.file.deleteMany({ where });
  },
});

const reviewVersionWatcher = elysiaCron({
  name: 'review-version-watcher',
  pattern: '*/10 * * * *',
  run: async () => {
    // `make sync` pulls and restarts the checkout, so only run it on the deployed server.
    if (env.NODE_ENV !== 'production') return;

    try {
      const result = await checkReviewVersion({
        prisma,
        extensionId: env.CHROME_EXTENSION_ID,
        fetchPublishedVersion: fetchPublishedChromeVersion,
        startSync: startDetachedSync,
      });

      if (result.status === 'unconfigured') {
        console.warn('Review version watcher: CHROME_EXTENSION_ID is not set');
      } else if (result.status === 'deploying') {
        console.log(`Review version ${result.reviewVersion} is published; running make sync`);
      }
    } catch (error) {
      console.error('Review version watcher failed', error);
    }
  },
});

// Delta-sync feed rows older than the retention window; older cursors get 410 and pull in full.
const syncFeedPruner = elysiaCron({
  name: 'sync-feed-pruner',
  pattern: '30 3 * * *',
  run: async () => {
    try {
      const pruned = await pruneFeed(prisma);
      if (pruned) console.log(`Sync feed pruner removed ${pruned} changes`);
    } catch (error) {
      console.error('Sync feed pruner failed', error);
    }
  },
});

// Cloud AI actions left running by a restart are failed and refunded.
const aiActionSweeper = elysiaCron({
  name: 'ai-action-sweeper',
  pattern: '*/5 * * * *',
  run: async () => {
    try {
      const swept = await sweepStuckActions(prisma);
      if (swept) console.log(`AI action sweeper refunded ${swept} stuck actions`);
    } catch (error) {
      console.error('AI action sweeper failed', error);
    }
  },
});

// Cloud AI usage rows are kept 400 days; the lens ledger keeps its labels.
const aiUsagePruner = elysiaCron({
  name: 'ai-usage-pruner',
  pattern: '15 4 1 * *',
  run: async () => {
    try {
      const pruned = await pruneAiUsage(prisma);
      if (pruned) console.log(`AI usage pruner removed ${pruned} actions`);
    } catch (error) {
      console.error('AI usage pruner failed', error);
    }
  },
});

export const crons = new Elysia({ name: 'crons' })
  .use(storageCleaner)
  .use(reviewVersionWatcher)
  .use(syncFeedPruner)
  .use(aiActionSweeper)
  .use(aiUsagePruner);
