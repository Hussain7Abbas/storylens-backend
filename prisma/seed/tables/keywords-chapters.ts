import type { PrismaClient } from '@prisma/client';
import { groupBy } from '../utils/lookups';

export async function seedKeywordsChapters(prisma: PrismaClient) {
  console.log('🌱', 'Seeding keywords chapters');

  const keywords = await prisma.keyword.findMany({
    select: { id: true, novelId: true },
  });
  if (keywords.length === 0) {
    throw new Error('No keywords found');
  }

  const chapters = await prisma.chapter.findMany({
    select: { id: true, novelId: true, number: true },
    orderBy: { number: 'asc' },
  });
  if (chapters.length === 0) {
    throw new Error('No chapters found');
  }

  const chaptersByNovelId = groupBy(chapters, (chapter) => chapter.novelId);

  await prisma.keywordsChapters.createMany({
    data: keywords.flatMap((keyword) => {
      const novelChapters = chaptersByNovelId.get(keyword.novelId);
      const firstChapter = novelChapters?.[0];

      if (!firstChapter) {
        return [];
      }

      return [
        {
          keywordId: keyword.id,
          chapterId: firstChapter.id,
        },
      ];
    }),
  });
}
