import type { PrismaClient } from '@prisma/client';
import { seedNovels as seedNovelsData } from '../data/novels';

export async function seedNovels(prisma: PrismaClient) {
  console.log('🌱', 'Seeding novels');

  await prisma.novel.createMany({
    data: seedNovelsData.map((novel) => ({
      name: novel.name,
      slugs: novel.slugs,
      description: `Last modified: ${novel.lastModified}`,
    })),
  });
}
