import { afterAll, beforeAll, describe, expect } from 'bun:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { MIN_CLIENT_VERSIONS } from '@/lib/compat/client-version';
import { toPrismaHttpError } from '@/lib/sync/prisma-errors';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

type Row = { id: string; updatedAt: string; [key: string]: unknown };
type ErrorBody = { message: string; code?: string; current?: Row };

const marker = crypto.randomUUID().slice(0, 8);
const ids = { novels: [] as string[], users: [] as string[], categories: [] as string[], natures: [] as string[] };
let owner: Actor;
let other: Actor;
let third: Actor;
let moderator: Actor;
let guest: Actor;
let novelId: string;
let categoryId: string;
let natureId: string;

async function createKeyword(actor: Actor, nameEn: string, extra: Record<string, unknown> = {}) {
  const body = {
    id: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    nameEn,
    novelId,
    categoryId,
    natureId,
    ...extra,
  };
  return { body, result: await call<Row & { versions: Row[]; aliases: Row[] }>(actor, 'POST', '/keywords', body) };
}

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  [owner, other, third, moderator, guest] = await Promise.all([
    makeActor('reader', marker),
    makeActor('reader', marker),
    makeActor('reader', marker),
    makeActor('moderator', marker),
    makeActor('guest', marker),
  ]);
  ids.users.push(owner.id, other.id, third.id, moderator.id, guest.id);
  const novel = await prisma.novel.create({ data: { nameEn: `Sync ${marker}`, createdById: owner.id } });
  novelId = novel.id;
  ids.novels.push(novel.id);
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

describe('client IDs and replays', () => {
  live('creates a keyword and its base version with the client IDs', async () => {
    const { body, result } = await createKeyword(owner, `Alpha ${marker}`);
    expect(result.status).toBe(200);
    expect(result.body.id).toBe(body.id);
    expect(result.body.versions.map((version) => version.id)).toEqual([body.versionId]);
  });

  live('returns the same row on a replay without a second version or a duplicate error', async () => {
    const { body, result } = await createKeyword(owner, `Replay ${marker}`);
    expect(result.status).toBe(200);
    const again = await call<Row & { versions: Row[] }>(owner, 'POST', '/keywords', body);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(body.id);
    expect(await prisma.keywordVersion.count({ where: { keywordId: body.id } })).toBe(1);
  });

  live('refuses an ID owned by another user or another novel', async () => {
    const { body } = await createKeyword(owner, `Owned ${marker}`);
    const byOther = await call<ErrorBody>(other, 'POST', '/keywords', { ...body, nameEn: `Owned 2 ${marker}` });
    expect(byOther.status).toBe(409);
    expect(byOther.body.code).toBe('ID_CONFLICT');

    const otherNovel = await prisma.novel.create({ data: { nameEn: `Other ${marker}` } });
    ids.novels.push(otherNovel.id);
    const inOtherNovel = await call<ErrorBody>(owner, 'POST', '/keywords', { ...body, novelId: otherNovel.id });
    expect(inOtherNovel.status).toBe(409);
    expect(inOtherNovel.body.code).toBe('ID_CONFLICT');
  });

  live('stores one row when two identical creates race', async () => {
    const body = {
      id: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      nameEn: `Race ${marker}`,
      novelId,
      categoryId,
      natureId,
    };
    const results = await Promise.all([
      call<Row>(owner, 'POST', '/keywords', body),
      call<Row>(owner, 'POST', '/keywords', body),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results.map((result) => result.body.id)).toEqual([body.id, body.id]);
    expect(await prisma.keyword.count({ where: { id: body.id } })).toBe(1);
  });

  live('replays version and replacement creates without repeating side effects', async () => {
    const { body: keyword } = await createKeyword(owner, `Versions ${marker}`);
    const version = { id: crypto.randomUUID(), keywordId: keyword.id, currentChapter: 10 };
    expect((await call(owner, 'POST', '/keyword-versions', version)).status).toBe(200);
    const later = { id: crypto.randomUUID(), keywordId: keyword.id, currentChapter: 20 };
    expect((await call(owner, 'POST', '/keyword-versions', later)).status).toBe(200);
    // Replaying the first create must not close the latest version again.
    const replay = await call<Row>(owner, 'POST', '/keyword-versions', version);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(version.id);
    const stored = await prisma.keywordVersion.findUniqueOrThrow({ where: { id: later.id } });
    expect(stored.endingChapter).toBeNull();
    expect(await prisma.keywordVersion.count({ where: { keywordId: keyword.id } })).toBe(3);

    const chainStart = { id: crypto.randomUUID(), novelId, from: `a-${marker}`, to: `b-${marker}` };
    expect((await call(owner, 'POST', '/replacements', chainStart)).status).toBe(200);
    const chainNext = { id: crypto.randomUUID(), novelId, from: `b-${marker}`, to: `c-${marker}` };
    expect((await call(owner, 'POST', '/replacements', chainNext)).status).toBe(200);
    expect((await prisma.replacement.findUniqueOrThrow({ where: { id: chainStart.id } })).to).toBe(`c-${marker}`);
    // Point the first one back; a replay of the second must not rewrite it again.
    await prisma.replacement.update({ where: { id: chainStart.id }, data: { to: `b-${marker}` } });
    expect((await call(owner, 'POST', '/replacements', chainNext)).status).toBe(200);
    expect((await prisma.replacement.findUniqueOrThrow({ where: { id: chainStart.id } })).to).toBe(`b-${marker}`);
  });

  live('serializes two new versions for the same chapter', async () => {
    const { body: keyword } = await createKeyword(owner, `Parallel versions ${marker}`);
    const results = await Promise.all([
      call(owner, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: keyword.id, currentChapter: 10 }),
      call(owner, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: keyword.id, currentChapter: 10 }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    const versions = await prisma.keywordVersion.findMany({ where: { keywordId: keyword.id }, orderBy: { startingChapter: 'asc' } });
    expect(versions.map((version) => [version.startingChapter, version.endingChapter])).toEqual([[0, 9], [10, null]]);
  });

  live('requires client IDs on creates and baseUpdatedAt on updates', async () => {
    const missingId = await call(owner, 'POST', '/keywords', { nameEn: `No id ${marker}`, novelId, categoryId, natureId });
    expect(missingId.status).toBe(422);
    const notUuid = await call(owner, 'POST', '/keyword-aliases', { id: 'temp-1', keywordId: crypto.randomUUID(), nameEn: 'x' });
    expect(notUuid.status).toBe(422);
    const { body } = await createKeyword(owner, `No base ${marker}`);
    const missingBase = await call(owner, 'PUT', `/keywords/${body.id}`, { nameEn: `No base 2 ${marker}` });
    expect(missingBase.status).toBe(422);
  });
});

describe('stale writes', () => {
  live('allows only one simultaneous update from a shared revision', async () => {
    const { body, result } = await createKeyword(owner, `Parallel stale ${marker}`);
    const baseUpdatedAt = result.body.updatedAt;
    const results = await Promise.all([
      call<ErrorBody>(owner, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt, nameEn: `Parallel A ${marker}` }),
      call<ErrorBody>(owner, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt, nameEn: `Parallel B ${marker}` }),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(results.find((item) => item.status === 409)?.body.code).toBe('STALE_WRITE');
    const future = await call<ErrorBody>(owner, 'PUT', `/keywords/${body.id}`, {
      baseUpdatedAt: new Date(Date.now() + 60_000).toISOString(), matchingType: 'PARTIAL',
    });
    expect([future.status, future.body.code]).toEqual([409, 'STALE_WRITE']);
  });
  live('accepts the current base and answers 409 with the current row for an older one', async () => {
    const { body, result } = await createKeyword(owner, `Stale ${marker}`);
    const base = result.body.updatedAt;
    const first = await call<Row>(owner, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: base, nameEn: `Stale 2 ${marker}` });
    expect(first.status).toBe(200);
    const stale = await call<ErrorBody>(owner, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: base, matchingType: 'PARTIAL' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_WRITE');
    const current = await call<Row>(owner, 'GET', `/keywords/${body.id}`);
    expect(stale.body.current?.id).toBe(body.id);
    expect(stale.body.current?.updatedAt).toBe(current.body.updatedAt);
    expect(stale.body.current?.nameEn).toBe(`Stale 2 ${marker}`);
  });

  live('checks ownership before staleness', async () => {
    const { body, result } = await createKeyword(owner, `Owner first ${marker}`);
    await call(owner, 'PUT', `/keywords/${body.id}`, { baseUpdatedAt: result.body.updatedAt, matchingType: 'PARTIAL' });
    const refused = await call<ErrorBody>(other, 'PUT', `/keywords/${body.id}`, {
      baseUpdatedAt: result.body.updatedAt,
      matchingType: 'FULL',
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('NOT_OWNER');
  });
});

describe('partial updates and clears', () => {
  live('defaults Arabic character variant matching on and persists strict keyword and alias settings', async () => {
    const { result } = await createKeyword(owner, `Arabic match ${marker}`, { nameAr: `أمل ${marker}` });
    expect(result.status).toBe(200);
    expect(result.body.fuzzyMatchArabicCharacters).toBe(true);

    const strict = await call<Row>(owner, 'PUT', `/keywords/${result.body.id}`, {
      baseUpdatedAt: result.body.updatedAt,
      fuzzyMatchArabicCharacters: false,
    });
    expect(strict.status).toBe(200);
    expect(strict.body.fuzzyMatchArabicCharacters).toBe(false);

    const alias = await call<Row>(owner, 'POST', '/keyword-aliases', {
      id: crypto.randomUUID(), keywordId: result.body.id, nameAr: `إمل ${marker}`,
      fuzzyMatchArabicCharacters: false,
    });
    expect(alias.status).toBe(200);
    expect(alias.body.fuzzyMatchArabicCharacters).toBe(false);
    expect((await prisma.keywordAlias.findUniqueOrThrow({ where: { id: alias.body.id } })).fuzzyMatchArabicCharacters).toBe(false);
  });

  live('updates only the sent replacement fields and checks the stored from', async () => {
    const created = await call<Row>(owner, 'POST', '/replacements', {
      id: crypto.randomUUID(),
      novelId,
      from: `p-from-${marker}`,
      to: `p-to-${marker}`,
      matchingType: 'PARTIAL',
    });
    const updated = await call<Row>(owner, 'PUT', `/replacements/${created.body.id}`, {
      baseUpdatedAt: created.body.updatedAt,
      to: `p-new-${marker}`,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.from).toBe(`p-from-${marker}`);
    expect(updated.body.to).toBe(`p-new-${marker}`);
    expect(updated.body.matchingType).toBe('PARTIAL');

    const clash = await call<Row>(owner, 'POST', '/replacements', {
      id: crypto.randomUUID(),
      novelId,
      from: `p-other-${marker}`,
      to: `p-x-${marker}`,
    });
    const taken = await call<ErrorBody>(owner, 'PUT', `/replacements/${clash.body.id}`, {
      baseUpdatedAt: clash.body.updatedAt,
      from: `p-from-${marker}`,
    });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('REPLACEMENT_EXISTS');
  });

  live('clears descriptions and images on version and alias updates', async () => {
    const image = await prisma.file.create({
      data: { url: `https://example.invalid/${marker}.png`, type: 'Image', provider_image_id: `p-${marker}`, delete_url: '-' },
    });
    const { body: keyword } = await createKeyword(owner, `Clear ${marker}`, { description: 'desc', imageId: image.id });
    const version = await prisma.keywordVersion.findUniqueOrThrow({ where: { id: keyword.versionId } });
    const clearedVersion = await call<Row>(owner, 'PUT', `/keyword-versions/${version.id}`, {
      baseUpdatedAt: version.updatedAt.toISOString(),
      description: null,
      imageId: null,
    });
    expect(clearedVersion.status).toBe(200);
    expect(clearedVersion.body.description).toBeNull();
    expect(clearedVersion.body.imageId).toBeNull();

    const alias = await call<Row>(owner, 'POST', '/keyword-aliases', {
      id: crypto.randomUUID(),
      keywordId: keyword.id,
      nameEn: `Clear alias ${marker}`,
      description: 'alias desc',
      imageId: image.id,
    });
    const clearedAlias = await call<Row>(owner, 'PUT', `/keyword-aliases/${alias.body.id}`, {
      baseUpdatedAt: alias.body.updatedAt,
      description: null,
      imageId: null,
    });
    expect(clearedAlias.status).toBe(200);
    expect(clearedAlias.body.description).toBeNull();
    expect(clearedAlias.body.imageId).toBeNull();
    await prisma.file.delete({ where: { id: image.id } });
  });
});

describe('error codes', () => {
  live('answers every rule and duplicate with its status and code', async () => {
    const { body: keyword } = await createKeyword(owner, `Rules ${marker}`);
    const dup = await createKeyword(other, `Rules ${marker}`);
    expect([dup.result.status, (dup.result.body as unknown as ErrorBody).code]).toEqual([409, 'KEYWORD_NAME_TAKEN']);

    const noName = await call<ErrorBody>(owner, 'POST', '/keywords', {
      id: crypto.randomUUID(), versionId: crypto.randomUUID(), novelId, categoryId, natureId,
    });
    expect([noName.status, noName.body.code]).toEqual([422, 'NAME_REQUIRED']);

    const missingNovel = await call<ErrorBody>(owner, 'POST', '/keywords', {
      id: crypto.randomUUID(), versionId: crypto.randomUUID(), nameEn: `Lost ${marker}`, novelId: crypto.randomUUID(), categoryId, natureId,
    });
    expect([missingNovel.status, missingNovel.body.code]).toEqual([404, 'PARENT_NOT_FOUND']);

    const aliasBody = { id: crypto.randomUUID(), keywordId: keyword.id, nameEn: `Alias ${marker}` };
    expect((await call(owner, 'POST', '/keyword-aliases', aliasBody)).status).toBe(200);
    const aliasDup = await call<ErrorBody>(other, 'POST', '/keyword-aliases', { ...aliasBody, id: crypto.randomUUID() });
    expect([aliasDup.status, aliasDup.body.code]).toEqual([409, 'ALIAS_NAME_TAKEN']);
    const orphan = await call<ErrorBody>(owner, 'POST', '/keyword-aliases', { ...aliasBody, id: crypto.randomUUID(), keywordId: crypto.randomUUID() });
    expect([orphan.status, orphan.body.code]).toEqual([404, 'PARENT_NOT_FOUND']);

    const replacement = { id: crypto.randomUUID(), novelId, from: `r1-${marker}`, to: `r2-${marker}` };
    expect((await call(owner, 'POST', '/replacements', replacement)).status).toBe(200);
    const exists = await call<ErrorBody>(owner, 'POST', '/replacements', { ...replacement, id: crypto.randomUUID() });
    expect([exists.status, exists.body.code]).toEqual([409, 'REPLACEMENT_EXISTS']);
    const reverse = await call<ErrorBody>(owner, 'POST', '/replacements', { id: crypto.randomUUID(), novelId, from: `r2-${marker}`, to: `r1-${marker}` });
    expect([reverse.status, reverse.body.code]).toEqual([400, 'REPLACEMENT_BIDIRECTIONAL']);

    const noChapter = await call<ErrorBody>(owner, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: keyword.id });
    expect([noChapter.status, noChapter.body.code]).toEqual([400, 'VERSION_CHAPTER_REQUIRED']);
    expect((await call(owner, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: keyword.id, currentChapter: 5 })).status).toBe(200);
    const notAfter = await call<ErrorBody>(owner, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: keyword.id, currentChapter: 5 });
    expect([notAfter.status, notAfter.body.code]).toEqual([400, 'VERSION_NOT_AFTER_LATEST']);
    const base = await call<ErrorBody>(owner, 'DELETE', `/keyword-versions/${keyword.versionId}`);
    expect([base.status, base.body.code]).toEqual([400, 'VERSION_BASE_PROTECTED']);

    const { body: lone } = await createKeyword(owner, `Lone ${marker}`);
    const only = await call<ErrorBody>(owner, 'DELETE', `/keyword-versions/${lone.versionId}`);
    expect([only.status, only.body.code]).toEqual([400, 'VERSION_ONLY_PROTECTED']);

    const inUse = await call<ErrorBody>(moderator, 'DELETE', `/keyword-categories/${categoryId}`);
    expect([inUse.status, inUse.body.code]).toEqual([400, 'CATEGORY_IN_USE']);
    const natureInUse = await call<ErrorBody>(moderator, 'DELETE', `/keyword-natures/${natureId}`);
    expect([natureInUse.status, natureInUse.body.code]).toEqual([400, 'NATURE_IN_USE']);

    const lookup = { id: crypto.randomUUID(), nameEn: `Lookup ${marker}`, color: '#abcdef' };
    const createdLookup = await call<Row>(moderator, 'POST', '/keyword-categories', lookup);
    expect(createdLookup.status).toBe(200);
    ids.categories.push(lookup.id);
    const lookupDup = await call<ErrorBody>(moderator, 'POST', '/keyword-categories', { ...lookup, id: crypto.randomUUID() });
    expect([lookupDup.status, lookupDup.body.code]).toEqual([409, 'LOOKUP_NAME_TAKEN']);

    const missing = await call<ErrorBody>(owner, 'GET', `/keywords/${crypto.randomUUID()}`);
    expect([missing.status, missing.body.code]).toEqual([404, 'NOT_FOUND']);
  });

  live('maps Prisma unique and missing-row errors', async () => {
    const { body: keyword } = await createKeyword(owner, `Unique ${marker}`);
    // A base-version ID that another keyword already uses is a unique violation, not a replay.
    const clash = await createKeyword(owner, `Unique 2 ${marker}`, { versionId: keyword.versionId });
    expect([clash.result.status, (clash.result.body as unknown as ErrorBody).code]).toEqual([409, 'UNIQUE_VIOLATION']);

    const meta = { clientVersion: Prisma.prismaVersion.client };
    expect(toPrismaHttpError(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', ...meta }))).toMatchObject({
      statusCode: 409,
      errorCode: 'UNIQUE_VIOLATION',
    });
    expect(toPrismaHttpError(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', ...meta }))).toMatchObject({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
    });
    expect(toPrismaHttpError(new Error('other'))).toBeNull();
  });
});

describe('alias and version rights (D12)', () => {
  live('lets the row creator, the keyword owner and moderators edit; refuses a third reader', async () => {
    const { body: keyword } = await createKeyword(owner, `Rights ${marker}`);
    const alias = await call<Row>(other, 'POST', '/keyword-aliases', { id: crypto.randomUUID(), keywordId: keyword.id, nameEn: `Rights alias ${marker}` });
    const version = await call<Row>(other, 'POST', '/keyword-versions', { id: crypto.randomUUID(), keywordId: keyword.id, currentChapter: 3 });
    expect([alias.status, version.status]).toEqual([200, 200]);

    const edit = async (actor: Actor, path: string) => {
      const row = await prisma.$queryRawUnsafe<{ updatedAt: Date }[]>(
        `SELECT "updatedAt" FROM "${path.startsWith('/keyword-aliases') ? 'KeywordAlias' : 'KeywordVersion'}" WHERE id = $1`,
        path.split('/').at(-1),
      );
      return (await call(actor, 'PUT', path, { baseUpdatedAt: row[0]?.updatedAt.toISOString(), description: `by ${actor.id}` })).status;
    };
    for (const path of [`/keyword-aliases/${alias.body.id}`, `/keyword-versions/${version.body.id}`]) {
      expect(await edit(other, path)).toBe(200);
      expect(await edit(owner, path)).toBe(200);
      expect(await edit(third, path)).toBe(403);
      expect(await edit(moderator, path)).toBe(200);
    }
    expect((await call(third, 'DELETE', `/keyword-aliases/${alias.body.id}`)).status).toBe(403);
    expect((await call(other, 'DELETE', `/keyword-aliases/${alias.body.id}`)).status).toBe(200);
    expect((await call(other, 'DELETE', `/keyword-versions/${version.body.id}`)).status).toBe(200);
  });
});

describe('lookups', () => {
  live('creates two Arabic-only categories and replays a moderator create', async () => {
    const first = { id: crypto.randomUUID(), nameAr: `فئة أ ${marker}`, nameEn: '', color: '#101010' };
    const second = { id: crypto.randomUUID(), nameAr: `فئة ب ${marker}`, nameEn: '', color: '#202020' };
    const results = [await call<Row>(moderator, 'POST', '/keyword-categories', first), await call<Row>(moderator, 'POST', '/keyword-categories', second)];
    ids.categories.push(first.id, second.id);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results[0]?.body.nameEn).toBeNull();
    const replay = await call<Row>(moderator, 'POST', '/keyword-categories', first);
    expect([replay.status, replay.body.id]).toEqual([200, first.id]);
    const changed = await call<ErrorBody>(moderator, 'POST', '/keyword-categories', { ...first, color: '#303030' });
    expect([changed.status, changed.body.code]).toEqual([409, 'ID_CONFLICT']);
    const partial = await call<Row>(moderator, 'PUT', `/keyword-categories/${first.id}`, {
      baseUpdatedAt: results[0]?.body.updatedAt,
      description: 'only this',
    });
    expect([partial.status, partial.body.color]).toEqual([200, '#101010']);
  });
});

describe('protocol and client floors', () => {
  live('answers the protocol version to guests, readers and moderators', async () => {
    for (const actor of [guest, owner, moderator]) {
      const result = await call(actor, 'GET', '/sync/protocol');
      expect([result.status, result.body]).toEqual([200, { version: 2 }]);
    }
  });

  live('refuses releases before this one', async () => {
    for (const header of ['extension/3.2.1', 'desktop/3.2.1']) {
      const result = await call(owner, 'GET', '/sync/protocol', undefined, { 'X-Client-Version': header });
      expect(result.status).toBe(426);
    }
    expect(MIN_CLIENT_VERSIONS).toEqual({ extension: '3.2.2', desktop: '3.2.2' });
  });
});

describe('raw stored text', () => {
  live('stores names as typed', async () => {
    const { result } = await createKeyword(owner, `D'Artagnan <b> ${marker}`);
    expect(result.body.nameEn).toBe(`D'Artagnan <b> ${marker}`);
    const stored = await prisma.keyword.findUniqueOrThrow({ where: { id: result.body.id } });
    expect(stored.nameEn).toBe(`D'Artagnan <b> ${marker}`);
  });
});
