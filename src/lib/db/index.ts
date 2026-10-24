import { t } from 'elysia';
import { deprecate } from '@/lib/compat/deprecation';
import { KeywordAliasPlain as GeneratedAlias, KeywordVersionPlain as GeneratedVersion } from '../../../prisma/generated/prismabox/barrel';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '../../../prisma/generated/prismabox/barrel';

export { PublicChapter as ChapterPlain } from '../chapter-context/public';

// Keep old response fields available without requiring new clients to construct them.
const legacyImagePrompt = t.Optional(deprecate(t.Nullable(t.String()), {
  since: '2026-10-24', removeAfter: '2027-04-30', replacement: 'imageDescription',
}));
export const KeywordAliasPlain = t.Object({ ...GeneratedAlias.properties, imagePrompt: legacyImagePrompt });
export const KeywordVersionPlain = t.Object({ ...GeneratedVersion.properties, imagePrompt: legacyImagePrompt });
