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

export const crons = new Elysia({ name: 'crons' }).use(storageCleaner).use(reviewVersionWatcher);
