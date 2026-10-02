import { afterAll, beforeAll, describe, expect, mock } from 'bun:test';
import { prisma } from '@/lib/db';
import { createSessionToken } from '@/lib/auth/session';
import { auditBalances, withLensChange } from '@/lib/billing/ledger';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { app } from '@/server';
import { type Actor, call, cleanup, live, makeActor } from './helpers/live-db';

// Billing emails are recorded instead of sent.
const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
mock.module('@/lib/email', () => ({
  sendEmail: async (message: { to: string; subject: string; text: string; html: string }) => {
    sent.push(message);
    return true;
  },
}));

type Json = Record<string, unknown>;
type RequestRow = {
  id: string;
  lenses: number;
  status: string;
  totalUsd: string;
  unitPriceUsd: string;
  contactChannel: string;
  contactHandle: string;
  rejectionReason: string | null;
};

const marker = crypto.randomUUID().slice(0, 8);
const ids = { users: [] as string[] };
let reader: Actor;
let other: Actor;
let guest: Actor;
let admin: Actor;

async function makeAdmin(): Promise<Actor> {
  const role = await prisma.role.findUniqueOrThrow({ where: { slug: SYSTEM_ROLES.superAdmin } });
  const tag = `admin-${marker}-${crypto.randomUUID().slice(0, 6)}`;
  const user = await prisma.user.create({
    data: { email: `${tag}@example.invalid`, username: tag, password: 'unused', name: 'Owner', isUser: false, isAdmin: true, adminRoleId: role.id },
  });
  return { id: user.id, token: await createSessionToken(prisma, user.id, 'admin') };
}

async function adminCall<T = Json>(method: string, path: string, body?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost/api/admin${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${admin.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Validation errors may be plain text.
  }
  return { status: response.status, body: parsed as T };
}

async function setConfig(key: string, value: string) {
  await prisma.config.upsert({ where: { key }, update: { value }, create: { key, value } });
}

function requestBody(extra: Json = {}) {
  return {
    id: crypto.randomUUID(),
    lenses: 500,
    quotedLensPriceUsd: '0.010000',
    contactChannel: 'WHATSAPP',
    contactHandle: '+964 770 123 4567',
    ...extra,
  };
}

async function balanceOf(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lensBalance: true } })).lensBalance;
}

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await setConfig('Lens_Price_USD', '0.01');
  await setConfig('Lens_Request_Min', '100');
  await setConfig('Lens_Pending_Requests_Max', '3');
  await setConfig('Billing_Notify_Email', 'owner@example.invalid');
  [reader, other, guest] = await Promise.all([
    makeActor('reader', marker),
    makeActor('reader', marker),
    makeActor('guest', marker),
  ]);
  admin = await makeAdmin();
  ids.users.push(reader.id, other.id, guest.id, admin.id);
});

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await prisma.config.deleteMany({ where: { key: 'Billing_Notify_Email' } });
  await prisma.billingRequest.deleteMany({ where: { userEmail: { contains: marker } } });
  await cleanup(ids);
});

describe('pricing', () => {
  live('is public and hides models', async () => {
    const response = await call<Json & { features: Json[] }>(null, 'GET', '/billing/pricing');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      currency: 'USD',
      available: true,
      lensPriceUsd: '0.010000',
      lensPriceMicros: 10_000,
      request: { min: 100, max: 50_000, pendingMax: 3 },
    });
    const summary = response.body.features.find((feature) => feature.key === 'page_summary');
    expect(summary).toMatchObject({ lenses: 2, enabled: true, maxPromptChars: 64_000 });
    expect(summary).not.toHaveProperty('model');
  });

  live('reports buying unavailable when the price is invalid', async () => {
    await setConfig('Lens_Price_USD', 'abc');
    const response = await call<Json>(null, 'GET', '/billing/pricing');
    await setConfig('Lens_Price_USD', '0.01');
    expect(response.body).toMatchObject({ available: false, lensPriceUsd: null, lensPriceMicros: null });
  });
});

describe('balance and notices', () => {
  live('shows gifts and purchases once in each app, never refunds', async () => {
    const gift = await withLensChange(prisma, { userId: reader.id, delta: 10, type: 'ADMIN_GIFT', idempotencyKey: `gift:${marker}-n`, note: 'Welcome' });
    await withLensChange(prisma, { userId: reader.id, delta: 2, type: 'AI_REFUND', idempotencyKey: `ai-refund:${marker}-n` });

    const website = await call<{ balance: number; notices: Json[] }>(reader, 'GET', '/billing/balance?surface=website');
    expect(website.body.balance).toBe(12);
    expect(website.body.notices).toEqual([
      expect.objectContaining({ id: gift.transaction.id, type: 'ADMIN_GIFT', lenses: 10, note: 'Welcome' }),
    ]);

    const seen = await call<Json>(reader, 'POST', '/billing/notices/seen', { ids: [gift.transaction.id], surface: 'website' });
    expect(seen.body).toEqual({ updated: 1 });
    expect((await call<{ notices: Json[] }>(reader, 'GET', '/billing/balance?surface=website')).body.notices).toEqual([]);
    // The extension still celebrates it.
    expect((await call<{ notices: Json[] }>(reader, 'GET', '/billing/balance?surface=extension')).body.notices).toHaveLength(1);
  });

  live('marks only the caller’s rows', async () => {
    const theirs = await withLensChange(prisma, { userId: other.id, delta: 3, type: 'ADMIN_GIFT', idempotencyKey: `gift:${marker}-other` });
    const response = await call<Json>(reader, 'POST', '/billing/notices/seen', { ids: [theirs.transaction.id], surface: 'extension' });
    expect(response.body).toEqual({ updated: 0 });
  });

  live('needs a surface', async () => {
    expect((await call(reader, 'GET', '/billing/balance')).status).toBe(422);
  });

  live('gives guests nothing', async () => {
    const response = await call<Json>(guest, 'GET', '/billing/balance?surface=extension');
    expect(response.body).toEqual({ balance: 0, notices: [] });
  });
});

describe('lens requests', () => {
  live('refuses guests', async () => {
    expect((await call(guest, 'POST', '/billing/requests', requestBody())).status).toBe(403);
  });

  live('checks the amount, the quote and the contact', async () => {
    const low = await call<Json>(reader, 'POST', '/billing/requests', requestBody({ lenses: 99 }));
    expect([low.status, low.body.code, low.body.min, low.body.max]).toEqual([400, 'LENS_AMOUNT_OUT_OF_RANGE', 100, 50_000]);
    const stale = await call<Json>(reader, 'POST', '/billing/requests', requestBody({ quotedLensPriceUsd: '0.02' }));
    expect([stale.status, stale.body.code, stale.body.lensPriceUsd]).toEqual([409, 'PRICE_CHANGED', '0.010000']);
    for (const [channel, handle] of [['WHATSAPP', '07701234567'], ['TELEGRAM', '@ab']]) {
      const bad = await call<Json>(reader, 'POST', '/billing/requests', requestBody({ contactChannel: channel, contactHandle: handle }));
      expect([bad.status, bad.body.code, bad.body.channel]).toEqual([400, 'CONTACT_INVALID', channel]);
    }
    expect((await call(reader, 'POST', '/billing/requests', requestBody({ contactHandle: undefined }))).status).toBe(422);
  });

  live('stores a priced snapshot with the normalized contact', async () => {
    const created = await call<{ request: RequestRow }>(other, 'POST', '/billing/requests', requestBody({
      lenses: 333, contactChannel: 'TELEGRAM', contactHandle: '@Story_Lens',
    }));
    expect(created.status).toBe(200);
    expect(created.body.request).toMatchObject({
      lenses: 333, unitPriceUsd: '0.010000', totalUsd: '3.33', status: 'PENDING', contactHandle: '@story_lens',
    });
    const stored = await prisma.billingRequest.findUniqueOrThrow({ where: { id: created.body.request.id } });
    expect(stored.userEmail).toContain(marker);
    const listed = await call<{ lastContact: Json }>(other, 'GET', '/billing/requests');
    expect(listed.body.lastContact).toEqual({ channel: 'TELEGRAM', handle: '@story_lens' });
    const owner = sent.find((email) => email.to === 'owner@example.invalid' && email.text.includes('@story_lens'));
    expect(owner?.text).toContain('https://t.me/story_lens');
  });

  live('returns the same request on a resend and refuses a reused ID', async () => {
    const body = requestBody();
    const first = await call<{ request: RequestRow }>(reader, 'POST', '/billing/requests', body);
    const again = await call<{ request: RequestRow }>(reader, 'POST', '/billing/requests', body);
    expect(again.body.request.id).toBe(first.body.request.id);
    expect(first.body.request.contactHandle).toBe('+9647701234567');
    const reused = await call<Json>(reader, 'POST', '/billing/requests', { ...body, lenses: 600 });
    expect([reused.status, reused.body.code]).toEqual([409, 'ID_CONFLICT']);
    await call(reader, 'POST', `/billing/requests/${first.body.request.id}/cancel`);
  });

  live('keeps at most three pending, even in parallel', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => call<Json>(reader, 'POST', '/billing/requests', requestBody())),
    );
    expect(results.filter((result) => result.status === 200)).toHaveLength(3);
    const refused = results.find((result) => result.status !== 200);
    expect(refused?.body).toMatchObject({ code: 'TOO_MANY_PENDING_REQUESTS', max: 3 });
    for (const result of results) {
      const request = (result.body as { request?: RequestRow }).request;
      if (request) await call(reader, 'POST', `/billing/requests/${request.id}/cancel`);
    }
  });

  live('cancels only pending requests', async () => {
    const created = await call<{ request: RequestRow }>(reader, 'POST', '/billing/requests', requestBody());
    const cancelled = await call<{ request: RequestRow }>(reader, 'POST', `/billing/requests/${created.body.request.id}/cancel`);
    expect(cancelled.body.request.status).toBe('CANCELLED');
    const again = await call<Json>(reader, 'POST', `/billing/requests/${created.body.request.id}/cancel`);
    expect([again.status, again.body.code, again.body.status]).toEqual([409, 'REQUEST_NOT_PENDING', 'CANCELLED']);
    expect((await call(other, 'POST', `/billing/requests/${created.body.request.id}/cancel`)).status).toBe(404);
  });

  live('limits a reader to ten requests a day', async () => {
    const limited = await makeActor('reader', marker);
    ids.users.push(limited.id);
    for (let index = 0; index < 10; index++) {
      const created = await call<{ request: RequestRow }>(limited, 'POST', '/billing/requests', requestBody());
      expect(created.status).toBe(200);
      await call(limited, 'POST', `/billing/requests/${created.body.request.id}/cancel`);
    }
    const eleventh = await call<Json>(limited, 'POST', '/billing/requests', requestBody());
    expect([eleventh.status, eleventh.body.code]).toEqual([429, 'REQUEST_RATE_LIMITED']);
  });
});

describe('dashboard review', () => {
  live('lists requests with the current and snapshot emails and the contact', async () => {
    const created = await call<{ request: RequestRow }>(other, 'POST', '/billing/requests', requestBody({ lenses: 200 }));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    await prisma.user.update({ where: { id: other.id }, data: { email: `changed-${marker}@example.invalid` } });
    const list = await adminCall<{ data: Array<Json & { user: Json; userEmail: string }>; counts: Json }>(
      'GET', `/billing/requests?status=PENDING&search=${encodeURIComponent('+9647701234567')}`,
    );
    const row = list.body.data.find((item) => item.id === created.body.request.id);
    expect(row?.userEmail).toBe(user.email);
    expect(row?.user.email).toBe(`changed-${marker}@example.invalid`);
    expect(row?.contactHandle).toBe('+9647701234567');
    expect(list.body.counts.PENDING).toBeGreaterThanOrEqual(1);
  });

  live('approves once, credits the lenses and emails the reader', async () => {
    const approver = await makeActor('reader', marker);
    ids.users.push(approver.id);
    const created = await call<{ request: RequestRow }>(approver, 'POST', '/billing/requests', requestBody({ lenses: 150 }));
    const id = created.body.request.id;
    const results = await Promise.all([
      adminCall<Json>('POST', `/billing/requests/${id}/approve`),
      adminCall<Json>('POST', `/billing/requests/${id}/approve`),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await balanceOf(approver.id)).toBe(150);
    expect(await prisma.lensTransaction.count({ where: { billingRequestId: id, type: 'TOP_UP' } })).toBe(1);
    const email = await prisma.user.findUniqueOrThrow({ where: { id: approver.id }, select: { email: true } });
    expect(sent.some((message) => message.to === email.email && message.text.includes('150'))).toBe(true);
    const notices = await call<{ notices: Json[] }>(approver, 'GET', '/billing/balance?surface=extension');
    expect(notices.body.notices).toEqual([expect.objectContaining({ type: 'TOP_UP', lenses: 150 })]);
  });

  live('refuses to approve cancelled requests and deleted readers', async () => {
    const cancelled = await call<{ request: RequestRow }>(reader, 'POST', '/billing/requests', requestBody());
    await call(reader, 'POST', `/billing/requests/${cancelled.body.request.id}/cancel`);
    const late = await adminCall<Json>('POST', `/billing/requests/${cancelled.body.request.id}/approve`);
    expect([late.status, late.body.code]).toEqual([409, 'REQUEST_NOT_PENDING']);

    const leaving = await makeActor('reader', marker);
    const orphan = await call<{ request: RequestRow }>(leaving, 'POST', '/billing/requests', requestBody());
    await cleanup({ users: [leaving.id] });
    const gone = await adminCall<Json>('POST', `/billing/requests/${orphan.body.request.id}/approve`);
    expect([gone.status, gone.body.code]).toEqual([409, 'REQUEST_USER_DELETED']);
    const still = await prisma.billingRequest.findUniqueOrThrow({ where: { id: orphan.body.request.id } });
    expect(still.status).toBe('PENDING');
    await prisma.billingRequest.delete({ where: { id: orphan.body.request.id } });
  });

  live('rejects with a reason the reader sees', async () => {
    const created = await call<{ request: RequestRow }>(reader, 'POST', '/billing/requests', requestBody({ note: '<b>ref 42</b>' }));
    const id = created.body.request.id;
    expect((await adminCall('POST', `/billing/requests/${id}/reject`, {})).status).toBe(422);
    expect((await adminCall('POST', `/billing/requests/${id}/reject`, { reason: 'no' })).status).toBe(422);
    const rejected = await adminCall<{ request: RequestRow }>('POST', `/billing/requests/${id}/reject`, { reason: 'Payment not received <x>' });
    expect(rejected.body.request).toMatchObject({ status: 'REJECTED', rejectionReason: 'Payment not received <x>' });
    const mine = await call<{ data: RequestRow[] }>(reader, 'GET', '/billing/requests');
    expect(mine.body.data.find((row) => row.id === id)?.rejectionReason).toBe('Payment not received <x>');
    const email = sent.find((message) => message.text.includes('Payment not received'));
    expect(email?.html).toContain('Payment not received &lt;x&gt;');
    const owner = sent.find((message) => message.text.includes('<b>ref 42</b>'));
    expect(owner?.html).toContain('&lt;b&gt;ref 42&lt;/b&gt;');
    expect(owner?.html).toContain('/brand/lens-coin-64.png');
  });
});

describe('gifts and adjustments', () => {
  live('gifts a reader once per ID', async () => {
    const before = await balanceOf(reader.id);
    const body = { id: crypto.randomUUID(), lenses: 50, note: 'Thanks for testing' };
    const gift = await adminCall<{ balance: number }>('POST', `/users/${reader.id}/lenses/gifts`, body);
    const again = await adminCall<{ balance: number }>('POST', `/users/${reader.id}/lenses/gifts`, body);
    expect([gift.status, again.status]).toEqual([200, 200]);
    expect(await balanceOf(reader.id)).toBe(before + 50);
    const reused = await adminCall<Json>('POST', `/users/${other.id}/lenses/gifts`, body);
    expect([reused.status, reused.body.code]).toEqual([409, 'ID_CONFLICT']);
    const history = await adminCall<{ data: Array<Json & { createdBy: Json }> }>('GET', `/users/${reader.id}/lenses`);
    expect(history.body.data[0]).toMatchObject({ type: 'ADMIN_GIFT', delta: 50, note: 'Thanks for testing' });
    expect(history.body.data[0]?.createdBy).toMatchObject({ id: admin.id });
  });

  live('refuses guests and dashboard-only accounts', async () => {
    const toGuest = await adminCall<Json>('POST', `/users/${guest.id}/lenses/gifts`, { id: crypto.randomUUID(), lenses: 5 });
    expect([toGuest.status, toGuest.body.code]).toEqual([409, 'GUEST_ACCOUNT']);
    const toAdmin = await adminCall<Json>('POST', `/users/${admin.id}/lenses/gifts`, { id: crypto.randomUUID(), lenses: 5 });
    expect([toAdmin.status, toAdmin.body.code]).toEqual([409, 'NOT_A_READER']);
  });

  live('adjusts without going below zero and hides the reason from the reader', async () => {
    const balance = await balanceOf(reader.id);
    const tooMuch = await adminCall<Json>('POST', `/users/${reader.id}/lenses/adjustments`, {
      id: crypto.randomUUID(), delta: -(balance + 1), reason: 'Correction',
    });
    expect([tooMuch.status, tooMuch.body.code, tooMuch.body.balance]).toEqual([409, 'BALANCE_TOO_LOW', balance]);
    const fixed = await adminCall<Json>('POST', `/users/${reader.id}/lenses/adjustments`, {
      id: crypto.randomUUID(), delta: -1, reason: 'Approved twice by mistake',
    });
    expect(fixed.status).toBe(200);
    const mine = await call<{ data: Array<Json> }>(reader, 'GET', '/billing/transactions?type=ADMIN_ADJUSTMENT');
    expect(mine.body.data[0]).toMatchObject({ delta: -1, note: null });
  });

  live('shows balances in the users list', async () => {
    const list = await adminCall<{ data: Array<{ id: string; lensBalance: number }> }>('GET', `/users/?search=${marker}`);
    expect(list.body.data.find((user) => user.id === reader.id)?.lensBalance).toBe(await balanceOf(reader.id));
  });
});

describe('pricing records and configs', () => {
  live('validates price edits', async () => {
    for (const body of [{ lenses: -1 }, { lenses: 10_001 }, { maxPromptChars: 10 }]) {
      expect((await adminCall('PUT', '/ai-pricing/page_summary', body)).status).toBe(422);
    }
    const saved = await adminCall<Json>('PUT', '/ai-pricing/page_summary', { lenses: 3 });
    expect(saved.body).toMatchObject({ key: 'page_summary', lenses: 3, updatedById: admin.id });
    await adminCall('PUT', '/ai-pricing/page_summary', { lenses: 2 });
    expect((await adminCall('PUT', '/ai-pricing/nope', { lenses: 1 })).status).toBe(404);
  });

  live('validates billing config values', async () => {
    const bad = await adminCall<Json>('PUT', '/configs/', { key: 'Lens_Price_USD', value: 'abc' });
    expect([bad.status, bad.body.code, bad.body.key]).toEqual([400, 'INVALID_CONFIG_VALUE', 'Lens_Price_USD']);
    expect((await adminCall('PUT', '/configs/', { key: 'Lens_Trial_Gift', value: '-1' })).status).toBe(400);
    expect((await adminCall('PUT', '/configs/', { key: 'AI_Text_Model', value: 'Not A Model' })).status).toBe(400);
    expect((await adminCall('PUT', '/configs/', { key: 'Some_Other_Key', value: 'anything' })).status).toBe(200);
    await prisma.config.deleteMany({ where: { key: 'Some_Other_Key' } });
  });

  live('summarizes requests and lenses', async () => {
    const summary = await adminCall<Json & { requests: Json; lenses: Json; ai: Json }>('GET', '/billing/summary?days=30');
    expect(summary.status).toBe(200);
    expect(summary.body.lensPriceUsd).toBe('0.010000');
    expect(Number(summary.body.requests.approvedLenses)).toBeGreaterThanOrEqual(150);
    expect(Number(summary.body.lenses.purchases)).toBeGreaterThanOrEqual(150);
  });

  live('keeps every balance equal to its ledger', async () => {
    expect(await auditBalances(prisma, ids.users)).toEqual([]);
  });
});
