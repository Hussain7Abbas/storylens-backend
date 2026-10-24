import { describe, expect } from 'bun:test';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { live } from './helpers/live-db';

const root = new URL('..', import.meta.url).pathname;
const migrationsDir = join(root, 'prisma/migrations');
const FIRST_NEW = '20260930100000_alias_names_only';

function databaseUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}

/** A fresh database with the migrations before (or through) `upTo` applied. */
async function prepare(name: string, workdir: string, include: (migration: string) => boolean) {
  const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();
  deploy(name, workdir, include);
}

function deploy(name: string, workdir: string, include: (migration: string) => boolean) {
  rmSync(join(workdir, 'migrations'), { recursive: true, force: true });
  cpSync(join(root, 'prisma/schema.prisma'), join(workdir, 'schema.prisma'));
  for (const entry of readdirSync(migrationsDir)) {
    if (entry === 'migration_lock.toml' || include(entry)) {
      cpSync(join(migrationsDir, entry), join(workdir, 'migrations', entry), { recursive: true });
    }
  }
  return Bun.spawnSync(['bunx', 'prisma', 'migrate', 'deploy', '--schema', join(workdir, 'schema.prisma')], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl(name) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

async function seed(name: string, sql: string[]) {
  const client = new PrismaClient({ datasourceUrl: databaseUrl(name) });
  for (const statement of sql) await client.$executeRawUnsafe(statement);
  return client;
}

const baseRows = [
  `INSERT INTO "Novel" (id, "nameEn", "descriptionEn", slugs, "updatedAt") VALUES ('n1', 'D&#x27;Artagnan &quot;Tales&quot;', '&lt;b&gt;bold&lt;/b&gt;', ARRAY['it&#x27;s'], now())`,
  `INSERT INTO "KeywordCategory" (id, "nameEn", color, "updatedAt") VALUES ('c1', 'Hero&#x27;s', '#000000', now())`,
  `INSERT INTO "KeywordNature" (id, "nameEn", color, "updatedAt") VALUES ('t1', 'Nature', '#000000', now())`,
  `INSERT INTO "Keyword" (id, "nameAr", "nameEn", "novelId", "updatedAt") VALUES ('k1', 'ميرا', 'Mira', 'n1', now()), ('k2', NULL, 'O&#x27;Brien', 'n1', now())`,
  `INSERT INTO "KeywordVersion" (id, description, "startingChapter", "keywordId", "updatedAt") VALUES ('v1', 'a &lt; b', 0, 'k1', now())`,
  `INSERT INTO "Replacement" (id, "from", "to", "novelId", "updatedAt") VALUES ('r1', 'D&#x27;Art', 'D&#x27;Artagnan', 'n1', now())`,
];

describe('offline-first migrations', () => {
  live('fills alias names by script and decodes stored text', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'storylens-migrations-'));
    const name = `storylens_migtest_${process.pid}`;
    try {
      await prepare(name, workdir, (migration) => migration < FIRST_NEW);
      const client = await seed(name, [
        ...baseRows,
        `INSERT INTO "KeywordAlias" (id, name, "nameAr", "nameEn", "keywordId", "updatedAt") VALUES
          ('a-ar', 'ميرا الصغيرة', NULL, NULL, 'k1', now()),
          ('a-en', 'Little Mira', NULL, NULL, 'k1', now()),
          ('a-digits', '007', NULL, NULL, 'k1', now()),
          ('a-both', 'Mira-chan', 'ميرا تشان', 'Mira-chan', 'k1', now()),
          ('a-quote', 'D&#x27;Art', NULL, NULL, 'k2', now()),
          ('a-digits-en', '42', NULL, NULL, 'k2', now())`,
      ]);
      const result = deploy(name, workdir, () => true);
      expect(result.exitCode, result.stderr.toString()).toBe(0);

      const aliases = await client.$queryRawUnsafe<{ id: string; nameAr: string | null; nameEn: string | null }[]>(
        'SELECT id, "nameAr", "nameEn" FROM "KeywordAlias" ORDER BY id',
      );
      expect(Object.fromEntries(aliases.map((alias) => [alias.id, [alias.nameAr, alias.nameEn]]))).toEqual({
        'a-ar': ['ميرا الصغيرة', null],
        'a-both': ['ميرا تشان', 'Mira-chan'],
        'a-digits': ['007', '007'],
        'a-digits-en': [null, '42'],
        'a-en': [null, 'Little Mira'],
        'a-quote': [null, "D'Art"],
      });
      const columns = await client.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'KeywordAlias' AND column_name = 'name'`,
      );
      expect(columns).toEqual([]);

      const [novel] = await client.$queryRawUnsafe<{ nameEn: string; descriptionEn: string; slugs: string[] }[]>(
        'SELECT "nameEn", "descriptionEn", slugs FROM "Novel"',
      );
      expect(novel).toEqual({ nameEn: 'D\'Artagnan "Tales"', descriptionEn: '<b>bold</b>', slugs: ["it's"] });
      const [keyword] = await client.$queryRawUnsafe<{ nameEn: string }[]>(`SELECT "nameEn" FROM "Keyword" WHERE id = 'k2'`);
      expect(keyword?.nameEn).toBe("O'Brien");
      const [replacement] = await client.$queryRawUnsafe<{ from: string; to: string }[]>('SELECT "from", "to" FROM "Replacement"');
      expect(replacement).toEqual({ from: "D'Art", to: "D'Artagnan" });
      const [version] = await client.$queryRawUnsafe<{ description: string }[]>('SELECT description FROM "KeywordVersion"');
      expect(version?.description).toBe('a < b');
      const [category] = await client.$queryRawUnsafe<{ nameEn: string }[]>('SELECT "nameEn" FROM "KeywordCategory"');
      expect(category?.nameEn).toBe("Hero's");
      await client.$disconnect();
    } finally {
      const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);

  live('preserves legacy keyword and alias descriptions in the matching language', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'storylens-description-migration-'));
    const name = `storylens_desctest_${process.pid}`;
    let client: PrismaClient | undefined;
    try {
      await prepare(name, workdir, (migration) => migration < '20261014125105_localized_keyword_descriptions');
      client = await seed(name, [
        ...baseRows,
        `INSERT INTO "KeywordAlias" (id, "nameEn", description, "keywordId", "updatedAt") VALUES ('desc-ar', 'Arabic description', 'وصف عربي', 'k1', now()), ('desc-en', 'English description', 'Chapter ١٢', 'k1', now())`,
      ]);
      const result = deploy(name, workdir, () => true);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const rows = await client.$queryRawUnsafe<{ id: string; description: string; descriptionAr: string | null; descriptionEn: string | null }[]>(
        'SELECT id, description, "descriptionAr", "descriptionEn" FROM "KeywordAlias" ORDER BY id',
      );
      expect(rows).toEqual([
        { id: 'desc-ar', description: 'وصف عربي', descriptionAr: 'وصف عربي', descriptionEn: null },
        { id: 'desc-en', description: 'Chapter ١٢', descriptionAr: null, descriptionEn: 'Chapter ١٢' },
      ]);
      const versions = await client.$queryRawUnsafe<{ description: string; descriptionAr: string | null; descriptionEn: string | null }[]>(
        'SELECT description, "descriptionAr", "descriptionEn" FROM "KeywordVersion"',
      );
      expect(versions).toEqual([{ description: 'a &lt; b', descriptionAr: null, descriptionEn: 'a &lt; b' }]);
    } finally {
      await client?.$disconnect();
      const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);

  live('stops with a list when a backfill would duplicate an alias name', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'storylens-migrations-'));
    const name = `storylens_migtest_dup_${process.pid}`;
    try {
      await prepare(name, workdir, (migration) => migration < FIRST_NEW);
      const client = await seed(name, [
        ...baseRows,
        // The first alias's English translation equals the second alias's name.
        `INSERT INTO "KeywordAlias" (id, name, "nameAr", "nameEn", "keywordId", "updatedAt") VALUES
          ('d1', 'ميرا', 'ميرا', 'Twin', 'k1', now()),
          ('d2', 'Twin', NULL, NULL, 'k1', now())`,
      ]);
      await client.$disconnect();
      const result = deploy(name, workdir, () => true);
      expect(result.exitCode).not.toBe(0);
      const output = result.stdout.toString() + result.stderr.toString();
      expect(output).toContain('Alias names need fixing');
      expect(output).toContain('duplicate English alias');
    } finally {
      const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('word VFX migration', () => {
  live('preserves saved keyword and alias effects while adding nullable colors and enum storage', async () => {
    const migration = '20261016163040_word_vfx_color';
    const workdir = mkdtempSync(join(tmpdir(), 'storylens-word-vfx-migration-'));
    const name = `storylens_vfx_migtest_${process.pid}`;
    let client: PrismaClient | undefined;
    try {
      await prepare(name, workdir, entry => entry < migration);
      client = await seed(name, [
        ...baseRows,
        `UPDATE "Keyword" SET "wordVfx" = 'SPARKLES' WHERE id = 'k1'`,
        `INSERT INTO "KeywordAlias" (id, "nameEn", "keywordId", "wordVfx", "updatedAt") VALUES ('vfx-alias', 'Sword', 'k1', 'HEAT', now())`,
      ]);
      expect(deploy(name, workdir, entry => entry <= migration).exitCode).toBe(0);
      const keyword = await client.$queryRawUnsafe<{ wordVfx: string; wordVfxColor: string | null }[]>(
        `SELECT "wordVfx", "wordVfxColor" FROM "Keyword" WHERE id = 'k1'`,
      );
      const alias = await client.$queryRawUnsafe<{ wordVfx: string; wordVfxColor: string | null }[]>(
        `SELECT "wordVfx", "wordVfxColor" FROM "KeywordAlias" WHERE id = 'vfx-alias'`,
      );
      expect(keyword).toEqual([{ wordVfx: 'SPARKLES', wordVfxColor: null }]);
      expect(alias).toEqual([{ wordVfx: 'HEAT', wordVfxColor: null }]);
      const columns = await client.$queryRawUnsafe<{ table_name: string; udt_name: string }[]>(
        `SELECT table_name, udt_name FROM information_schema.columns WHERE table_name IN ('Keyword', 'KeywordAlias') AND column_name = 'wordVfx' ORDER BY table_name`,
      );
      expect(columns).toEqual([{ table_name: 'Keyword', udt_name: 'WordVfx' }, { table_name: 'KeywordAlias', udt_name: 'WordVfx' }]);
    } finally {
      await client?.$disconnect();
      const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('chapter artwork consolidation', () => {
  live('moves image URLs, descriptions, leases and keyword links into canonical chapters', async () => {
    const migration = '20261017000000_chapter_context';
    const workdir = mkdtempSync(join(tmpdir(), 'storylens-chapter-migration-'));
    const name = `storylens_chapter_migtest_${process.pid}`;
    let client: PrismaClient | undefined;
    try {
      await prepare(name, workdir, entry => entry < migration);
      client = await seed(name, [
        ...baseRows,
        `INSERT INTO "File" (id, url, type, provider_image_id, delete_url, "updatedAt") VALUES ('cover-image', 'https://images.example.invalid/retained.png', 'Image', 'cover-image', '', now())`,
        `INSERT INTO "Chapter" (id, name, number, description, "novelId", "createdAt", "updatedAt") VALUES
          ('chapter-first', 'The shrine', 5, NULL, 'n1', '2026-10-15', now()),
          ('chapter-duplicate', 'Shrine', 5, 'Mira reaches the shrine.', 'n1', '2026-10-16', now())`,
        `INSERT INTO "KeywordsChapters" (id, "keywordId", "chapterId", "updatedAt") VALUES ('retained-link', 'k1', 'chapter-duplicate', now())`,
        `INSERT INTO "ChapterCover" (id, "novelId", "chapterNumber", "imageId", "leaseToken", "leaseExpiresAt", "updatedAt") VALUES
          ('cover-existing', 'n1', 5, 'cover-image', NULL, NULL, now()),
          ('cover-detected', 'n1', 0, 'cover-image', NULL, NULL, now()),
          ('cover-pending', 'n1', 6, NULL, 'retained-lease', '2027-01-01', now())`,
      ]);
      const result = deploy(name, workdir, () => true);
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      const chapters = await client.chapter.findMany({ where: { novelId: 'n1' }, include: { image: true }, orderBy: { number: 'asc' } });
      expect(chapters.map(chapter => chapter.number)).toEqual([0, 5, 6]);
      expect(chapters.slice(0, 2).map(chapter => chapter.image?.url)).toEqual(['https://images.example.invalid/retained.png', 'https://images.example.invalid/retained.png']);
      expect(chapters[1]?.id).toBe('chapter-first');
      expect(chapters[1]?.context).toEqual({ schemaVersion: 1, summary: 'Mira reaches the shrine.', scenes: [], stateChanges: [] });
      expect((await client.keywordsChapters.findUniqueOrThrow({ where: { id: 'retained-link' } })).chapterId).toBe('chapter-first');
      expect(chapters[2]?.coverLeaseToken).toBe('retained-lease');
      expect(chapters[2]?.coverLeaseExpiresAt?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
      expect(await client.$queryRawUnsafe<{ table_name: string }[]>(`SELECT table_name FROM information_schema.tables WHERE table_name = 'ChapterCover'`)).toEqual([]);
      expect(await client.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Chapter' AND column_name = 'description'`)).toEqual([]);
      expect((await client.aiFeaturePrice.findUniqueOrThrow({ where: { key: 'chapter_context' } })).enabled).toBe(true);
    } finally {
      await client?.$disconnect();
      const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('image description migration', () => {
  live('preserves existing descriptions and synchronizes legacy and new column writes', async () => {
    const migration = '20261024104847_image_descriptions';
    const workdir = mkdtempSync(join(tmpdir(), 'storylens-image-description-migration-'));
    const name = `storylens_description_migtest_${process.pid}`;
    let client: PrismaClient | undefined;
    try {
      await prepare(name, workdir, entry => entry < migration);
      client = await seed(name, [
        `INSERT INTO "Novel" (id, "nameEn", "updatedAt") VALUES ('description-novel', 'Migration Novel', now())`,
        `INSERT INTO "Keyword" (id, "nameEn", "novelId", "updatedAt") VALUES ('description-keyword', 'Mira', 'description-novel', now())`,
        `INSERT INTO "Chapter" (id, number, "novelId", "imagePrompt", "updatedAt") VALUES ('description-chapter', 1, 'description-novel', 'Saved chapter illustration.', now())`,
        `INSERT INTO "KeywordAlias" (id, "nameEn", "keywordId", "imagePrompt", "updatedAt") VALUES ('description-alias', 'Scout', 'description-keyword', 'Saved alias illustration.', now())`,
        `INSERT INTO "KeywordVersion" (id, "startingChapter", "keywordId", "imagePrompt", "updatedAt") VALUES ('description-version', 0, 'description-keyword', 'Saved version illustration.', now())`,
      ]);
      const deployed = deploy(name, workdir, () => true);
      expect(deployed.exitCode, deployed.stderr.toString()).toBe(0);
      for (const [table, id, text] of [
        ['Chapter', 'description-chapter', 'Saved chapter illustration.'],
        ['KeywordAlias', 'description-alias', 'Saved alias illustration.'],
        ['KeywordVersion', 'description-version', 'Saved version illustration.'],
      ] as const) {
        const read = () => client!.$queryRawUnsafe<{ imageDescription: string | null; imagePrompt: string | null }[]>(`SELECT "imageDescription", "imagePrompt" FROM "${table}" WHERE id = $1`, id);
        expect((await read())[0]).toEqual({ imageDescription: text, imagePrompt: text });
        await client.$executeRawUnsafe(`UPDATE "${table}" SET "imagePrompt" = 'Legacy edit' WHERE id = $1`, id);
        expect((await read())[0]?.imageDescription).toBe('Legacy edit');
        await client.$executeRawUnsafe(`UPDATE "${table}" SET "imageDescription" = 'New edit' WHERE id = $1`, id);
        expect((await read())[0]?.imagePrompt).toBe('New edit');
        await client.$executeRawUnsafe(`UPDATE "${table}" SET "imageDescription" = NULL WHERE id = $1`, id);
        expect((await read())[0]).toEqual({ imageDescription: null, imagePrompt: null });
      }
    } finally {
      await client?.$disconnect();
      const admin = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(workdir, { recursive: true, force: true });
    }
  }, 120_000);
});
