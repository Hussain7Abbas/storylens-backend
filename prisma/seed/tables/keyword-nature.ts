import type { PrismaClient } from '@prisma/client';
import { seedKeywordNatures } from '../data/keyword-natures';

export async function seedKeywordNature(prisma: PrismaClient) {
  console.log('🌱', 'Seeding keyword natures');

  await prisma.keywordNature.createMany({
    data: seedKeywordNatures.map((nature) => ({
      name: nature.name,
      color: nature.color,
    })),
  });
}
