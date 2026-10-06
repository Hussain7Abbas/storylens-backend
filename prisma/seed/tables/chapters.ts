import type { PrismaClient } from '@prisma/client';

const PLACEHOLDER_CHAPTER_COUNT = 5;

export async function seedChapters(prisma: PrismaClient) {
  console.log('🌱', 'Seeding chapters');

  const novels = await prisma.novel.findMany();

  if (novels.length === 0) {
    throw new Error('No novels found');
  }

  const chapters = await prisma.chapter.findMany({
    select: { novelId: true, number: true },
  });
  const existing = new Set(chapters.map((chapter) => `${chapter.novelId}:${chapter.number}`));

  await prisma.chapter.createMany({
    data: novels.flatMap((novel) =>
      Array.from({ length: PLACEHOLDER_CHAPTER_COUNT }, (_, index) => ({
        name: `الفصل ${index + 1}`,
        description: null,
        number: index + 1,
        novelId: novel.id,
      })).filter((chapter) => !existing.has(`${chapter.novelId}:${chapter.number}`)),
    ),
  });
}
