import { PrismaClient } from '@prisma/client';
import { env } from '@/env';
import { seedRootAdmin } from './tables/root-admin';
import { seedKeywordCategory } from './tables/keyword-category';
import { seedKeywordNature } from './tables/keyword-nature';
import { seedKeywords } from './tables/keywords';
import { seedChapters } from './tables/chapters';
import { seedNovels } from './tables/novels';
import { seedKeywordReplacement } from './tables/keyword-replacement';
import { seedKeywordsChapters } from './tables/keywords-chapters';

const prisma = new PrismaClient();

async function main() {
  await seedRootAdmin(prisma);

  if (env.NODE_ENV === 'development') {
    await seedKeywordCategory(prisma);
    await seedKeywordNature(prisma);
    await seedNovels(prisma);
    await seedChapters(prisma);
    await seedKeywords(prisma);
    await seedKeywordsChapters(prisma);
    await seedKeywordReplacement(prisma);
  }
}

await main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
