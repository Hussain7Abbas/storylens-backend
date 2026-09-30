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
