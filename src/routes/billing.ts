import type { Prisma } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { env } from '@/env';
import { getBillingConfig } from '@/lib/billing/config';
import { normalizeContact } from '@/lib/billing/contact';
import { newRequestEmail } from '@/lib/billing/emails';
import { centsToDecimal, formatMicros, microsToDecimal, parseUsdToMicros, priceCents } from '@/lib/billing/money';
import {
  billingRequestSchema,
  contactChannelSchema,
  lensTransactionSchema,
  lensTransactionTypeSchema,
  publicFeaturePriceSchema,
  serializePublicFeature,
  serializeRequest,
  serializeTransactionForReader,
} from '@/lib/billing/serialize';
import { sendEmail } from '@/lib/email';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

/** Ledger rows the reader is told about once in each app (gifts and purchases). */
const NOTICE_TYPES = ['TRIAL_GIFT', 'ADMIN_GIFT', 'TOP_UP'] as const;
const surfaceSchema = t.Union([t.Literal('website'), t.Literal('extension')]);
const seenColumn = (surface: 'website' | 'extension') =>
  surface === 'website' ? ('websiteSeenAt' as const) : ('extensionSeenAt' as const);

const REQUESTS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const pageQuery = {
  page: t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 50, default: 20 })),
};

function page(query: { page?: number; pageSize?: number }) {
  const current = query.page ?? 1;
  const size = query.pageSize ?? 20;
  return { page: current, pageSize: size, skip: (current - 1) * size, take: size };
}

/**
 * Lenses for readers, mounted at `/api/user/billing`: public prices, the
 * balance and its history, gift and purchase notices, and lens requests.
 */
export const billing = new Elysia({ prefix: '/billing', tags: ['Billing'] })
  .use(setup)

  // Public: the website's pricing page and the extension's buttons read it.
  .get(
    '/pricing',
    async ({ prisma, set }) => {
      const [config, features] = await Promise.all([
        getBillingConfig(prisma),
        prisma.aiFeaturePrice.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
      ]);
      set.headers['cache-control'] = 'public, max-age=60';
      const price = config.lensPriceMicros;
      return {
        currency: 'USD' as const,
        available: price !== null,
        lensPriceUsd: price === null ? null : formatMicros(price),
        lensPriceMicros: price,
        trialLenses: config.trialLenses,
        request: { min: config.requestMin, max: config.requestMax, pendingMax: config.pendingMax },
        cloudAi: { enabled: config.cloudAiEnabled && Boolean(env.OPENROUTER_API_KEY) },
        features: features.map(serializePublicFeature),
      };
    },
    {
      response: {
        200: t.Object({
          currency: t.Literal('USD'),
          available: t.Boolean(),
          lensPriceUsd: t.Nullable(t.String()),
          lensPriceMicros: t.Nullable(t.Number()),
          trialLenses: t.Number(),
          request: t.Object({ min: t.Number(), max: t.Number(), pendingMax: t.Number() }),
          cloudAi: t.Object({ enabled: t.Boolean() }),
          features: t.Array(publicFeaturePriceSchema),
        }),
      },
    },
  )

  .use(authorize('user'))

  .get(
    '/balance',
    async ({ prisma, authedUser, query }) => {
      const [user, notices] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: authedUser.id }, select: { lensBalance: true } }),
        prisma.lensTransaction.findMany({
          where: { userId: authedUser.id, type: { in: [...NOTICE_TYPES] }, [seenColumn(query.surface)]: null },
          orderBy: { createdAt: 'asc' },
          take: 20,
        }),
      ]);
      return {
        balance: user.lensBalance,
        notices: notices.map((notice) => ({
          id: notice.id,
          type: notice.type as (typeof NOTICE_TYPES)[number],
          lenses: notice.delta,
          note: notice.type === 'ADMIN_GIFT' ? notice.note : null,
          createdAt: notice.createdAt,
        })),
      };
    },
    {
      query: t.Object({ surface: surfaceSchema }),
      response: {
        200: t.Object({
          balance: t.Number(),
          notices: t.Array(
            t.Object({
              id: t.String(),
              type: t.Union([t.Literal('TRIAL_GIFT'), t.Literal('ADMIN_GIFT'), t.Literal('TOP_UP')]),
              lenses: t.Number(),
              note: t.Nullable(t.String()),
              createdAt: t.Date(),
            }),
          ),
        }),
      },
    },
  )

  .post(
    '/notices/seen',
    async ({ prisma, authedUser, body }) => {
      const { count } = await prisma.lensTransaction.updateMany({
        where: {
          id: { in: body.ids },
          userId: authedUser.id,
          type: { in: [...NOTICE_TYPES] },
          [seenColumn(body.surface)]: null,
        },
        data: { [seenColumn(body.surface)]: new Date() },
      });
      return { updated: count };
    },
    {
      body: t.Object({
        ids: t.Array(t.String({ format: 'uuid' }), { minItems: 1, maxItems: 20 }),
        surface: surfaceSchema,
      }),
      response: { 200: t.Object({ updated: t.Number() }) },
    },
  )

  .get(
    '/transactions',
    async ({ prisma, authedUser, query }) => {
      const paging = page(query);
      const where: Prisma.LensTransactionWhereInput = {
        userId: authedUser.id,
        ...(query.type ? { type: query.type } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.lensTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: paging.skip, take: paging.take }),
        prisma.lensTransaction.count({ where }),
      ]);
      return { data: rows.map(serializeTransactionForReader), page: paging.page, pageSize: paging.pageSize, total };
    },
    {
      query: t.Object({ ...pageQuery, type: t.Optional(lensTransactionTypeSchema) }),
      response: {
        200: t.Object({
          data: t.Array(lensTransactionSchema),
          page: t.Number(),
          pageSize: t.Number(),
          total: t.Number(),
        }),
      },
    },
  )

  .get(
    '/requests',
    async ({ prisma, authedUser, query }) => {
      const paging = page(query);
      const where = { userId: authedUser.id };
      const [rows, total, latest] = await Promise.all([
        prisma.billingRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: paging.skip, take: paging.take }),
        prisma.billingRequest.count({ where }),
        prisma.billingRequest.findFirst({
          where,
          orderBy: { createdAt: 'desc' },
          select: { contactChannel: true, contactHandle: true },
        }),
      ]);
      return {
        data: rows.map(serializeRequest),
        page: paging.page,
        pageSize: paging.pageSize,
        total,
        lastContact: latest ? { channel: latest.contactChannel, handle: latest.contactHandle } : null,
      };
    },
    {
      query: t.Object(pageQuery),
      response: {
        200: t.Object({
          data: t.Array(billingRequestSchema),
          page: t.Number(),
          pageSize: t.Number(),
          total: t.Number(),
          lastContact: t.Nullable(t.Object({ channel: contactChannelSchema, handle: t.String() })),
        }),
      },
    },
  )

  .post(
    '/requests',
    async ({ prisma, authedUser, body, lang, t: translate }) => {
      if (authedUser.isGuest) {
        throw new HttpError({
          statusCode: 403,
          code: 'REGISTERED_ACCOUNT_REQUIRED',
          message: translate({
            en: 'Create a free account to buy lenses',
            ar: 'أنشئ حسابًا مجانيًا لشراء العدسات',
          }),
        });
      }

      // A resent form returns the request it already created.
      const existing = await prisma.billingRequest.findUnique({ where: { id: body.id } });
      if (existing) {
        if (existing.userId === authedUser.id && existing.lenses === body.lenses) {
          return { request: serializeRequest(existing) };
        }
        throw new HttpError({ statusCode: 409, code: 'ID_CONFLICT', message: 'This request ID is already used' });
      }

      const config = await getBillingConfig(prisma);
      const price = config.lensPriceMicros;
      if (price === null) {
        throw new HttpError({
          statusCode: 503,
          code: 'BILLING_UNAVAILABLE',
          message: translate({
            en: 'Buying lenses is not available right now',
            ar: 'شراء العدسات غير متاح حاليًا',
          }),
        });
      }

      if (body.lenses < config.requestMin || body.lenses > config.requestMax) {
        throw new HttpError({
          code: 'LENS_AMOUNT_OUT_OF_RANGE',
          message: translate({
            en: `Request between ${config.requestMin} and ${config.requestMax} lenses`,
            ar: `اطلب بين ${config.requestMin} و${config.requestMax} عدسة`,
          }),
          details: { min: config.requestMin, max: config.requestMax },
        });
      }

      const contactHandle = normalizeContact(body.contactChannel, body.contactHandle);
      if (!contactHandle) {
        throw new HttpError({
          code: 'CONTACT_INVALID',
          message:
            body.contactChannel === 'WHATSAPP'
              ? translate({
                  en: 'Enter your WhatsApp number with the country code, such as +964 770 123 4567',
                  ar: 'أدخل رقم واتساب مع رمز الدولة، مثل ‎+964 770 123 4567',
                })
              : translate({
                  en: 'Enter your Telegram username (such as @name) or number with the country code',
                  ar: 'أدخل اسم مستخدم تيليجرام (مثل ‎@name) أو الرقم مع رمز الدولة',
                }),
          details: { channel: body.contactChannel },
        });
      }

      if (parseUsdToMicros(body.quotedLensPriceUsd) !== price) {
        throw new HttpError({
          statusCode: 409,
          code: 'PRICE_CHANGED',
          message: translate({
            en: `The price changed to $${formatMicros(price)} per lens`,
            ar: `تغيّر السعر إلى ${formatMicros(price)}$ لكل عدسة`,
          }),
          details: { lensPriceUsd: formatMicros(price), lensPriceMicros: price },
        });
      }

      const request = await prisma.$transaction(async (tx) => {
        // Serialize this reader's submissions so two at once cannot both pass the limits.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20261002, hashtext(${authedUser.id}))`;

        const recent = await tx.billingRequest.findFirst({
          where: { userId: authedUser.id, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
          orderBy: { createdAt: 'asc' },
          skip: REQUESTS_PER_DAY - 1,
          select: { createdAt: true },
        });
        if (recent) {
          const oldest = await tx.billingRequest.findFirst({
            where: { userId: authedUser.id, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          });
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil(((oldest?.createdAt.getTime() ?? Date.now()) + DAY_MS - Date.now()) / 1000),
          );
          throw new HttpError({
            statusCode: 429,
            code: 'REQUEST_RATE_LIMITED',
            message: translate({
              en: 'Too many requests today. Please try again later.',
              ar: 'طلبات كثيرة اليوم. حاول مرة أخرى لاحقًا.',
            }),
            details: { retryAfterSeconds },
          });
        }

        const pending = await tx.billingRequest.count({ where: { userId: authedUser.id, status: 'PENDING' } });
        if (pending >= config.pendingMax) {
          throw new HttpError({
            statusCode: 409,
            code: 'TOO_MANY_PENDING_REQUESTS',
            message: translate({
              en: `You already have ${pending} pending requests. Wait for them or cancel one.`,
              ar: `لديك ${pending} طلبات قيد الانتظار. انتظرها أو ألغِ أحدها.`,
            }),
            details: { max: config.pendingMax },
          });
        }

        const user = await tx.user.findUniqueOrThrow({ where: { id: authedUser.id }, select: { email: true } });
        return tx.billingRequest.create({
          data: {
            id: body.id,
            userId: authedUser.id,
            userEmail: user.email,
            lenses: body.lenses,
            unitPriceUsd: microsToDecimal(price),
            totalUsd: centsToDecimal(priceCents(body.lenses, price)),
            contactChannel: body.contactChannel,
            contactHandle,
            note: body.note ? sanitize(body.note) || null : null,
            locale: lang,
          },
        });
      });

      // Tell the owner, who then contacts the reader to arrange payment.
      const ownerEmail = config.notifyEmail ?? env.DASHBOARD_ADMIN_EMAIL ?? null;
      if (ownerEmail) {
        void sendEmail(newRequestEmail(ownerEmail, request, { name: authedUser.name, username: authedUser.username })).catch(
          (error) => console.error('[billing] could not email the new request', error),
        );
      }

      return { request: serializeRequest(request) };
    },
    {
      body: t.Object({
        id: t.String({ format: 'uuid' }),
        lenses: t.Integer({ minimum: 1 }),
        quotedLensPriceUsd: t.String({ maxLength: 20 }),
        contactChannel: contactChannelSchema,
        contactHandle: t.String({ minLength: 1, maxLength: 64 }),
        note: t.Optional(t.String({ maxLength: 500 })),
      }),
      response: { 200: t.Object({ request: billingRequestSchema }) },
    },
  )

  .post(
    '/requests/:id/cancel',
    async ({ prisma, authedUser, params, t: translate }) => {
      const { count } = await prisma.billingRequest.updateMany({
        where: { id: params.id, userId: authedUser.id, status: 'PENDING' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      const request = await prisma.billingRequest.findFirst({ where: { id: params.id, userId: authedUser.id } });
      if (!request) {
        throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Request not found' });
      }
      if (count === 0) {
        throw new HttpError({
          statusCode: 409,
          code: 'REQUEST_NOT_PENDING',
          message: translate({ en: 'This request is no longer pending', ar: 'لم يعد هذا الطلب قيد الانتظار' }),
          details: { status: request.status },
        });
      }
      return { request: serializeRequest(request) };
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: t.Object({ request: billingRequestSchema }) },
    },
  );
