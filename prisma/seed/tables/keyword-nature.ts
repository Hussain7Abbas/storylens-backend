import type { PrismaClient } from '@prisma/client';
import { seedKeywordNatures } from '../data/keyword-natures';

export async function seedKeywordNature(prisma: PrismaClient) {
  console.log('🌱', 'Seeding keyword natures');

  const existing = await prisma.keywordNature.findMany({
    select: { nameAr: true, nameEn: true },
  });
  const names = new Set(existing.map(({ nameAr, nameEn }) => JSON.stringify([nameAr, nameEn])));

  await prisma.keywordNature.createMany({
    data: seedKeywordNatures.filter((nature) =>
      !names.has(JSON.stringify([nature.nameAr ?? null, nature.nameEn ?? null])),
    ).map((nature) => ({
      nameEn: nature.nameEn,
      nameAr: nature.nameAr,
      color: nature.color,
      description: nature.description,
    })),
  });
}
