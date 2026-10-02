import type { Prisma } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { type LensChange, withLensChange } from '@/lib/billing/ledger';
import { lensTransactionTypeSchema } from '@/lib/billing/serialize';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

const transactionSchema = t.Object({
  id: t.String(),
  type: lensTransactionTypeSchema,
  delta: t.Number(),
  balanceAfter: t.Number(),
  feature: t.Nullable(t.String()),
  note: t.Nullable(t.String()),
  billingRequestId: t.Nullable(t.String()),
  createdBy: t.Nullable(t.Object({ id: t.String(), name: t.String(), email: t.String() })),
  createdAt: t.Date(),
});

type Row = Prisma.LensTransactionGetPayload<{ include: { createdBy: { select: { id: true; name: true; email: true } } } }>;

function serialize(row: Row) {
  return {
    id: row.id,
    type: row.type,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    feature: row.aiFeature,
    note: row.note,
    billingRequestId: row.billingRequestId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Gifts and adjustments only go to reader accounts that are not guests. */
async function assertReader(prisma: Prisma.TransactionClient, id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id }, select: { isGuest: true, isUser: true } });
  if (!user) throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'User not found' });
  if (user.isGuest) {
    throw new HttpError({ statusCode: 409, code: 'GUEST_ACCOUNT', message: 'Guests cannot hold lenses' });
  }
  if (!user.isUser) {
    throw new HttpError({ statusCode: 409, code: 'NOT_A_READER', message: 'This account has no reader access' });
  }
}

/** A resent dialog (same client ID) returns its change; another user or amount is a conflict. */
async function apply(prisma: Parameters<typeof withLensChange>[0], change: LensChange) {
  const applied = await withLensChange(prisma, change);
  if (applied.replayed && (applied.transaction.userId !== change.userId || applied.transaction.delta !== change.delta)) {
    throw new HttpError({ statusCode: 409, code: 'ID_CONFLICT', message: 'This ID is already used' });
  }
  return { transaction: { id: applied.transaction.id, delta: applied.transaction.delta, balanceAfter: applied.transaction.balanceAfter }, balance: applied.balance };
}

const changeResponse = t.Object({
  transaction: t.Object({ id: t.String(), delta: t.Number(), balanceAfter: t.Number() }),
  balance: t.Number(),
});

/** A reader's lenses on the dashboard: history, gifts (celebrated) and corrections (not). */
export const adminUserLenses = new Elysia({ prefix: '/users', tags: ['Admin: Lenses'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/:id/lenses',
    async ({ prisma, params, query }) => {
      const user = await prisma.user.findUnique({ where: { id: params.id }, select: { lensBalance: true } });
      if (!user) throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'User not found' });
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const where = { userId: params.id };
      const [rows, total] = await Promise.all([
        prisma.lensTransaction.findMany({
          where,
          include: { createdBy: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.lensTransaction.count({ where }),
      ]);
      return { balance: user.lensBalance, data: rows.map(serialize), page, pageSize, total };
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
      }),
      response: {
        200: t.Object({
          balance: t.Number(),
          data: t.Array(transactionSchema),
          page: t.Number(),
          pageSize: t.Number(),
          total: t.Number(),
        }),
      },
      detail: { summary: 'View a reader’s lens history' },
    },
  )

  .post(
    '/:id/lenses/gifts',
    async ({ prisma, params, body, authedUser }) => {
      await assertReader(prisma, params.id);
      const note = body.note ? sanitize(body.note) || null : null;
      return apply(prisma, {
        userId: params.id,
        delta: body.lenses,
        type: 'ADMIN_GIFT',
        idempotencyKey: `gift:${body.id}`,
        note,
        createdById: authedUser.id,
      });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        id: t.String({ format: 'uuid' }),
        lenses: t.Integer({ minimum: 1, maximum: 100_000 }),
        note: t.Optional(t.String({ maxLength: 300 })),
      }),
      response: { 200: changeResponse },
      detail: { summary: 'Gift lenses to a reader' },
    },
  )

  .post(
    '/:id/lenses/adjustments',
    async ({ prisma, params, body, authedUser }) => {
      await assertReader(prisma, params.id);
      if (body.delta === 0) throw new HttpError({ statusCode: 422, message: 'The change cannot be 0' });
      const reason = sanitize(body.reason);
      if (reason.length < 3) throw new HttpError({ statusCode: 422, message: 'Give a reason (at least 3 characters)' });
      return apply(prisma, {
        userId: params.id,
        delta: body.delta,
        type: 'ADMIN_ADJUSTMENT',
        idempotencyKey: `adjust:${body.id}`,
        note: reason,
        createdById: authedUser.id,
      });
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        id: t.String({ format: 'uuid' }),
        delta: t.Integer({ minimum: -100_000, maximum: 100_000 }),
        reason: t.String({ minLength: 3, maxLength: 300 }),
      }),
      response: { 200: changeResponse },
      detail: { summary: 'Correct a reader’s lens balance' },
    },
  );
