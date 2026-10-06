import type { PrismaClient } from '@prisma/client';
import { seedNovels as seedNovelsData } from '../data/novels';

export async function seedNovels(prisma: PrismaClient) {
  console.log('🌱', 'Seeding novels');

  await prisma.novel.createMany({
    data: seedNovelsData.map((novel) => ({
      nameAr: novel.name,
      slugs: novel.slugs,
      descriptionAr: `Last modified: ${novel.lastModified}`,
    })),
    skipDuplicates: true,
  });
}
