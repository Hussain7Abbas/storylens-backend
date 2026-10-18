import { expect, test } from 'bun:test';
import { prisma } from '@/lib/db';
import { DEFAULT_AI_INSTRUCTIONS } from '@/lib/ai/instructions';
import { CHAPTER_COVER_BRIEF_RULES } from '@/lib/ai/cloud/system-rules';
import { live } from './helpers/live-db';

const migration = await Bun.file(new URL('../prisma/migrations/20261018030000_cover_current_chapter_context/migration.sql', import.meta.url)).text();
const updated = migration.match(/\$cover_default\$([\s\S]*?)\$cover_default\$/)?.[1];
const previous = migration.match(/\$previous_cover\$([\s\S]*?)\$previous_cover\$/)?.[1];
const requirements = migration.match(/\$cover_requirements\$([\s\S]*?)\$cover_requirements\$/)?.[1];
if (!updated || !previous || !requirements) throw new Error('Invalid cover prompt migration');
const key = 'AI_Chapter_Cover_Prompt';

test('cover migration seeds the current default and Cloud enforces its scene requirements', () => {
 expect(updated).toBe(DEFAULT_AI_INSTRUCTIONS.chapterCoverPrompt);
 expect(requirements).toContain('current chapter context has finished generating');
 expect(CHAPTER_COVER_BRIEF_RULES).toContain('single most valuable scene');
 expect(CHAPTER_COVER_BRIEF_RULES).toContain('ready current-chapter context');
 expect(CHAPTER_COVER_BRIEF_RULES).toContain('Do not merge different moments');
});

live('cover prompt migration upgrades defaults and preserves customized instructions idempotently', async () => {
 const saved = await prisma.config.findUnique({where: {key}});
 const untouchedKey = `cover-migration-${crypto.randomUUID()}`;
 try {
  await prisma.config.create({data: {key: untouchedKey, value: 'Preserve unrelated config'}});
  await prisma.config.deleteMany({where: {key}});
  const apply = async () => {
   await prisma.$executeRawUnsafe(migration);
   return prisma.config.findUniqueOrThrow({where: {key}});
  };
  expect((await apply()).value).toBe(updated);
  for (const value of [' ', previous, updated]) {
   await prisma.config.update({where: {key}, data: {value}});
   expect((await apply()).value).toBe(updated);
  }
  const custom = 'Paint a portrait in watercolor.\nاحفظ أسلوبي';
  await prisma.config.update({where: {key}, data: {value: custom}});
  const revised = await apply();
  expect(revised.value).toBe(`${custom}\n\n${requirements}`);
  const repeated = await apply();
  expect(repeated.value).toBe(revised.value);
  expect(repeated.updatedAt.getTime()).toBeGreaterThan(revised.updatedAt.getTime());
  const full = 'x'.repeat(20000);
  await prisma.config.update({where: {key}, data: {value: full}});
  expect((await apply()).value).toBe(full);
  expect((await prisma.config.findUniqueOrThrow({where: {key: untouchedKey}})).value).toBe('Preserve unrelated config');
 } finally {
  await prisma.config.deleteMany({where: {key: {in: [key, untouchedKey]}}});
  if (saved) await prisma.config.create({data: saved});
 }
});
