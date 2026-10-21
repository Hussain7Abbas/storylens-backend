import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { prisma } from '@/lib/db';
import {
  chapterContextSchema,
  type ChapterContext,
  type ContinuityContext,
} from '@/lib/chapter-context/schema';
import { call, cleanup, live, makeActor, type Actor } from './helpers/live-db';

export function sampleContext(
  chapter = 1,
  change: string | null | undefined = undefined,
): ChapterContext {
  return {
    schemaVersion: 1,
    summary: `Summary of chapter ${chapter}`,
    scenes: [
      {
        id: 's1',
        title: 'The shrine',
        environment: {
          location: 'Shrine',
          time: 'Night',
          weather: 'Rain',
          lighting: 'Blue fire',
          details: '',
        },
        entities: [
          {
            entityKey: 'name:mira',
            keywordId: null,
            name: 'Mira',
            kind: 'character',
            appearance: 'Silver hair',
            condition: 'Exhausted',
            clothing: 'Cloak',
            equipment: [],
            pose: 'Kneeling',
            emotion: 'Afraid',
            relations: [],
            evidence: 'Mira entered the shrine.',
          },
        ],
      },
    ],
    stateChanges:
      change === undefined
        ? []
        : [
            {
              entityKey: 'name:mira',
              sceneId: 's1',
              field: 'injuries.leftShoulder',
              value: change,
              evidence: change === null ? 'The wound healed.' : 'Her shoulder was wounded.',
            },
          ],
  };
}
describe('structured chapter context', () => {
  it('requires known scenes, unique entities and valid registered identities', () => {
    const context = sampleContext(1, 'Wounded');
    expect(chapterContextSchema.safeParse(context).success).toBe(true);
    expect(chapterContextSchema.safeParse({ ...context, description: 'old field' }).success).toBe(
      false,
    );
    expect(
      chapterContextSchema.safeParse({
        ...context,
        stateChanges: [{ ...context.stateChanges[0], sceneId: 'missing' }],
      }).success,
    ).toBe(false);
    expect(
      chapterContextSchema.safeParse({ ...context, scenes: [context.scenes[0], context.scenes[0]] })
        .success,
    ).toBe(false);
    expect(chapterContextSchema.safeParse(sampleContext(1, null)).success).toBe(true);
  });
});
const marker = `context-${crypto.randomUUID().slice(0, 8)}`;
const ids = { users: [] as string[], novels: [] as string[] };
let reader: Actor, other: Actor, guest: Actor, moderator: Actor, novelId: string;
const path = (chapter: number) => `/chapter-context/${novelId}/${chapter}`;
const hash = (chapter: number) => chapter.toString(16).padStart(64, '0');
beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  [reader, other, guest, moderator] = await Promise.all([
    makeActor('reader', marker),
    makeActor('reader', marker),
    makeActor('guest', marker),
    makeActor('moderator', marker),
  ]);
  ids.users.push(reader.id, other.id, guest.id, moderator.id);
  novelId = (await prisma.novel.create({ data: { nameEn: marker, slugs: [marker] } })).id;
  ids.novels.push(novelId);
});
afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST === '1') await cleanup(ids);
});
async function publish(chapter: number, context = sampleContext(chapter)) {
  const body = { contentHash: hash(chapter), language: 'en' };
  const claim = await call<{ token: string }>(reader, 'POST', `${path(chapter)}/claim`, body);
  expect(claim.status).toBe(200);
  const result = await call(reader, 'PUT', path(chapter), {
    ...body,
    token: claim.body.token,
    context,
  });
  expect(result.status).toBe(200);
}
live(
  'chapter contexts use owned reservations, validate JSON and keep private fields off public chapter routes',
  async () => {
    const body = { contentHash: hash(8), language: 'en' };
    expect((await call(guest, 'POST', `${path(8)}/claim`, body)).status).toBe(403);
    const claims = await Promise.all(
      [reader, other].map((actor) =>
        call<{ token: string | null }>(actor, 'POST', `${path(8)}/claim`, body),
      ),
    );
    expect(claims.map((result) => result.status)).toEqual([200, 200]);
    expect(claims.filter((result) => result.body.token)).toHaveLength(1);
    const owner = claims[0]?.body.token ? reader : other;
    const token = claims.find((result) => result.body.token)?.body.token;
    expect(
      (await call(owner, 'PUT', path(8), { ...body, token, context: { summary: 'unstructured' } }))
        .status,
    ).toBe(422);
    expect(
      (
        await call(owner === reader ? other : reader, 'PUT', path(8), {
          ...body,
          token,
          context: sampleContext(8),
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(owner, 'PUT', path(8), { ...body, token, context: sampleContext(8) })).status,
    ).toBe(200);
    const read = await call<{ context: ChapterContext; contentHash: string }>(
      guest,
      'GET',
      path(8),
    );
    expect(read.status).toBe(200);
    expect(read.body.context.summary).toBe('Summary of chapter 8');
    expect(Object.keys(read.body).sort()).toEqual([
      'canEdit',
      'contentHash',
      'context',
      'generating',
      'inactiveEntities',
      'updatedAt',
    ]);
    const novel = await call<{ chapters: Record<string, unknown>[] }>(
      guest,
      'GET',
      `/novels/${novelId}`,
    );
    expect(novel.status).toBe(200);
    for (const chapter of novel.body.chapters) {
      expect(chapter.description).toBeNull();
      expect(chapter.context).toBeUndefined();
      expect(chapter.contextLeaseToken).toBeUndefined();
      expect(chapter.coverLeaseToken).toBeUndefined();
    }
  },
);
live(
  'image continuity loads exactly the nearby window and restores older states without future changes',
  async () => {
    await publish(1, sampleContext(1, 'Deep wound'));
    await publish(5);
    await publish(6, { ...sampleContext(6), scenes: [] });
    await publish(7, { ...sampleContext(7), scenes: [] });
    await publish(9, { ...sampleContext(9), scenes: [] });
    await publish(10, sampleContext(10, null));
    await publish(11);
    const result = await call<ContinuityContext>(
      reader,
      'GET',
      `${path(8)}/continuity?entities=name%3Amira`,
    );
    expect(result.status).toBe(200);
    expect(result.body.chapters.map((row) => row.chapterNumber)).toEqual([6, 7, 8, 9, 10]);
    expect(result.body.lastMentions[0]?.chapterNumber).toBe(5);
    expect(result.body.persistentState).toEqual([
      {
        entityKey: 'name:mira',
        chapterNumber: 1,
        field: 'injuries.leftShoulder',
        value: { value: 'Deep wound', sceneId: 's1', evidence: 'Her shoulder was wounded.' },
      },
    ]);
    const later = await call<typeof result.body>(
      reader,
      'GET',
      `${path(30)}/continuity?entities=name%3Amira`,
    );
    expect(later.body.lastMentions[0]?.chapterNumber).toBe(11);
    expect(later.body.persistentState[0]?.value.value).toBeNull();
    const recent = await call<{ inactiveEntities: { missingChapters: number }[] }>(
      guest,
      'GET',
      path(12),
    );
    expect(recent.body.inactiveEntities[0]?.missingChapters).toBe(1);
    expect(
      (await call<{ inactiveEntities: unknown[] }>(guest, 'GET', path(30))).body.inactiveEntities,
    ).toEqual([]);
  },
);

live(
  'renumbering preserves the continuity index and JSON entity keys preserve punctuation',
  async () => {
    const moderator = await makeActor('moderator', marker);
    ids.users.push(moderator.id);
    const context = sampleContext(40, 'Cracked');
    context.scenes[0]!.entities[0]!.entityKey = 'name:mira, the scout';
    context.scenes[0]!.entities[0]!.name = 'Mira, the Scout';
    context.stateChanges[0]!.entityKey = 'name:mira, the scout';
    await publish(40, context);
    const chapter = await prisma.chapter.findUniqueOrThrow({
      where: { novelId_number: { novelId, number: 40 } },
    });
    expect(
      (await call(moderator, 'PUT', `/chapters/${chapter.id}`, { name: 'The shrine', number: 41 }))
        .status,
    ).toBe(200);
    const entities = encodeURIComponent(JSON.stringify(['name:mira, the scout']));
    const result = await call<ContinuityContext>(
      reader,
      'GET',
      `${path(42)}/continuity?entities=${entities}`,
    );
    expect(result.status).toBe(200);
    expect(result.body.lastMentions[0]?.chapterNumber).toBe(41);
    expect(result.body.persistentState[0]?.chapterNumber).toBe(41);
    expect(result.body.lastMentions[0]?.name).toBe('Mira, the Scout');
    expect((await call(reader, 'GET', `${path(42)}/continuity?entities=%5B%7B%7D%5D`)).status).toBe(
      422,
    );
  },
);

live(
  'automatic claims preserve existing contexts even when the source hash changes or is absent',
  async () => {
    await publish(50);
    for (const contentHash of [hash(51), hash(52)]) {
      const result = await call(reader, 'POST', `${path(50)}/claim`, {
        contentHash,
        language: 'en',
        onlyIfMissing: true,
      });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ token: null, ready: true });
      await prisma.chapter.update({
        where: { novelId_number: { novelId, number: 50 } },
        data: { contextHash: null },
      });
    }
    const chapter = await prisma.chapter.findUniqueOrThrow({
      where: { novelId_number: { novelId, number: 50 } },
    });
    expect(chapter.context).toEqual(sampleContext(50));
    expect(chapter.contextLeaseToken).toBeNull();
  },
);


live('explicit context regeneration replaces unchanged source text while preserving automatic reuse', async () => {
  const chapter = 55;
  await publish(chapter);
  const body = { contentHash: hash(chapter), language: 'en', regenerate: true };
  const denied = await call<{ token: string | null }>(other, 'POST', `${path(chapter)}/claim`, body);
  expect(denied.body.token).toBeNull();
  const automatic = await call<{ token: string | null }>(reader, 'POST', `${path(chapter)}/claim`, { ...body, onlyIfMissing: true });
  expect(automatic.body.token).toBeNull();
  const claim = await call<{ token: string }>(reader, 'POST', `${path(chapter)}/claim`, body);
  expect(claim.body.token).toBeString();
  const replacement = { ...sampleContext(chapter), summary: 'A newly generated summary for the same chapter.' };
  expect((await call(reader, 'PUT', path(chapter), { ...body, token: claim.body.token, context: replacement })).status).toBe(200);
  const row = await prisma.chapter.findUniqueOrThrow({ where: { novelId_number: { novelId, number: chapter } } });
  expect(row.context).toEqual(replacement);
  expect(row.contextLeaseToken).toBeNull();
  expect((await call(reader, 'PUT', path(chapter), { ...body, token: claim.body.token, context: replacement })).status).toBe(200);
});

live('compact tracking uses one nearest previous chapter, bulk restores returning elements and expires absence at ten', async () => {
 await publish(100, sampleContext(100, 'Visible scar'));
 const leo = sampleContext(102);
 const scene = leo.scenes[0];
 if (!scene?.entities[0]) throw new Error('Missing fixture');
 scene.entities[0].entityKey = 'name:leo';
 scene.entities[0].name = 'Leo';
 await publish(102, leo);
 await publish(106, sampleContext(106, null));
 const tracking = await call<{previous: {chapterNumber: number; context: ChapterContext} | null; lastSeen: {entityKey: string; lastSeenChapter: number}[]}>(guest, 'POST', `${path(104)}/tracking`, {entityKeys: ['name:mira']});
 expect(tracking.status).toBe(200);
 expect(tracking.body.previous?.chapterNumber).toBe(102);
 expect(tracking.body.lastSeen.find(entity => entity.entityKey === 'name:mira')?.lastSeenChapter).toBe(100);
 expect(JSON.stringify(tracking.body)).not.toContain('missingChapters');
 expect(JSON.stringify(tracking.body)).not.toContain('"chapterNumber":106');
 const bulk = await call<{chapters: {chapterNumber: number; context: ChapterContext}[]}>(guest, 'POST', `${path(104)}/bulk`, {chapterNumbers: [102, 100, 100], entityKeys: ['name:mira']});
 expect(bulk.status).toBe(200);
 expect(bulk.body.chapters.map(chapter => chapter.chapterNumber)).toEqual([100, 102]);
 expect(bulk.body.chapters[0]?.context.stateChanges[0]?.value).toBe('Visible scar');
 expect(bulk.body.chapters[1]?.context.scenes).toEqual([]);
 for (const chapterNumbers of [[104], [106], [-1], [1.5], [2147483648], Array(81).fill(100)])
  expect((await call(reader, 'POST', `${path(104)}/bulk`, {chapterNumbers})).status).toBe(422);
 expect((await call(null, 'POST', `${path(104)}/bulk`, {chapterNumbers: [100]})).status).toBe(401);
 expect((await call(reader, 'POST', `${path(104)}/tracking`, {entityKeys: ['invalid']})).status).toBe(422);
 const before = await call<{inactiveEntities: {entityKey: string; name: string; keywordId: string | null; lastSeenChapter: number}[]}>(guest, 'GET', `${path(111)}?format=compact`);
 expect(before.body.inactiveEntities.find(entity => entity.entityKey === 'name:leo')).toEqual({entityKey: 'name:leo', name: 'Leo', keywordId: null, lastSeenChapter: 102});
 const after = await call<typeof before.body>(guest, 'GET', `${path(112)}?format=compact`);
 expect(after.body.inactiveEntities.some(entity => entity.entityKey === 'name:leo')).toBe(false);
 expect(JSON.stringify(after.body)).not.toContain('missingChapters');
 expect(JSON.stringify(after.body)).not.toContain('lastMentionedChapter');
 // History survives expiry, and revisits do not advance last seen.
 expect((await call<typeof tracking.body>(reader, 'POST', `${path(200)}/tracking`, {entityKeys: ['name:leo']})).body.lastSeen.find(entity => entity.entityKey === 'name:leo')?.lastSeenChapter).toBe(102);
 await publish(103, {...sampleContext(103), scenes: []});
 expect((await call<typeof tracking.body>(guest, 'POST', `${path(104)}/tracking`, {entityKeys: []})).body.previous?.chapterNumber).toBe(103);
 expect((await call<typeof tracking.body>(guest, 'POST', `${path(0)}/tracking`, {entityKeys: []})).body.previous).toBeNull();
 expect((await call<{chapters: unknown[]}>(guest, 'POST', `${path(104)}/bulk`, {chapterNumbers: []})).body.chapters).toEqual([]);
 const isolated = await call<typeof tracking.body>(guest, 'POST', `/chapter-context/${crypto.randomUUID()}/104/tracking`, {entityKeys: ['name:mira']});
 expect(isolated.body).toEqual({previous: null, lastSeen: []});
});

type EditableContext = { context: ChapterContext; updatedAt: string; canEdit: boolean; generating: boolean; contentHash: string };
live('manual context edits enforce ownership and revision checks and rebuild continuity facts atomically', async () => {
  const chapter = 501;
  await publish(chapter, sampleContext(chapter, 'Wounded'));
  const initial = (await call<EditableContext>(reader, 'GET', path(chapter))).body;
  expect(initial.canEdit).toBe(true);
  expect((await call<EditableContext>(other, 'GET', path(chapter))).body.canEdit).toBe(false);
  expect((await call<EditableContext>(guest, 'GET', path(chapter))).body.canEdit).toBe(false);
  const edit = { baseUpdatedAt: initial.updatedAt, path: ['scenes', 0, 'entities', 0, 'name'], value: 'Mira the scout' };
  expect((await call(other, 'PATCH', path(chapter), edit)).status).toBe(403);
  expect((await call(guest, 'PATCH', path(chapter), edit)).status).toBe(403);
  const renamed = await call<EditableContext>(reader, 'PATCH', path(chapter), edit);
  expect(renamed.status).toBe(200);
  expect(renamed.body.context.scenes[0]?.entities[0]?.name).toBe('Mira the scout');
  expect(renamed.body.updatedAt).not.toBe(initial.updatedAt);
  expect(renamed.body.contentHash).toBe(initial.contentHash);
  expect(renamed.body).not.toHaveProperty('contextLeaseToken');
  const mention = await prisma.chapterMention.findFirstOrThrow({ where: { novelId, chapterNumber: chapter } });
  expect(mention.name).toBe('Mira the scout');
  const cleared = await call<EditableContext>(reader, 'PATCH', path(chapter), { baseUpdatedAt: renamed.body.updatedAt, path: ['stateChanges', 0, 'value'], value: null });
  expect(cleared.status).toBe(200);
  expect((await prisma.chapterMention.findFirstOrThrow({ where: { novelId, chapterNumber: chapter } })).state).toMatchObject({ 'injuries.leftShoulder': { value: null } });
  const updates = await Promise.all(['First edit', 'Second edit'].map(value => call<EditableContext>(reader, 'PATCH', path(chapter), { baseUpdatedAt: cleared.body.updatedAt, path: ['summary'], value })));
  expect(updates.map(result => result.status).sort()).toEqual([200, 409]);
  expect((await call(reader, 'PATCH', path(chapter), edit)).status).toBe(409);
  const latest = (await call<EditableContext>(moderator, 'GET', path(chapter))).body;
  expect(latest.canEdit).toBe(true);
  expect((await call(moderator, 'PATCH', path(chapter), { baseUpdatedAt: latest.updatedAt, path: ['summary'], value: 'Moderator correction' })).status).toBe(200);
});

live('manual edits validate JSON paths, schema, novel identities and active generation without damaging the saved context', async () => {
  const chapter = 502;
  await publish(chapter);
  const initial = (await call<EditableContext>(reader, 'GET', path(chapter))).body;
  const patch = (property: (string | number)[], value: unknown) => call(reader, 'PATCH', path(chapter), { baseUpdatedAt: initial.updatedAt, path: property, value });
  expect((await patch(['summary'], '')).status).toBe(422);
  expect((await patch(['summary'], '<b>plain text</b>')).status).toBe(200);
  const fresh = (await call<EditableContext>(reader, 'GET', path(chapter))).body;
  const request = (property: (string | number)[], value: unknown) => call(reader, 'PATCH', path(chapter), { baseUpdatedAt: fresh.updatedAt, path: property, value });
  for (const invalid of [['__proto__'], ['scenes', 'length'], ['scenes', 99], ['missing'], []] as (string | number)[][])
    expect((await request(invalid, 'bad')).status).toBe(422);
  expect((await request(['scenes', 0, 'entities', 0, 'equipment'], 'not an array')).status).toBe(422);
  expect((await request(['stateChanges'], [{ entityKey: 'name:mira', sceneId: 'missing', field: 'condition', value: 'Healed', evidence: 'Healed.' }])).status).toBe(422);
  const invalidIdentity = structuredClone(fresh.context.scenes[0]?.entities[0]);
  if (!invalidIdentity) throw new Error('Missing fixture entity');
  invalidIdentity.keywordId = crypto.randomUUID(); invalidIdentity.entityKey = `keyword:${invalidIdentity.keywordId}`;
  expect((await request(['scenes', 0, 'entities', 0], invalidIdentity)).status).toBe(422);
  expect((await call<EditableContext>(reader, 'GET', path(chapter))).body.context).toEqual(fresh.context);
  await call(reader, 'POST', `${path(chapter)}/claim`, { contentHash: hash(chapter), language: 'en', regenerate: true });
  expect((await request(['summary'], 'During generation')).status).toBe(409);
  expect((await call(reader, 'PATCH', path(599), { baseUpdatedAt: fresh.updatedAt, path: ['summary'], value: 'Missing' })).status).toBe(404);
});
