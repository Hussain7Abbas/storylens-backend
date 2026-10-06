import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { prisma } from '@/lib/db';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

/**
 * Translation links: saving a keyword or alias with `translationKeywordId` /
 * `translationAliasId` merges the row that holds its other-language name into
 * it. The extension mirrors every rule here in `rules/validation.ts`.
 */

type Row = { id: string; updatedAt: string; [key: string]: unknown };
type ErrorBody = { message: string; code?: string };

const marker = crypto.randomUUID().slice(0, 8);
const ids = { novels: [] as string[], users: [] as string[], categories: [] as string[], natures: [] as string[] };
let owner: Actor;
let other: Actor;
let moderator: Actor;
let novelId: string;
let otherNovelId: string;
let categoryId: string;
let natureId: string;

async function createKeyword(actor: Actor, names: { nameAr?: string; nameEn?: string }, novel = novelId) {
  const body = {
    id: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    ...names,
    novelId: novel,
    categoryId,
    natureId,
  };
  const result = await call<Row & { aliases: Row[]; versions: Row[] }>(actor, 'POST', '/keywords', body);
  expect(result.status).toBe(200);
  return result.body;
}

async function createAlias(actor: Actor, keywordId: string, names: { nameAr?: string; nameEn?: string }) {
  const result = await call<Row>(actor, 'POST', '/keyword-aliases', {
    id: crypto.randomUUID(),
    keywordId,
    ...names,
  });
  expect(result.status).toBe(200);
  return result.body;
}

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  [owner, other, moderator] = await Promise.all([
    makeActor('reader', marker),
    makeActor('reader', marker),
    makeActor('moderator', marker),
  ]);
  ids.users.push(owner.id, other.id, moderator.id);
  const [novel, otherNovel] = await Promise.all([
    prisma.novel.create({ data: { nameEn: `Link ${marker}`, createdById: owner.id } }),
    prisma.novel.create({ data: { nameEn: `Other ${marker}`, createdById: owner.id } }),
  ]);
  novelId = novel.id;
  otherNovelId = otherNovel.id;
  ids.novels.push(novel.id, otherNovel.id);
  const styles = await makeStyles(marker);
  categoryId = styles.category.id;
  natureId = styles.nature.id;
  ids.categories.push(categoryId);
  ids.natures.push(natureId);
});

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await cleanup(ids);
});

describe('keyword translation links', () => {
  live('merges the other language’s keyword, its aliases and its replacements into the saved one', async () => {
    const target = await createKeyword(owner, { nameAr: `هدف ${marker}` });
    const source = await createKeyword(owner, { nameEn: `Source ${marker}` });
    await createAlias(owner, source.id, { nameEn: `Source alias ${marker}` });
    const replacement = await call<Row>(owner, 'POST', '/replacements', {
      id: crypto.randomUUID(),
      novelId,
      from: `From ${marker}`,
      to: `Source ${marker}`,
    });
    expect(replacement.status).toBe(200);

    const saved = await call<Row & { aliases: Row[] }>(owner, 'PUT', `/keywords/${target.id}`, {
      baseUpdatedAt: target.updatedAt,
      translationKeywordId: source.id,
    });

    expect(saved.status).toBe(200);
    expect(saved.body.nameAr).toBe(`هدف ${marker}`);
    expect(saved.body.nameEn).toBe(`Source ${marker}`);
    expect(saved.body.aliases.map((alias) => alias.nameEn)).toContain(`Source alias ${marker}`);
    expect(await prisma.keyword.findUnique({ where: { id: source.id } })).toBeNull();
    expect(await prisma.replacement.findUnique({ where: { id: replacement.body.id } })).toMatchObject({
      keywordId: target.id,
    });
  });

  live('links while creating a keyword', async () => {
    const source = await createKeyword(owner, { nameEn: `Created source ${marker}` });
    const created = await call<Row>(owner, 'POST', '/keywords', {
      id: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      nameAr: `مرتبط ${marker}`,
      novelId,
      categoryId,
      natureId,
      translationKeywordId: source.id,
    });

    expect(created.status).toBe(200);
    expect(created.body.nameAr).toBe(`مرتبط ${marker}`);
    expect(created.body.nameEn).toBe(`Created source ${marker}`);
    expect(await prisma.keyword.findUnique({ where: { id: source.id } })).toBeNull();
  });

  live('ignores a translation that no longer exists, so a replayed write succeeds', async () => {
    const target = await createKeyword(owner, { nameAr: `منفرد ${marker}` });
    const saved = await call<Row>(owner, 'PUT', `/keywords/${target.id}`, {
      baseUpdatedAt: target.updatedAt,
      translationKeywordId: crypto.randomUUID(),
    });
    expect(saved.status).toBe(200);
    expect(saved.body.nameAr).toBe(`منفرد ${marker}`);
    expect(saved.body.nameEn).toBeNull();
  });

  live('refuses itself, another novel, a second name in one language and a versioned source', async () => {
    const target = await createKeyword(owner, { nameAr: `قواعد ${marker}` });
    const foreign = await createKeyword(owner, { nameEn: `Foreign ${marker}` }, otherNovelId);
    const sameLanguage = await createKeyword(owner, { nameAr: `لغة ${marker}` });
    const versioned = await createKeyword(owner, { nameEn: `Versioned ${marker}` });
    await prisma.keywordVersion.create({
      data: { keywordId: versioned.id, startingChapter: 5, createdById: owner.id },
    });

    const attempt = (translationKeywordId: string) =>
      call<ErrorBody>(owner, 'PUT', `/keywords/${target.id}`, {
        baseUpdatedAt: target.updatedAt,
        translationKeywordId,
      });

    expect(await attempt(target.id)).toMatchObject({ status: 409, body: { code: 'TRANSLATION_SELF' } });
    expect(await attempt(foreign.id)).toMatchObject({ status: 409, body: { code: 'TRANSLATION_OTHER_NOVEL' } });
    expect(await attempt(sameLanguage.id)).toMatchObject({
      status: 409,
      body: { code: 'TRANSLATION_SAME_LANGUAGE' },
    });
    expect(await attempt(versioned.id)).toMatchObject({
      status: 409,
      body: { code: 'TRANSLATION_HAS_VERSIONS' },
    });
    // Every refusal rolled back: the keywords are untouched.
    expect(await prisma.keyword.count({ where: { id: { in: [foreign.id, sameLanguage.id, versioned.id] } } })).toBe(3);
    expect(await prisma.keyword.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ nameEn: null });
  });

  live('absorbs only a keyword the reader may delete; a moderator may absorb any', async () => {
    const target = await createKeyword(owner, { nameAr: `ملكية ${marker}` });
    const theirs = await createKeyword(other, { nameEn: `Theirs ${marker}` });
    const refused = await call<ErrorBody>(owner, 'PUT', `/keywords/${target.id}`, {
      baseUpdatedAt: target.updatedAt,
      translationKeywordId: theirs.id,
    });
    expect(refused.status).toBe(403);
    expect(await prisma.keyword.findUnique({ where: { id: theirs.id } })).not.toBeNull();

    const current = await prisma.keyword.findUniqueOrThrow({ where: { id: target.id } });
    const allowed = await call<Row>(moderator, 'PUT', `/keywords/${target.id}`, {
      baseUpdatedAt: current.updatedAt.toISOString(),
      translationKeywordId: theirs.id,
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.nameEn).toBe(`Theirs ${marker}`);
    expect(await prisma.keyword.findUnique({ where: { id: theirs.id } })).toBeNull();
  });
});

describe('alias translation links', () => {
  live('merges a sibling alias named in the other language into the saved one', async () => {
    const keyword = await createKeyword(owner, { nameAr: `صاحب ${marker}`, nameEn: `Holder ${marker}` });
    const target = await createAlias(owner, keyword.id, { nameAr: `كنية ${marker}` });
    const source = await createAlias(owner, keyword.id, { nameEn: `Nickname ${marker}` });

    const saved = await call<Row>(owner, 'PUT', `/keyword-aliases/${target.id}`, {
      baseUpdatedAt: target.updatedAt,
      translationAliasId: source.id,
    });

    expect(saved.status).toBe(200);
    expect(saved.body.nameAr).toBe(`كنية ${marker}`);
    expect(saved.body.nameEn).toBe(`Nickname ${marker}`);
    expect(await prisma.keywordAlias.findUnique({ where: { id: source.id } })).toBeNull();
  });

  live('links while creating an alias', async () => {
    const keyword = await createKeyword(owner, { nameAr: `منشئ ${marker}`, nameEn: `Creator ${marker}` });
    const source = await createAlias(owner, keyword.id, { nameEn: `Created nickname ${marker}` });
    const created = await call<Row>(owner, 'POST', '/keyword-aliases', {
      id: crypto.randomUUID(),
      keywordId: keyword.id,
      nameAr: `كنية جديدة ${marker}`,
      translationAliasId: source.id,
    });

    expect(created.status).toBe(200);
    expect(created.body.nameEn).toBe(`Created nickname ${marker}`);
    expect(await prisma.keywordAlias.findUnique({ where: { id: source.id } })).toBeNull();
  });

  live('refuses an alias of another keyword, so no alias moves between keywords', async () => {
    const keyword = await createKeyword(owner, { nameAr: `أول ${marker}` });
    const otherKeyword = await createKeyword(owner, { nameEn: `Second ${marker}` });
    const target = await createAlias(owner, keyword.id, { nameAr: `كنية أولى ${marker}` });
    const foreign = await createAlias(owner, otherKeyword.id, { nameEn: `Second nickname ${marker}` });

    const refused = await call<ErrorBody>(owner, 'PUT', `/keyword-aliases/${target.id}`, {
      baseUpdatedAt: target.updatedAt,
      translationAliasId: foreign.id,
    });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('TRANSLATION_OTHER_KEYWORD');
    expect(await prisma.keywordAlias.findUniqueOrThrow({ where: { id: foreign.id } })).toMatchObject({
      keywordId: otherKeyword.id,
    });
  });
});
