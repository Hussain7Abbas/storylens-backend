/**
 * script — extracts seed data from the legacy JSON export.
 * Run: bun packages/db/prisma/seed/scripts/extract-seed-legacy-data.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const DATA_DIR = join(ROOT, 'data');
const SOURCE_FILE = join(DATA_DIR, 'characters replaces settings.json');

type SourceCharacter = {
  color: string;
  img: string;
  info: string;
  name: string;
  role: string;
  timestamp?: number;
};

type SourceReplace = {
  name: string;
  with: string;
};

type SourceNovel = {
  characters: Record<string, SourceCharacter>;
  replaces: Record<string, SourceReplace>;
  settings: { last_modified: string };
};

type SourceData = Record<string, SourceNovel>;

type SeedNovel = {
  name: string;
  slugs: string[];
  lastModified: string;
};

type SeedKeyword = {
  novelName: string;
  name: string;
  description: string;
  color: string;
  imageUrl: string;
  role: string;
  timestamp?: number;
};

type SeedReplacement = {
  novelName: string;
  from: string;
  to: string;
};

function writeTsFile(filename: string, content: string): void {
  const path = join(DATA_DIR, filename);
  writeFileSync(path, content, 'utf8');
  console.log(`  wrote ${filename}`);
}

function serializeExport<T>(exportName: string, typeName: string, data: T): string {
  return `import type { ${typeName} } from './types';

export const ${exportName}: ${typeName}[] = ${JSON.stringify(data, null, 2)};
`;
}

const raw = readFileSync(SOURCE_FILE, 'utf8');
const source = JSON.parse(raw) as SourceData;

const novels: SeedNovel[] = [];
const keywords: SeedKeyword[] = [];
const replacements: SeedReplacement[] = [];

for (const [slug, novel] of Object.entries(source)) {
  novels.push({
    name: slug,
    slugs: [slug],
    lastModified: novel.settings.last_modified,
  });

  for (const character of Object.values(novel.characters)) {
    const keyword: SeedKeyword = {
      novelName: slug,
      name: character.name,
      description: character.info,
      color: character.color,
      imageUrl: character.img,
      role: character.role,
    };

    if (character.timestamp !== undefined) {
      keyword.timestamp = character.timestamp;
    }

    keywords.push(keyword);
  }

  for (const replacement of Object.values(novel.replaces)) {
    replacements.push({
      novelName: slug,
      from: replacement.name,
      to: replacement.with,
    });
  }
}

mkdirSync(dirname(SOURCE_FILE), { recursive: true });

console.log('Extracting seed data...');
console.log(`  ${novels.length} novels`);
console.log(`  ${keywords.length} keywords (characters)`);
console.log(`  ${replacements.length} replacements`);

writeTsFile(
  'types.ts',
  `export type SeedNovel = {
  name: string;
  slugs: string[];
  lastModified: string;
};

export type SeedKeyword = {
  novelName: string;
  name: string;
  description: string;
  color: string;
  imageUrl: string;
  /** Legacy field — use mapLegacyRole() to resolve category + nature */
  role: string;
  timestamp?: number;
};

export type SeedReplacement = {
  novelName: string;
  from: string;
  to: string;
};

export type SeedKeywordCategory = {
  name: string;
  color: string;
};

export type SeedKeywordNature = {
  name: string;
  color: string;
};

export type KeywordCategoryName = 'انثى' | 'بطل' | 'ذكر' | 'سيد';

export type KeywordNatureName = 'عدو' | 'صديق' | 'بطل';

export type LegacyRoleMapping = {
  category: KeywordCategoryName;
  nature: KeywordNatureName;
};
`,
);

writeTsFile('novels.ts', serializeExport('seedNovels', 'SeedNovel', novels));
writeTsFile('keywords.ts', serializeExport('seedKeywords', 'SeedKeyword', keywords));
writeTsFile(
  'replacements.ts',
  serializeExport('seedReplacements', 'SeedReplacement', replacements),
);

console.log('Done.');
