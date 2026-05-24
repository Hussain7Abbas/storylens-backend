import { cron as elysiaCron } from '@elysiajs/cron';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { deleteFile } from '@/lib/storage';

export const crons = elysiaCron({
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
