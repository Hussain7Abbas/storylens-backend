import type { PrismaClient } from '@prisma/client';
import { seedKeywordCategories } from '../data/keyword-categories';

export async function seedKeywordCategory(prisma: PrismaClient) {
  console.log('🌱', 'Seeding keyword categories');

  await prisma.keywordCategory.createMany({
    data: seedKeywordCategories.map((category) => ({
      nameEn: category.nameEn,
      nameAr: category.nameAr,
      color: category.color,
    })),
  });
}
