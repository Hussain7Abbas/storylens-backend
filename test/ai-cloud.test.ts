import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { prisma } from '@/lib/db';
import { sweepStuckActions } from '@/lib/ai/cloud/actions';
import { ndjsonResponse } from '@/lib/ai/cloud/stream';
import { setAiProvider } from '@/lib/ai/provider';
import { auditBalances, withLensChange } from '@/lib/billing/ledger';
import { app } from '@/server';
import { fakeAi } from './helpers/fake-ai';
import { type Actor, cleanup, live, makeActor } from './helpers/live-db';

type Json = Record<string, unknown>;
type Frame = Json & { type: string };

const marker = crypto.randomUUID().slice(0, 8);
const ids = { users: [] as string[], novels: [] as string[] };
const ai = fakeAi();
let reader: Actor;

async function setConfig(key: string, value: string) {
  await prisma.config.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function fund(actor: Actor, lenses: number) {
  await withLensChange(prisma, { userId: actor.id, delta: lenses, type: 'ADMIN_GIFT', idempotencyKey: `gift:${crypto.randomUUID()}` });
}

async function newReader(lenses = 0): Promise<Actor> {
  const actor = await makeActor('reader', marker);
  ids.users.push(actor.id);
  if (lenses) await fund(actor, lenses);
  return actor;
}

async function balanceOf(actor: Actor) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { lensBalance: true } })).lensBalance;
}

function promptBody(extra: Json = {}): Json {
  return {
    actionId: crypto.randomUUID(),
    attempt: 1,
    feature: 'page_summary',
    prompt: 'Summarize this page.',
    responseLanguage: 'en',
    ...extra,
  };
}

/** Posts to the cloud AI routes; `stream` reads NDJSON frames. */
async function post(actor: Actor, path: string, body: Json, { stream = true, signal }: { stream?: boolean; signal?: AbortSignal } = {}) {
  const response = await app.handle(
    new Request(`http://localhost/api/user/ai/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${actor.token}`,
        'Content-Type': 'application/json',
        'X-Client-Version': 'extension/3.4.0',
        ...(stream ? { Accept: 'application/x-ndjson' } : {}),
      },
      body: JSON.stringify(body),
      signal,
    }),
  );
  const text = await response.text();
  const isStream = response.headers.get('content-type')?.includes('ndjson');
  let json: Json = {};
  if (!isStream) {
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = { text };
    }
  }
  const frames = isStream
    ? text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Frame)
    : [];
  return { status: response.status, headers: response.headers, json, frames, last: frames.at(-1) };
}

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  setAiProvider(ai.provider);
  await setConfig('AI_Cloud_Enabled', 'true');
  await setConfig('AI_Reader_Max_Running', '10');
  await setConfig('AI_Reader_Max_Per_10_Min', '500');
  reader = await newReader(10);
});

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  setAiProvider(null);
  await setConfig('AI_Cloud_Enabled', 'false');
  await prisma.config.deleteMany({
    where: { key: { in: ['AI_Reader_Max_Running', 'AI_Reader_Max_Per_10_Min', 'AI_Daily_Spend_Cap_USD'] } },
  });
  await cleanup(ids);
});

describe('charging', () => {
  live('charges once and streams the answer', async () => {
    ai.steps.push({ kind: 'ok', text: 'A summary.' });
    const body = promptBody();
    const result = await post(reader, 'prompts', body);
    expect(result.status).toBe(200);
    expect(result.headers.get('x-accel-buffering')).toBe('no');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.frames[0]).toMatchObject({ type: 'started', lensesCharged: 2, balance: 8 });
    expect(result.last).toMatchObject({ type: 'result', output: 'A summary.', attempt: 1, balance: 8, lensesCharged: 2 });
    const action = await prisma.aiAction.findUniqueOrThrow({ where: { id: body.actionId as string }, include: { calls: true } });
    expect(action).toMatchObject({ status: 'SUCCEEDED', lensesCharged: 2, refunded: false });
    expect(action.calls).toHaveLength(1);
    expect(Number(action.calls[0]?.costUsd)).toBeCloseTo(0.001);
    expect(await prisma.lensTransaction.count({ where: { aiActionId: body.actionId as string, type: 'AI_CHARGE' } })).toBe(1);
  });

  live('records free features without ledger rows', async () => {
    const before = await balanceOf(reader);
    const body = promptBody({ feature: 'selector_detection' });
    const result = await post(reader, 'prompts', body);
    expect(result.last).toMatchObject({ type: 'result', lensesCharged: 0 });
    expect(await balanceOf(reader)).toBe(before);
    expect(await prisma.lensTransaction.count({ where: { aiActionId: body.actionId as string } })).toBe(0);
  });

  live('refuses an action the balance cannot pay for, before calling the provider', async () => {
    const poor = await newReader(1);
    const calls = ai.chats.length;
    const body = promptBody();
    const result = await post(poor, 'prompts', body);
    expect(result.status).toBe(402);
    expect(result.json).toMatchObject({ code: 'INSUFFICIENT_LENSES', required: 2, balance: 1, feature: 'page_summary' });
    expect(ai.chats.length).toBe(calls);
    expect(await prisma.aiAction.findUnique({ where: { id: body.actionId as string } })).toBeNull();
  });

  live('refunds a failed action', async () => {
    const user = await newReader(5);
    ai.steps.push({ kind: 'fail', code: 'AI_PROVIDER_FAILED' });
    const body = promptBody();
    const result = await post(user, 'prompts', body);
    expect(result.last).toMatchObject({ type: 'error', error: { code: 'AI_PROVIDER_FAILED' }, refunded: true, balance: 5 });
    expect(await balanceOf(user)).toBe(5);
    const action = await prisma.aiAction.findUniqueOrThrow({ where: { id: body.actionId as string } });
    expect(action).toMatchObject({ status: 'FAILED', refunded: true });
    const types = (await prisma.lensTransaction.findMany({ where: { aiActionId: body.actionId as string } })).map((row) => row.type);
    expect(types.sort()).toEqual(['AI_CHARGE', 'AI_REFUND']);
  });

  live('refunds when the reader cancels', async () => {
    const user = await newReader(5);
    ai.steps.push({ kind: 'hang' });
    const controller = new AbortController();
    const body = promptBody();
    const pending = post(user, 'prompts', body, { stream: false, signal: controller.signal }).catch((error) => error);
    await Bun.sleep(150);
    controller.abort();
    await pending;
    await Bun.sleep(150);
    const action = await prisma.aiAction.findUniqueOrThrow({ where: { id: body.actionId as string }, include: { calls: true } });
    expect(action).toMatchObject({ status: 'FAILED', refunded: true });
    expect(action.calls[0]?.status).toBe('cancelled');
    expect(await balanceOf(user)).toBe(5);
  });

  live('allows one free retry after a success, and nothing else', async () => {
    const user = await newReader(4);
    const body = promptBody();
    await post(user, 'prompts', body);
    const second = await post(user, 'prompts', { ...body, attempt: 2 });
    expect(second.last).toMatchObject({ type: 'result', attempt: 2, lensesCharged: 0 });
    expect(await balanceOf(user)).toBe(2);
    const third = await post(user, 'prompts', { ...body, attempt: 2 });
    expect([third.status, third.json.code, third.json.reason]).toEqual([409, 'ACTION_NOT_RETRYABLE', 'limit']);

    ai.steps.push({ kind: 'fail', code: 'AI_EMPTY_OUTPUT' });
    const failed = promptBody();
    await post(user, 'prompts', failed);
    const afterFailure = await post(user, 'prompts', { ...failed, attempt: 2 });
    expect(afterFailure.json).toMatchObject({ code: 'ACTION_NOT_RETRYABLE', reason: 'failed' });
  });

  live('refuses a retry while the first attempt runs', async () => {
    const user = await newReader(4);
    ai.steps.push({ kind: 'hang' });
    const controller = new AbortController();
    const body = promptBody();
    const first = post(user, 'prompts', body, { stream: false, signal: controller.signal }).catch((error) => error);
    await Bun.sleep(150);
    const retry = await post(user, 'prompts', { ...body, attempt: 2 });
    expect(retry.json).toMatchObject({ code: 'ACTION_NOT_RETRYABLE', reason: 'running' });
    controller.abort();
    await first;
  });

  live('refuses reused action IDs', async () => {
    const owner = await newReader(4);
    const thief = await newReader(4);
    const body = promptBody();
    await post(owner, 'prompts', body);
    expect((await post(thief, 'prompts', { ...body, attempt: 2 })).json.code).toBe('ID_CONFLICT');
    expect((await post(owner, 'prompts', { ...body, attempt: 2, feature: 'keyword_suggestion' })).json.code).toBe('ID_CONFLICT');
    expect((await post(owner, 'prompts', body)).json.code).toBe('ID_CONFLICT');
  });

  live('pays for exactly as many parallel actions as the balance covers', async () => {
    const user = await newReader(6);
    const results = await Promise.all(Array.from({ length: 5 }, () => post(user, 'prompts', promptBody())));
    expect(results.filter((result) => result.status === 200)).toHaveLength(3);
    expect(results.filter((result) => result.status === 402)).toHaveLength(2);
    expect(await balanceOf(user)).toBe(0);
    expect(await auditBalances(prisma, [user.id])).toEqual([]);
  });

  live('charges moderators like everyone else', async () => {
    const moderator = await makeActor('moderator', marker);
    ids.users.push(moderator.id);
    expect((await post(moderator, 'prompts', promptBody())).status).toBe(402);
  });

  live('refuses guests', async () => {
    const guest = await makeActor('guest', marker);
    ids.users.push(guest.id);
    expect((await post(guest, 'prompts', promptBody())).status).toBe(403);
  });
});

describe('limits', () => {
  live('caps the prompt size per feature', async () => {
    const result = await post(reader, 'prompts', promptBody({ feature: 'keyword_suggestion', prompt: 'x'.repeat(32_001) }));
    expect([result.status, result.json.code, result.json.maxChars]).toEqual([413, 'PROMPT_TOO_LARGE', 32_000]);
  });

  live('answers unavailable when switched off, disabled or over the spend cap', async () => {
    await setConfig('AI_Cloud_Enabled', 'false');
    const off = await post(reader, 'prompts', promptBody());
    await setConfig('AI_Cloud_Enabled', 'true');
    expect([off.status, off.json.code, off.json.reason]).toEqual([503, 'AI_UNAVAILABLE', 'disabled']);

    await prisma.aiFeaturePrice.update({ where: { key: 'page_summary' }, data: { enabled: false } });
    const disabled = await post(reader, 'prompts', promptBody());
    await prisma.aiFeaturePrice.update({ where: { key: 'page_summary' }, data: { enabled: true } });
    expect([disabled.status, disabled.json.code]).toEqual([503, 'AI_FEATURE_DISABLED']);

    await setConfig('AI_Daily_Spend_Cap_USD', '0');
    const capped = await post(reader, 'prompts', promptBody());
    await prisma.config.deleteMany({ where: { key: 'AI_Daily_Spend_Cap_USD' } });
    expect([capped.status, capped.json.code, capped.json.reason]).toEqual([503, 'AI_UNAVAILABLE', 'spend-cap']);

    expect((await post(reader, 'prompts', promptBody({ feature: 'character_image' }))).json.code).toBe('AI_FEATURE_NOT_FOUND');
    expect((await post(reader, 'prompts', promptBody({ feature: 'nope' }))).json.code).toBe('AI_FEATURE_NOT_FOUND');
  });

  live('limits how many actions a reader starts', async () => {
    const user = await newReader(10);
    await setConfig('AI_Reader_Max_Per_10_Min', '2');
    await post(user, 'prompts', promptBody({ feature: 'selector_detection' }));
    await post(user, 'prompts', promptBody({ feature: 'selector_detection' }));
    const third = await post(user, 'prompts', promptBody({ feature: 'selector_detection' }));
    await setConfig('AI_Reader_Max_Per_10_Min', '500');
    expect([third.status, third.json.code]).toEqual([429, 'AI_RATE_LIMITED']);
    expect(Number(third.json.retryAfterSeconds)).toBeGreaterThan(0);
  });
});

describe('features', () => {
  live('sends the model, caps, language rule and reader ID to the provider', async () => {
    const before = ai.chats.length;
    await post(reader, 'prompts', promptBody({ feature: 'keyword_suggestion', responseLanguage: 'ar' }));
    const input = ai.chats[before];
    expect(input).toMatchObject({ model: 'google/gemini-2.5-flash', maxTokens: 800, userId: reader.id });
    expect(input?.system).toContain('Arabic');
    expect(input?.webSearch).toBeUndefined();
  });

  live('uses the text and image models chosen in the configs', async () => {
    await setConfig('AI_Text_Model', 'deepseek/deepseek-v4-flash');
    await setConfig('AI_Image_Model', 'black-forest-labs/flux.2-pro');
    const user = await newReader(3);
    const before = ai.chats.length;
    await post(reader, 'prompts', promptBody({ feature: 'selector_detection' }));
    expect(ai.chats[before]?.model).toBe('deepseek/deepseek-v4-flash');
    await post(user, 'images', { actionId: crypto.randomUUID(), feature: 'character_image', prompt: 'Brief.' });
    expect(ai.chats.at(-1)?.model).toBe('deepseek/deepseek-v4-flash');
    expect(ai.images.at(-1)?.model).toBe('black-forest-labs/flux.2-pro');
    await setConfig('AI_Text_Model', 'google/gemini-2.5-flash');
    await setConfig('AI_Image_Model', 'bytedance-seed/seedream-5-0-flash');
  });

  live('researches only novels without context, with web search', async () => {
    const novel = await prisma.novel.create({ data: { nameEn: `Context ${marker}` } });
    const filled = await prisma.novel.create({ data: { nameEn: `Filled ${marker}`, context: 'Known.' } });
    ids.novels.push(novel.id, filled.id);
    expect((await post(reader, 'prompts', promptBody({ feature: 'novel_context' }))).status).toBe(422);
    expect((await post(reader, 'prompts', promptBody({ feature: 'novel_context', novelId: filled.id }))).json.code).toBe('NOVEL_CONTEXT_EXISTS');
    const before = ai.chats.length;
    const result = await post(reader, 'prompts', promptBody({ feature: 'novel_context', novelId: novel.id }));
    expect(result.last?.type).toBe('result');
    expect(ai.chats[before]?.webSearch).toEqual({ maxResults: 5 });
  });

  live('records a data-policy fallback', async () => {
    ai.steps.push({ kind: 'policy-fallback' });
    const body = promptBody({ feature: 'selector_detection' });
    await post(reader, 'prompts', body);
    const call = await prisma.aiCall.findFirstOrThrow({ where: { actionId: body.actionId as string } });
    expect(call.dataPolicy).toBe('allow');
  });

  live('draws an image from a short brief', async () => {
    const user = await newReader(3);
    ai.steps.push({ kind: 'ok', text: 'A young swordsman in blue robes.' });
    const body = { actionId: crypto.randomUUID(), feature: 'character_image', prompt: 'Long brief about Rand.' };
    const result = await post(user, 'images', body);
    expect(result.last).toMatchObject({
      type: 'result',
      mimeType: 'image/jpeg',
      data: btoa('fake-image'),
      revisedPrompt: 'A young swordsman in blue robes.',
      balance: 0,
      lensesCharged: 3,
    });
    expect(ai.images.at(-1)).toMatchObject({ model: 'bytedance-seed/seedream-5-0-flash', prompt: 'A young swordsman in blue robes.' });
    const calls = await prisma.aiCall.findMany({ where: { actionId: body.actionId } });
    expect(calls.map((call) => call.step).sort()).toEqual(['brief', 'main']);
  });

  live('refunds an image when the brief or the image fails', async () => {
    const user = await newReader(3);
    for (const failure of [
      [{ kind: 'fail', code: 'AI_PROVIDER_FAILED' }],
      [{ kind: 'ok' }, { kind: 'fail', code: 'AI_REFUSED' }],
    ] as const) {
      ai.steps.push(...failure);
      const result = await post(user, 'images', { actionId: crypto.randomUUID(), feature: 'character_image', prompt: 'Brief.' });
      expect(result.last).toMatchObject({ type: 'error', refunded: true, balance: 3 });
    }
    expect(await balanceOf(user)).toBe(3);
  });

  live('answers JSON without the stream header', async () => {
    ai.steps.push({ kind: 'ok', text: 'Plain.' });
    const body = promptBody({ feature: 'selector_detection' });
    const result = await post(reader, 'prompts', body, { stream: false });
    expect(result.json).toMatchObject({ actionId: body.actionId, output: 'Plain.', attempt: 1 });
    ai.steps.push({ kind: 'fail', code: 'AI_TIMEOUT' });
    const failed = await post(reader, 'prompts', promptBody({ feature: 'selector_detection' }), { stream: false });
    expect([failed.status, failed.json.code]).toEqual([504, 'AI_TIMEOUT']);
  });

  live('never stores prompts or answers', async () => {
    const secret = `secret-${marker}`;
    ai.steps.push({ kind: 'ok', text: `answer ${secret}` });
    const body = promptBody({ prompt: `prompt ${secret}` });
    await post(reader, 'prompts', body);
    const action = await prisma.aiAction.findUniqueOrThrow({ where: { id: body.actionId as string }, include: { calls: true, transactions: true } });
    expect(JSON.stringify(action)).not.toContain(secret);
  });
});

describe('housekeeping', () => {
  live('refunds actions stuck by a restart, once', async () => {
    const user = await newReader(2);
    const actionId = crypto.randomUUID();
    await prisma.aiAction.create({ data: { id: actionId, userId: user.id, feature: 'page_summary', lensesCharged: 2 } });
    await withLensChange(prisma, { userId: user.id, delta: -2, type: 'AI_CHARGE', idempotencyKey: `ai-charge:${actionId}`, aiActionId: actionId });
    await prisma.$executeRaw`UPDATE "AiAction" SET "updatedAt" = NOW() - INTERVAL '1 hour' WHERE "id" = ${actionId}`;
    expect(await sweepStuckActions(prisma)).toBeGreaterThanOrEqual(1);
    expect(await sweepStuckActions(prisma)).toBe(0);
    expect(await balanceOf(user)).toBe(2);
  });

  live('keeps the legacy selector route with deprecation headers', async () => {
    const response = await app.handle(
      new Request('http://localhost/api/user/ai/chapter-selectors', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reader.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(422);
    expect(response.headers.get('deprecation')).toBeTruthy();
    expect(response.headers.get('sunset')).toBeTruthy();
  });

  live('keeps every balance equal to its ledger', async () => {
    expect(await auditBalances(prisma, ids.users)).toEqual([]);
  });
});

describe('stream', () => {
  it('sends heartbeats while an action runs', async () => {
    const response = ndjsonResponse(
      async (send) => {
        await Bun.sleep(60);
        send({ type: 'result', output: 'done' });
      },
      { heartbeatMs: 10 },
    );
    const frames = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Frame);
    expect(frames.filter((frame) => frame.type === 'heartbeat').length).toBeGreaterThan(0);
    expect(frames.at(-1)).toEqual({ type: 'result', output: 'done' });
  });
});
