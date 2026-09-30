import { Elysia, t } from 'elysia';
import {
  FilePlain,
  KeywordAliasPlain,
  KeywordCategoryPlain,
  KeywordNaturePlain,
  KeywordPlain,
  KeywordVersionPlain,
  NovelPlain,
  ReplacementPlain,
  WebsiteNovelBiasPlain,
  WebsiteSelectorPlain,
} from '@/lib/db';
import {
  currentCursor,
  deletedIds,
  FEED_DEFAULT_LIMIT,
  readFeed,
  SYNC_PROTOCOL_VERSION,
} from '@/lib/sync/feed';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';

const styleInclude = { category: true, nature: true, image: true } as const;

const styledChild = (plain: typeof KeywordAliasPlain | typeof KeywordVersionPlain) =>
  t.Object({
    ...plain.properties,
    category: t.Nullable(KeywordCategoryPlain),
    nature: t.Nullable(KeywordNaturePlain),
    image: t.Nullable(FilePlain),
  });

const novelShape = t.Composite([NovelPlain, t.Object({ image: t.Nullable(FilePlain) })]);
const deletedShape = t.Array(t.Object({ entity: t.String(), id: t.String() }));
const feedQuery = t.Object({
  since: t.Optional(t.Numeric({ minimum: 0 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: FEED_DEFAULT_LIMIT })),
});

/**
 * Sync endpoints: the protocol version the extension checks before sending,
 * and change feeds (`seq` cursors over `SyncChange`) for delta refreshes. Feeds
 * return the current rows of changed IDs in every language (they ignore
 * `Accept-Language`) and list IDs that no longer exist in `deleted`. Without
 * `since` they return only the cursor a full pull starts from.
 */
export const sync = new Elysia({ prefix: '/sync', tags: ['Sync'] })
  .use(setup)
  .use(authorize('user'))

  .get('/protocol', () => ({ version: SYNC_PROTOCOL_VERSION }), {
    response: { 200: t.Object({ version: t.Number() }) },
  })

  .get(
    '/novels/:id/changes',
    async ({ prisma, t: translate, params: { id }, query }) => {
      const empty = { keywords: [], aliases: [], versions: [], replacements: [], biases: [], deleted: [] };
      if (query.since === undefined) return { ...empty, cursor: await currentCursor(prisma), hasMore: false };

      const page = await readFeed(prisma, { novelId: id }, query.since, query.limit ?? FEED_DEFAULT_LIMIT, translate);
      const { ids } = page;
      const [novel, keywords, aliases, versions, replacements, biases] = await Promise.all([
        ids.novel.includes(id) ? prisma.novel.findUnique({ where: { id }, include: { image: true } }) : null,
        prisma.keyword.findMany({ where: { id: { in: ids.keyword }, novelId: id } }),
        prisma.keywordAlias.findMany({ where: { id: { in: ids.keywordAlias }, keyword: { novelId: id } }, include: styleInclude }),
        prisma.keywordVersion.findMany({ where: { id: { in: ids.keywordVersion }, keyword: { novelId: id } }, include: styleInclude }),
        prisma.replacement.findMany({ where: { id: { in: ids.replacement }, novelId: id }, include: { keyword: true } }),
        prisma.websiteNovelBias.findMany({ where: { id: { in: ids.websiteNovelBias }, novelId: id }, include: { websiteSelector: true } }),
      ]);

      return {
        ...(novel ? { novel } : {}),
        keywords,
        aliases,
        versions,
        replacements,
        biases,
        deleted: [
          ...(ids.novel.includes(id) && !novel ? [{ entity: 'novel', id }] : []),
          ...deletedIds('keyword', ids.keyword, keywords),
          ...deletedIds('keywordAlias', ids.keywordAlias, aliases),
          ...deletedIds('keywordVersion', ids.keywordVersion, versions),
          ...deletedIds('replacement', ids.replacement, replacements),
          ...deletedIds('websiteNovelBias', ids.websiteNovelBias, biases),
        ],
        cursor: page.cursor,
        hasMore: page.hasMore,
      };
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      query: feedQuery,
      response: {
        200: t.Object({
          novel: t.Optional(novelShape),
          keywords: t.Array(KeywordPlain),
          aliases: t.Array(styledChild(KeywordAliasPlain)),
          versions: t.Array(styledChild(KeywordVersionPlain)),
          replacements: t.Array(t.Composite([ReplacementPlain, t.Object({ keyword: t.Nullable(KeywordPlain) })])),
          biases: t.Array(t.Composite([WebsiteNovelBiasPlain, t.Object({ websiteSelector: WebsiteSelectorPlain })])),
          deleted: deletedShape,
          cursor: t.Number(),
          hasMore: t.Boolean(),
        }),
      },
    },
  )

  .get(
    '/lookups/changes',
    async ({ prisma, t: translate, query }) => {
      if (query.since === undefined) {
        return { categories: [], natures: [], deleted: [], cursor: await currentCursor(prisma), hasMore: false };
      }

      const page = await readFeed(
        prisma,
        { entities: ['keywordCategory', 'keywordNature'] },
        query.since,
        query.limit ?? FEED_DEFAULT_LIMIT,
        translate,
      );
      const [categories, natures] = await Promise.all([
        prisma.keywordCategory.findMany({ where: { id: { in: page.ids.keywordCategory } } }),
        prisma.keywordNature.findMany({ where: { id: { in: page.ids.keywordNature } } }),
      ]);

      return {
        categories,
        natures,
        deleted: [
          ...deletedIds('keywordCategory', page.ids.keywordCategory, categories),
          ...deletedIds('keywordNature', page.ids.keywordNature, natures),
        ],
        cursor: page.cursor,
        hasMore: page.hasMore,
      };
    },
    {
      query: feedQuery,
      response: {
        200: t.Object({
          categories: t.Array(KeywordCategoryPlain),
          natures: t.Array(KeywordNaturePlain),
          deleted: deletedShape,
          cursor: t.Number(),
          hasMore: t.Boolean(),
        }),
      },
    },
  )

  .get(
    '/catalogue/changes',
    async ({ prisma, t: translate, query }) => {
      if (query.since === undefined) return { novels: [], deleted: [], cursor: await currentCursor(prisma), hasMore: false };

      const page = await readFeed(prisma, { entities: ['novel'] }, query.since, query.limit ?? FEED_DEFAULT_LIMIT, translate);
      const novels = await prisma.novel.findMany({ where: { id: { in: page.ids.novel } }, include: { image: true } });

      return {
        novels,
        deleted: deletedIds('novel', page.ids.novel, novels),
        cursor: page.cursor,
        hasMore: page.hasMore,
      };
    },
    {
      query: feedQuery,
      response: {
        200: t.Object({
          novels: t.Array(novelShape),
          deleted: deletedShape,
          cursor: t.Number(),
          hasMore: t.Boolean(),
        }),
      },
    },
  );
