import type { PrismaClient } from '@prisma/client';
import { seedReplacements } from '../data/replacements';
import { indexBy } from '../utils/lookups';

export async function seedKeywordReplacement(prisma: PrismaClient) {
  console.log('🌱', 'Seeding keyword replacements');

  const novels = await prisma.novel.findMany();
  if (novels.length === 0) {
    throw new Error('No novels found');
  }

  const keywords = await prisma.keyword.findMany({
    select: { id: true, name: true, novelId: true },
  });

  const novelByName = indexBy(novels, (novel) => novel.name);
  const keywordByNovelAndName = new Map<string, string>();

  for (const keyword of keywords) {
    keywordByNovelAndName.set(
      `${keyword.novelId}:${keyword.name.trim()}`,
      keyword.id,
    );
  }

  await prisma.replacement.createMany({
    data: seedReplacements.flatMap((replacement) => {
      const novel = novelByName.get(replacement.novelName);

      if (!novel) {
        return [];
      }

      const from = replacement.from.trim();
      const keywordId = keywordByNovelAndName.get(`${novel.id}:${from}`);

      return [
        {
          from: replacement.from,
          to: replacement.to,
          novelId: novel.id,
          keywordId,
        },
      ];
    }),
    skipDuplicates: true,
  });
}
