import type { PrismaClient } from '@prisma/client';
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

  const novelByName = indexBy(novels, (novel) => novel.name);
  const categoryByName = indexBy(keywordCategories, (category) => category.name);
  const natureByName = indexBy(keywordNatures, (nature) => nature.name);

  const seen = new Set<string>();

  await prisma.keyword.createMany({
    data: seedKeywordsData.flatMap((keyword) => {
      const novel = novelByName.get(keyword.novelName);
      const { category, nature } = mapLegacyRole(keyword.role);
      const categoryRecord = categoryByName.get(category);
      const natureRecord = natureByName.get(nature);

      if (!novel || !categoryRecord || !natureRecord) {
        return [];
      }

      const name = keyword.name.trim();
      const dedupeKey = `${novel.id}::${name}`;
      if (seen.has(dedupeKey)) {
        return [];
      }
      seen.add(dedupeKey);

      return [
        {
          name,
          description: keyword.description,
          novelId: novel.id,
          categoryId: categoryRecord.id,
          natureId: natureRecord.id,
          ...(keyword.timestamp ? { createdAt: new Date(keyword.timestamp) } : {}),
        },
      ];
    }),
  });
}
