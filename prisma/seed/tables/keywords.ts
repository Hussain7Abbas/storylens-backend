import type { PrismaClient } from '@prisma/client';
import { cleanKeywordName } from '@/utils/arabic';
import { seedKeywords as seedKeywordsData } from '../data/keywords';
import { mapLegacyRole } from '../utils/legacy-role-mapper';
import { indexBy } from '../utils/lookups';

export async function seedKeywords(prisma: PrismaClient) {
  console.log('🌱', 'Seeding keywords');

  const novels = await prisma.novel.findMany();
  if (novels.length === 0) {
    throw new Error('No novels found');
  }

  const keywordCategories = await prisma.keywordCategory.findMany();
  if (keywordCategories.length === 0) {
    throw new Error('No keyword categories found');
  }

  const keywordNatures = await prisma.keywordNature.findMany();
  if (keywordNatures.length === 0) {
    throw new Error('No keyword natures found');
  }

  const novelByName = indexBy(novels, (novel) => novel.nameAr ?? novel.nameEn ?? "");
  const categoryByName = indexBy(keywordCategories, (category) => category.nameAr ?? category.nameEn ?? "");
  const natureByName = indexBy(keywordNatures, (nature) => nature.nameAr ?? nature.nameEn ?? "");

  const existingKeywords = await prisma.keyword.findMany({
    select: { id: true, nameAr: true, novelId: true },
  });
  const existingByName = indexBy(existingKeywords, (keyword) => `${keyword.novelId}::${keyword.nameAr}`);
  const seen = new Set<string>();

  const rows = seedKeywordsData.flatMap((keyword) => {
    const novel = novelByName.get(keyword.novelName);
    const { category, nature } = mapLegacyRole(keyword.role);
    const categoryRecord = categoryByName.get(category);
    const natureRecord = natureByName.get(nature);

    if (!novel || !categoryRecord || !natureRecord) {
      throw new Error(`Missing seed references for keyword "${keyword.name}" in "${keyword.novelName}" (${category}/${nature})`);
    }

    const name = cleanKeywordName(keyword.name);
    if (!name) return [];
    const dedupeKey = `${novel.id}::${name}`;
    if (seen.has(dedupeKey)) {
      return [];
    }
    seen.add(dedupeKey);

    return [{
      id: existingByName.get(dedupeKey)?.id ?? crypto.randomUUID(),
      nameAr: name,
      description: keyword.description,
      novelId: novel.id,
      categoryId: categoryRecord.id,
      natureId: natureRecord.id,
      ...(keyword.timestamp ? { createdAt: new Date(keyword.timestamp) } : {}),
    }];
  });

  await prisma.$transaction([
    prisma.keyword.createMany({
      data: rows.map(({ id, nameAr, novelId, createdAt }) => ({ id, nameAr, novelId, createdAt })),
      skipDuplicates: true,
    }),
    prisma.keywordVersion.createMany({
      data: rows.map(({ id, description, categoryId, natureId, createdAt }) => ({
        keywordId: id,
        description,
        categoryId,
        natureId,
        startingChapter: 0,
        createdAt,
      })),
      skipDuplicates: true,
    }),
  ]);
}
