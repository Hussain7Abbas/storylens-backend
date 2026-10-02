import type { Prisma } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { getBillingConfig } from '@/lib/billing/config';
import { requestApprovedEmail, requestRejectedEmail } from '@/lib/billing/emails';
import { applyLensChange } from '@/lib/billing/ledger';
import { formatMicros, MICROS_PER_USD } from '@/lib/billing/money';
import { billingRequestSchema, billingRequestStatusSchema, serializeRequest } from '@/lib/billing/serialize';
import { sendEmail } from '@/lib/email';
import { authorize } from '@/middleware/authorize';
import { adminListQuery, pageArgs } from '@/schemas/admin';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

/** OpenRouter adds about 5.5% when credits are bought; the summary shows costs with it. */
const OPENROUTER_FEE = 1.055;

const personSelect = { id: true, name: true, email: true } as const;
const readerSelect = { id: true, email: true, username: true, name: true, lensBalance: true, isGuest: true } as const;

const adminRequestSchema = t.Composite([
  billingRequestSchema,
  t.Object({
    userEmail: t.String(),
    locale: t.String(),
    user: t.Nullable(
      t.Object({
        id: t.String(),
        email: t.String(),
        username: t.String(),
        name: t.String(),
        lensBalance: t.Number(),
        isGuest: t.Boolean(),
      }),
    ),
    reviewedBy: t.Nullable(t.Object({ id: t.String(), name: t.String(), email: t.String() })),
  }),
]);

const requestInclude = { user: { select: readerSelect }, reviewedBy: { select: personSelect } } as const;
type RequestWithPeople = Prisma.BillingRequestGetPayload<{ include: typeof requestInclude }>;

function serializeAdminRequest(request: RequestWithPeople) {
  return {
    ...serializeRequest(request),
    userEmail: request.userEmail,
    locale: request.locale,
    user: request.user,
    reviewedBy: request.reviewedBy,
  };
}

const countsSchema = t.Object({ PENDING: t.Number(), APPROVED: t.Number(), REJECTED: t.Number(), CANCELLED: t.Number() });

const summarySchema = t.Object({
  days: t.Number(),
  lensPriceUsd: t.Nullable(t.String()),
  requests: t.Object({
    counts: countsSchema,
    pendingLenses: t.Number(),
    pendingUsd: t.String(),
    approvedCount: t.Number(),
    approvedLenses: t.Number(),
    approvedUsd: t.String(),
    approvedLensesAllTime: t.Number(),
    approvedUsdAllTime: t.String(),
  }),
  lenses: t.Object({
    trial: t.Number(),
    gifts: t.Number(),
    purchases: t.Number(),
    adjustments: t.Number(),
    spent: t.Number(),
  }),
  ai: t.Object({
    calls: t.Number(),
    costUsd: t.String(),
    costWithFeeUsd: t.String(),
    dataPolicy: t.Object({ deny: t.Number(), allow: t.Number() }),
    features: t.Array(
      t.Object({
        feature: t.String(),
        actions: t.Number(),
        failures: t.Number(),
        refunds: t.Number(),
        costUsd: t.String(),
        averageCostUsd: t.String(),
        lensesCharged: t.Number(),
        valueUsd: t.Nullable(t.String()),
      }),
    ),
  }),
});

/** `5.1234567` → `"5.123457"`; summary money goes out as decimal strings. */
const usd = (value: number, decimals = 6) => value.toFixed(decimals);

async function findRequest(prisma: Prisma.TransactionClient, id: string): Promise<RequestWithPeople> {
  const request = await prisma.billingRequest.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Request not found' });
  return request;
}

function notPending(request: RequestWithPeople): never {
  const by = request.reviewedBy ? ` by ${request.reviewedBy.name}` : '';
  throw new HttpError({
    statusCode: 409,
    code: 'REQUEST_NOT_PENDING',
    message: `This request is already ${request.status.toLowerCase()}${by}`,
    details: { status: request.status, reviewedBy: request.reviewedBy },
  });
}

/**
 * Lens requests on the dashboard: list them with the reader's email and
 * contact, approve (credits the lenses) or reject with a reason, and the
 * billing and AI cost summary. Status changes are compare-and-set on PENDING.
 */
export const adminBilling = new Elysia({ prefix: '/billing', tags: ['Admin: Billing'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/requests',
    async ({ prisma, query }) => {
      // The query parser turns digit-only searches (phone numbers) into numbers.
      const search = query.search === undefined ? undefined : String(query.search).trim();
      const where: Prisma.BillingRequestWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { userEmail: { contains: search, mode: 'insensitive' } },
                { contactHandle: { contains: search, mode: 'insensitive' } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
                { user: { username: { contains: search, mode: 'insensitive' } } },
                { user: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total, grouped] = await Promise.all([
        prisma.billingRequest.findMany({
          where,
          include: requestInclude,
          // Pending requests are handled oldest first; history reads newest first.
          orderBy: { createdAt: query.status === 'PENDING' ? 'asc' : 'desc' },
          ...pageArgs(query),
        }),
        prisma.billingRequest.count({ where }),
        prisma.billingRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
      const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
      for (const group of grouped) counts[group.status] = group._count._all;
      return { data: rows.map(serializeAdminRequest), total, counts };
    },
    {
      query: t.Object({
        ...adminListQuery,
        search: t.Optional(t.Union([t.String({ maxLength: 200 }), t.Number()])),
        status: t.Optional(billingRequestStatusSchema),
      }),
      response: {
        200: t.Object({
          data: t.Array(adminRequestSchema),
          total: t.Number(),
          counts: countsSchema,
        }),
      },
      detail: { summary: 'List lens requests' },
    },
  )

  .post(
    '/requests/:id/approve',
    async ({ prisma, params, authedUser }) => {
      const { request, applied } = await prisma.$transaction(async (tx) => {
        const { count } = await tx.billingRequest.updateMany({
          where: { id: params.id, status: 'PENDING' },
          data: { status: 'APPROVED', reviewedById: authedUser.id, reviewedAt: new Date() },
        });
        const current = await findRequest(tx, params.id);
        if (count === 0) notPending(current);
        if (!current.userId) {
          // Throwing rolls the status change back.
          throw new HttpError({
            statusCode: 409,
            code: 'REQUEST_USER_DELETED',
            message: 'The reader’s account no longer exists',
          });
        }
        const lens = await applyLensChange(tx, {
          userId: current.userId,
          delta: current.lenses,
          type: 'TOP_UP',
          idempotencyKey: `billing:${current.id}`,
          billingRequestId: current.id,
          createdById: authedUser.id,
        });
        return { request: await findRequest(tx, params.id), applied: lens };
      });

      void sendEmail(requestApprovedEmail(request, applied.balance)).catch((error) =>
        console.error('[billing] could not email an approval', error),
      );

      return {
        request: serializeAdminRequest(request),
        transaction: {
          id: applied.transaction.id,
          delta: applied.transaction.delta,
          balanceAfter: applied.transaction.balanceAfter,
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({
          request: adminRequestSchema,
          transaction: t.Object({ id: t.String(), delta: t.Number(), balanceAfter: t.Number() }),
        }),
      },
      detail: { summary: 'Approve a lens request and add the lenses' },
    },
  )

  .post(
    '/requests/:id/reject',
    async ({ prisma, params, body, authedUser }) => {
      const reason = sanitize(body.reason);
      if (reason.length < 3) {
        throw new HttpError({ statusCode: 422, message: 'Give the reader a reason (at least 3 characters)' });
      }
      const request = await prisma.$transaction(async (tx) => {
        const { count } = await tx.billingRequest.updateMany({
          where: { id: params.id, status: 'PENDING' },
          data: { status: 'REJECTED', rejectionReason: reason, reviewedById: authedUser.id, reviewedAt: new Date() },
        });
        const current = await findRequest(tx, params.id);
        if (count === 0) notPending(current);
        return current;
      });

      void sendEmail(requestRejectedEmail(request)).catch((error) =>
        console.error('[billing] could not email a rejection', error),
      );

      return { request: serializeAdminRequest(request) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.String({ minLength: 3, maxLength: 500 }) }),
      response: { 200: t.Object({ request: adminRequestSchema }) },
      detail: { summary: 'Reject a lens request with a reason' },
    },
  )

  .get(
    '/summary',
    async ({ prisma, query }) => {
      const days = query.days ?? 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const config = await getBillingConfig(prisma);
      const priceUsd = config.lensPriceMicros === null ? null : config.lensPriceMicros / MICROS_PER_USD;

      const [grouped, pending, approvedWindow, approvedAll, ledger, calls, policies, features] = await Promise.all([
        prisma.billingRequest.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.billingRequest.aggregate({ where: { status: 'PENDING' }, _sum: { lenses: true, totalUsd: true } }),
        prisma.billingRequest.aggregate({
          where: { status: 'APPROVED', reviewedAt: { gte: since } },
          _sum: { lenses: true, totalUsd: true },
          _count: { _all: true },
        }),
        prisma.billingRequest.aggregate({ where: { status: 'APPROVED' }, _sum: { lenses: true, totalUsd: true } }),
        prisma.lensTransaction.groupBy({ by: ['type'], where: { createdAt: { gte: since } }, _sum: { delta: true } }),
        prisma.aiCall.aggregate({ where: { createdAt: { gte: since } }, _sum: { costUsd: true }, _count: { _all: true } }),
        prisma.aiCall.groupBy({ by: ['dataPolicy'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.$queryRaw<
          Array<{ feature: string; actions: number; failures: number; refunds: number; costUsd: number; lensesCharged: number }>
        >`
          SELECT a."feature",
            COUNT(*)::int AS "actions",
            COUNT(*) FILTER (WHERE a."status" = 'FAILED')::int AS "failures",
            COUNT(*) FILTER (WHERE a."refunded")::int AS "refunds",
            COALESCE(SUM(c."cost"), 0)::float8 AS "costUsd",
            COALESCE(SUM(CASE WHEN a."refunded" THEN 0 ELSE a."lensesCharged" END), 0)::int AS "lensesCharged"
          FROM "AiAction" a
          LEFT JOIN (SELECT "actionId", SUM("costUsd") AS "cost" FROM "AiCall" GROUP BY "actionId") c ON c."actionId" = a."id"
          WHERE a."createdAt" >= ${since}
          GROUP BY a."feature"
          ORDER BY a."feature"`,
      ]);

      const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
      for (const group of grouped) counts[group.status] = group._count._all;
      const sumOf = (types: string[]) =>
        ledger.filter((row) => types.includes(row.type)).reduce((total, row) => total + (row._sum.delta ?? 0), 0);
      const aiCost = Number(calls._sum.costUsd ?? 0);

      return {
        days,
        lensPriceUsd: config.lensPriceMicros === null ? null : formatMicros(config.lensPriceMicros),
        requests: {
          counts,
          pendingLenses: pending._sum.lenses ?? 0,
          pendingUsd: usd(Number(pending._sum.totalUsd ?? 0), 2),
          approvedCount: approvedWindow._count._all,
          approvedLenses: approvedWindow._sum.lenses ?? 0,
          approvedUsd: usd(Number(approvedWindow._sum.totalUsd ?? 0), 2),
          approvedLensesAllTime: approvedAll._sum.lenses ?? 0,
          approvedUsdAllTime: usd(Number(approvedAll._sum.totalUsd ?? 0), 2),
        },
        lenses: {
          trial: sumOf(['TRIAL_GIFT']),
          gifts: sumOf(['ADMIN_GIFT']),
          purchases: sumOf(['TOP_UP']),
          adjustments: sumOf(['ADMIN_ADJUSTMENT']),
          spent: -sumOf(['AI_CHARGE', 'AI_REFUND']),
        },
        ai: {
          calls: calls._count._all,
          costUsd: usd(aiCost),
          costWithFeeUsd: usd(aiCost * OPENROUTER_FEE),
          dataPolicy: {
            deny: policies.find((row) => row.dataPolicy === 'deny')?._count._all ?? 0,
            allow: policies.find((row) => row.dataPolicy === 'allow')?._count._all ?? 0,
          },
          features: features.map((row) => ({
            feature: row.feature,
            actions: row.actions,
            failures: row.failures,
            refunds: row.refunds,
            costUsd: usd(row.costUsd),
            averageCostUsd: usd(row.actions ? (row.costUsd * OPENROUTER_FEE) / row.actions : 0),
            lensesCharged: row.lensesCharged,
            valueUsd: priceUsd === null ? null : usd(row.lensesCharged * priceUsd),
          })),
        },
      };
    },
    {
      query: t.Object({ days: t.Optional(t.Numeric({ minimum: 1, maximum: 365, default: 30 })) }),
      response: { 200: summarySchema },
      detail: { summary: 'View lens sales and AI cost summary' },
    },
  );
