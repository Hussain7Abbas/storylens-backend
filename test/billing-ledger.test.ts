import { afterAll, beforeAll, describe, expect } from 'bun:test';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { mergeGuestInto } from '@/lib/auth/oauth';
import { stageRegistration } from '@/lib/auth/registration';
import { auditBalances, withLensChange } from '@/lib/billing/ledger';
import { grantTrialGift } from '@/lib/billing/trial';
import { HttpError } from '@/utils/errors';
import { type Actor, call, cleanup, live, makeActor } from './helpers/live-db';

const marker = crypto.randomUUID().slice(0, 8);
const ids = { users: [] as string[] };
let reader: Actor;

async function setTrial(value: string) {
  await prisma.config.upsert({
    where: { key: 'Lens_Trial_Gift' },
    update: { value },
    create: { key: 'Lens_Trial_Gift', value },
  });
}

async function balanceOf(userId: string) {
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { lensBalance: true } })).lensBalance;
}

async function caught(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected an HttpError');
}

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  reader = await makeActor('reader', marker);
  ids.users.push(reader.id);
});

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await setTrial('10');
  await cleanup(ids);
});

describe('lens ledger', () => {
  live('refuses a negative balance at the database level', async () => {
    const update = async () => prisma.$executeRaw`UPDATE "User" SET "lensBalance" = -1 WHERE "id" = ${reader.id}`;
    await expect(update()).rejects.toThrow();
  });

  live('credits and debits with a row per change', async () => {
    const credit = await withLensChange(prisma, {
      userId: reader.id, delta: 10, type: 'ADMIN_GIFT', idempotencyKey: `gift:${marker}-a`,
    });
    const debit = await withLensChange(prisma, {
      userId: reader.id, delta: -4, type: 'ADMIN_ADJUSTMENT', idempotencyKey: `adjust:${marker}-a`,
    });
    expect([credit.transaction.balanceAfter, debit.transaction.balanceAfter]).toEqual([10, 6]);
    expect(await balanceOf(reader.id)).toBe(6);
  });

  live('refuses a debit below zero and writes nothing', async () => {
    const before = await prisma.lensTransaction.count({ where: { userId: reader.id } });
    const charge = await caught(withLensChange(prisma, {
      userId: reader.id, delta: -100, type: 'AI_CHARGE', idempotencyKey: `ai-charge:${marker}-big`, aiFeature: 'page_summary',
    }));
    expect([charge.statusCode, charge.errorCode, charge.details]).toEqual([
      402, 'INSUFFICIENT_LENSES', { required: 100, balance: 6, feature: 'page_summary' },
    ]);
    const adjust = await caught(withLensChange(prisma, {
      userId: reader.id, delta: -100, type: 'ADMIN_ADJUSTMENT', idempotencyKey: `adjust:${marker}-big`,
    }));
    expect([adjust.statusCode, adjust.errorCode]).toEqual([409, 'BALANCE_TOO_LOW']);
    expect(await prisma.lensTransaction.count({ where: { userId: reader.id } })).toBe(before);
    expect(await balanceOf(reader.id)).toBe(6);
  });

  live('applies a key once, sequentially and in parallel', async () => {
    const change = { userId: reader.id, delta: 5, type: 'ADMIN_GIFT' as const, idempotencyKey: `gift:${marker}-once` };
    const first = await withLensChange(prisma, change);
    const again = await withLensChange(prisma, change);
    expect([first.replayed, again.replayed]).toEqual([false, true]);
    const racing = { ...change, idempotencyKey: `gift:${marker}-race` };
    const results = await Promise.all(Array.from({ length: 5 }, () => withLensChange(prisma, racing)));
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await balanceOf(reader.id)).toBe(16);
  });

  live('lets exactly as many parallel debits through as the balance covers', async () => {
    const spender = await makeActor('reader', marker);
    ids.users.push(spender.id);
    await withLensChange(prisma, { userId: spender.id, delta: 10, type: 'ADMIN_GIFT', idempotencyKey: `gift:${marker}-spender` });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        withLensChange(prisma, {
          userId: spender.id, delta: -1, type: 'AI_CHARGE', idempotencyKey: `ai-charge:${marker}-${index}`,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
    expect(await balanceOf(spender.id)).toBe(0);
    expect(await prisma.lensTransaction.count({ where: { userId: spender.id, type: 'AI_CHARGE' } })).toBe(10);
    expect(await auditBalances(prisma, [spender.id])).toEqual([]);
  });

  live('moves a guest balance into the account it merges into', async () => {
    const guest = await makeActor('guest', marker);
    const target = await makeActor('reader', marker);
    ids.users.push(target.id);
    await withLensChange(prisma, { userId: guest.id, delta: 5, type: 'ADMIN_GIFT', idempotencyKey: `gift:${marker}-guest` });
    await mergeGuestInto(prisma, guest.id, target.id);
    expect(await balanceOf(target.id)).toBe(5);
    expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();
    expect(await auditBalances(prisma, [target.id])).toEqual([]);
  });
});

describe('trial gift', () => {
  async function register(email: string, guestToken?: string) {
    const username = email.split('@')[0] ?? email;
    const staged = await stageRegistration(prisma, {
      email, username, name: username, passwordHash: await bcrypt.hash('unused-password', 4),
    });
    if (staged.status !== 'staged') throw new Error('registration was not staged');
    const response = await call<{ user: { id: string }; gift: { lenses: number } | null }>(
      guestToken ? { id: '', token: guestToken } : null,
      'POST', '/auth/register/verify', { email, code: staged.code },
    );
    if (response.body.user?.id) ids.users.push(response.body.user.id);
    return response;
  }

  live('gives a new registered reader the trial once', async () => {
    await setTrial('10');
    const response = await register(`trial-${marker}@example.invalid`);
    expect(response.status).toBe(200);
    expect(response.body.gift).toEqual({ lenses: 10 });
    const userId = response.body.user.id;
    expect(await balanceOf(userId)).toBe(10);
    const again = await prisma.$transaction((tx) => grantTrialGift(tx, userId));
    expect(again).toBeNull();
    expect(await prisma.lensTransaction.count({ where: { userId, type: 'TRIAL_GIFT' } })).toBe(1);
  });

  live('gives an upgrading guest the trial', async () => {
    await setTrial('10');
    const guest = await makeActor('guest', marker);
    ids.users.push(guest.id);
    const response = await register(`upgrade-${marker}@example.invalid`, guest.token);
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(guest.id);
    expect(await balanceOf(guest.id)).toBe(10);
  });

  live('gives nothing when the trial is 0', async () => {
    await setTrial('0');
    const response = await register(`zero-${marker}@example.invalid`);
    expect(response.status).toBe(200);
    expect(response.body.gift).toBeNull();
    expect(await prisma.lensTransaction.count({ where: { userId: response.body.user.id } })).toBe(0);
  });

  live('never gives guests a trial', async () => {
    const guest = await call<{ user: { id: string } }>(null, 'POST', '/auth/guest', { username: `g${marker}` });
    ids.users.push(guest.body.user.id);
    expect(await prisma.lensTransaction.count({ where: { userId: guest.body.user.id } })).toBe(0);
  });
});
