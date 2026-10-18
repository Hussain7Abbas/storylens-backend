import { expect, test } from 'bun:test';
import { prisma } from '@/lib/db';
import { DEFAULT_AI_INSTRUCTIONS } from '@/lib/ai/instructions';
import { systemRules } from '@/lib/ai/cloud/system-rules';
import { live } from './helpers/live-db';

const migration = await Bun.file(
  new URL(
    '../prisma/migrations/20261018040000_compact_visual_context/migration.sql',
    import.meta.url,
  ),
).text();
const updated = migration.match(
  /\$context_default\$([\s\S]*?)\$context_default\$/,
)?.[1];
const previous = migration.match(
  /\$previous_context\$([\s\S]*?)\$previous_context\$/,
)?.[1];
const requirements = migration.match(
  /\$context_requirements\$([\s\S]*?)\$context_requirements\$/,
)?.[1];
if (!updated || !previous || !requirements)
  throw new Error('Invalid context prompt migration');
const key = 'AI_Chapter_Context_Prompt';

test('context migration seeds the compact visual default and Cloud enforces visual-only output', () => {
  expect(updated).toBe(DEFAULT_AI_INSTRUCTIONS.chapterContextPrompt);
  expect(requirements).toContain('lastSeenChapter');
  expect(systemRules('chapter_context', 'en')).toContain(
    'compact and visual-only',
  );
  expect(systemRules('chapter_context', 'en')).toContain('60,000 characters');
  expect(systemRules('page_summary', 'en')).not.toContain('60,000 characters');
});

live(
  'context prompt migration upgrades defaults and preserves customized instructions idempotently',
  async () => {
    const saved = await prisma.config.findUnique({ where: { key } });
    const untouchedKey = `context-migration-${crypto.randomUUID()}`;
    try {
      await prisma.config.create({
        data: { key: untouchedKey, value: 'Preserve unrelated config' },
      });
      await prisma.config.deleteMany({ where: { key } });
      const apply = async () => {
        await prisma.$executeRawUnsafe(migration);
        return prisma.config.findUniqueOrThrow({ where: { key } });
      };
      expect((await apply()).value).toBe(updated);
      for (const value of [' ', previous, updated]) {
        await prisma.config.update({ where: { key }, data: { value } });
        expect((await apply()).value).toBe(updated);
      }
      const custom = 'Paint a portrait in watercolor.\nاحفظ أسلوبي';
      await prisma.config.update({ where: { key }, data: { value: custom } });
      const revised = await apply();
      expect(revised.value).toBe(`${custom}\n\n${requirements}`);
      const repeated = await apply();
      expect(repeated.value).toBe(revised.value);
      expect(repeated.updatedAt.getTime()).toBeGreaterThan(
        revised.updatedAt.getTime(),
      );
      const full = 'x'.repeat(20000);
      await prisma.config.update({ where: { key }, data: { value: full } });
      expect((await apply()).value).toBe(full);
      expect(
        (
          await prisma.config.findUniqueOrThrow({
            where: { key: untouchedKey },
          })
        ).value,
      ).toBe('Preserve unrelated config');
    } finally {
      await prisma.config.deleteMany({
        where: { key: { in: [key, untouchedKey] } },
      });
      if (saved) await prisma.config.create({ data: saved });
    }
  },
);
