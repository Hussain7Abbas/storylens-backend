import type { PrismaClient } from '@prisma/client';

const PLACEHOLDER_CHAPTER_COUNT = 5;

export async function seedChapters(prisma: PrismaClient) {
  console.log('🌱', 'Seeding chapters');

  const novels = await prisma.novel.findMany();

  if (novels.length === 0) {
    throw new Error('No novels found');
  }

  await prisma.chapter.createMany({
    data: novels.flatMap((novel) =>
      Array.from({ length: PLACEHOLDER_CHAPTER_COUNT }, (_, index) => ({
        name: `الفصل ${index + 1}`,
        description: null,
        number: index + 1,
        novelId: novel.id,
      })),
    ),
  });
}
