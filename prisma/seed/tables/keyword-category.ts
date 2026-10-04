import type { PrismaClient } from '@prisma/client';
import { seedKeywordCategories } from '../data/keyword-categories';

export async function seedKeywordCategory(prisma: PrismaClient) {
  console.log('🌱', 'Seeding keyword categories');

  const existing = await prisma.keywordCategory.findMany({
    select: { nameAr: true, nameEn: true },
  });
  const names = new Set(existing.map(({ nameAr, nameEn }) => JSON.stringify([nameAr, nameEn])));

  await prisma.keywordCategory.createMany({
    data: seedKeywordCategories.filter((category) =>
      !names.has(JSON.stringify([category.nameAr ?? null, category.nameEn ?? null])),
    ).map((category) => ({
      nameEn: category.nameEn,
      nameAr: category.nameAr,
      color: category.color,
      description: category.description,
    })),
  });
}
