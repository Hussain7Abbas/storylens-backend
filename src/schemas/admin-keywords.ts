import type { Prisma } from '@prisma/client';
import { t } from 'elysia';
import { FilePlain, KeywordAliasPlain, KeywordCategoryPlain, KeywordNaturePlain, KeywordPlain, KeywordVersionPlain } from '@/lib/db';

/** Category, nature and image of an alias or version. */
export const styleInclude = { category: true, nature: true, image: true } as const;

export const keywordDetailInclude = {
  createdBy: { select: { id: true, username: true } },
  aliases: { include: styleInclude, orderBy: { createdAt: 'asc' } },
  versions: { include: styleInclude, orderBy: { startingChapter: 'asc' } },
} satisfies Prisma.KeywordInclude;

const styleSchema = {
  category: t.Nullable(KeywordCategoryPlain),
  nature: t.Nullable(KeywordNaturePlain),
  image: t.Nullable(FilePlain),
};

export const adminAliasSchema = t.Composite([KeywordAliasPlain, t.Object(styleSchema)]);

export const adminVersionSchema = t.Composite([KeywordVersionPlain, t.Object(styleSchema)]);

/** A keyword with everything the novel profile shows: versions, aliases and who added it. */
export const adminKeywordDetailSchema = t.Composite([
  KeywordPlain,
  t.Object({
    createdBy: t.Nullable(t.Object({ id: t.String(), username: t.String() })),
    aliases: t.Array(adminAliasSchema),
    versions: t.Array(adminVersionSchema),
  }),
]);

/** Fields an alias or version shares; `null` clears one. */
export const styleBody = {
  description: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
  categoryId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
  natureId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
  imageId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
};
