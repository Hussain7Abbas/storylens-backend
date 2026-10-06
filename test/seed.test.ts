import { describe, expect, it } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { seedKeywordCategories } from '../prisma/seed/data/keyword-categories';
import { seedKeywordNatures } from '../prisma/seed/data/keyword-natures';
import { seedKeywords } from '../prisma/seed/data/keywords';
import { mapLegacyRole } from '../prisma/seed/utils/legacy-role-mapper';
import { cleanKeywordName } from '@/utils/arabic';

describe('seed data', () => {
  it('maps every legacy role to an available category and nature', () => {
    const categories = new Set(seedKeywordCategories.map((category) => category.nameAr));
    const natures = new Set(seedKeywordNatures.map((nature) => nature.nameAr));
    for (const role of new Set(seedKeywords.map((keyword) => keyword.role))) {
      const mapping = mapLegacyRole(role);
      expect(categories.has(mapping.category), role).toBe(true);
      expect(natures.has(mapping.nature), role).toBe(true);
    }
    expect(mapLegacyRole('مهارة').category).toBe('مهارة');
    expect(mapLegacyRole('طائفة').category).toBe('مكان');
  });

  it('rejects unknown legacy roles', () => {
    expect(() => mapLegacyRole('unknown')).toThrow('Unknown legacy role');
  });
});

const live = process.env.STORYLENS_LIVE_DB_TEST === '1' ? it : it.skip;

live('seeds during reset, reruns without duplicates, and resumes a partial seed', async () => {
  const admin = new PrismaClient();
  const databaseName = `storylens_seedtest_${process.pid}_${Date.now()}`;
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${databaseName}`;
  const databaseUrl = url.toString();
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  const root = new URL('..', import.meta.url).pathname;
  const commandEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'development',
    DASHBOARD_ADMIN_EMAIL: 'seed-admin@example.invalid',
    DASHBOARD_ADMIN_USERNAME: 'seed-admin',
    DASHBOARD_ADMIN_PASSWORD: 'seed-test-password',
  };
  function run(args: string[]) {
    const result = Bun.spawnSync(['bunx', 'prisma', ...args], {
      cwd: root, env: commandEnv, stdout: 'pipe', stderr: 'pipe',
    });
    expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
  }
  async function counts() {
    return Promise.all([
      client.user.count(), client.config.count(), client.websiteSelector.count(),
      client.keywordCategory.count(), client.keywordNature.count(), client.novel.count(),
      client.chapter.count(), client.keyword.count(), client.keywordVersion.count(),
      client.keywordsChapters.count(), client.replacement.count(),
    ]);
  }

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    run(['migrate', 'reset', '--force']);
    const keywords = await client.keyword.findMany({ select: { id: true, nameAr: true, novelId: true } });
    const novels = await client.novel.findMany();
    const novelIds = new Map(novels.map((novel) => [novel.nameAr, novel.id]));
    const expectedKeywords = new Set(seedKeywords.map((keyword) =>
      JSON.stringify([novelIds.get(keyword.novelName), cleanKeywordName(keyword.name)]),
    ));
    expect(keywords.length).toBe(expectedKeywords.size);
    for (const keyword of keywords) {
      expect(keyword.nameAr).toBe(cleanKeywordName(keyword.nameAr ?? ''));
    }
    expect(await client.keywordVersion.count()).toBe(keywords.length);
    const novel = novels[0]!;
    const keyword = keywords[0]!;
    const category = await client.keywordCategory.findFirstOrThrow();
    const chapter = await client.chapter.findFirstOrThrow();
    await client.novel.update({ where: { id: novel.id }, data: { descriptionAr: 'Edited novel' } });
    await client.keywordVersion.update({
      where: { keywordId_startingChapter: { keywordId: keyword.id, startingChapter: 0 } },
      data: { description: 'Edited keyword' },
    });
    await client.keywordCategory.update({ where: { id: category.id }, data: { color: '#123456' } });
    await client.chapter.update({ where: { id: chapter.id }, data: { name: 'Edited chapter' } });
    const before = await counts();
    run(['db', 'seed']);
    expect(await counts()).toEqual(before);
    expect((await client.novel.findUniqueOrThrow({ where: { id: novel.id } })).descriptionAr).toBe('Edited novel');
    expect((await client.keywordVersion.findUniqueOrThrow({
      where: { keywordId_startingChapter: { keywordId: keyword.id, startingChapter: 0 } },
    })).description).toBe('Edited keyword');
    expect((await client.keywordCategory.findUniqueOrThrow({ where: { id: category.id } })).color).toBe('#123456');
    expect((await client.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).name).toBe('Edited chapter');

    // A failed older seed can leave keywords without their chapter-zero version.
    await client.keywordVersion.deleteMany({ where: { keywordId: keyword.id } });
    await client.keywordsChapters.deleteMany({ where: { keywordId: keyword.id } });
    run(['db', 'seed']);
    expect(await counts()).toEqual(before);
    expect(await client.keywordVersion.count({ where: { keywordId: keyword.id, startingChapter: 0 } })).toBe(1);
    expect(await client.keywordsChapters.count({ where: { keywordId: keyword.id } })).toBe(1);
  } finally {
    await client.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.$disconnect();
  }
}, 120_000);
