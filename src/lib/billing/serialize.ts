import type { AiFeaturePrice, BillingRequest, LensTransaction } from '@prisma/client';
import { t } from 'elysia';

/** Shapes shared by the reader and dashboard billing routes. Money goes out as decimal strings. */

export const contactChannelSchema = t.Union([t.Literal('WHATSAPP'), t.Literal('TELEGRAM')]);

export const billingRequestStatusSchema = t.Union([
  t.Literal('PENDING'),
  t.Literal('APPROVED'),
  t.Literal('REJECTED'),
  t.Literal('CANCELLED'),
]);

export const lensTransactionTypeSchema = t.Union([
  t.Literal('TRIAL_GIFT'),
  t.Literal('ADMIN_GIFT'),
  t.Literal('ADMIN_ADJUSTMENT'),
  t.Literal('TOP_UP'),
  t.Literal('AI_CHARGE'),
  t.Literal('AI_REFUND'),
]);

export const billingRequestSchema = t.Object({
  id: t.String(),
  lenses: t.Number(),
  unitPriceUsd: t.String(),
  totalUsd: t.String(),
  status: billingRequestStatusSchema,
  contactChannel: contactChannelSchema,
  contactHandle: t.String(),
  note: t.Nullable(t.String()),
  rejectionReason: t.Nullable(t.String()),
  createdAt: t.Date(),
  reviewedAt: t.Nullable(t.Date()),
  cancelledAt: t.Nullable(t.Date()),
});

export function serializeRequest(request: BillingRequest) {
  return {
    id: request.id,
    lenses: request.lenses,
    unitPriceUsd: request.unitPriceUsd.toFixed(6),
    totalUsd: request.totalUsd.toFixed(2),
    status: request.status,
    contactChannel: request.contactChannel,
    contactHandle: request.contactHandle,
    note: request.note,
    rejectionReason: request.rejectionReason,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    cancelledAt: request.cancelledAt,
  };
}

export const lensTransactionSchema = t.Object({
  id: t.String(),
  type: lensTransactionTypeSchema,
  delta: t.Number(),
  balanceAfter: t.Number(),
  feature: t.Nullable(t.String()),
  note: t.Nullable(t.String()),
  billingRequestId: t.Nullable(t.String()),
  createdAt: t.Date(),
});

/** A ledger row as the reader sees it: adjustment reasons stay on the dashboard. */
export function serializeTransactionForReader(transaction: LensTransaction) {
  return {
    id: transaction.id,
    type: transaction.type,
    delta: transaction.delta,
    balanceAfter: transaction.balanceAfter,
    feature: transaction.aiFeature,
    note: transaction.type === 'ADMIN_GIFT' ? transaction.note : null,
    billingRequestId: transaction.billingRequestId,
    createdAt: transaction.createdAt,
  };
}

export const aiFeaturePriceSchema = t.Object({
  key: t.String(),
  nameEn: t.String(),
  nameAr: t.String(),
  descriptionEn: t.Nullable(t.String()),
  descriptionAr: t.Nullable(t.String()),
  lenses: t.Number(),
  enabled: t.Boolean(),
  maxPromptChars: t.Number(),
  maxOutputTokens: t.Number(),
  sortOrder: t.Number(),
  updatedById: t.Nullable(t.String()),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

/** The public part of a pricing record: no models or output caps. */
export const publicFeaturePriceSchema = t.Object({
  key: t.String(),
  nameEn: t.String(),
  nameAr: t.String(),
  descriptionEn: t.Nullable(t.String()),
  descriptionAr: t.Nullable(t.String()),
  lenses: t.Number(),
  enabled: t.Boolean(),
  maxPromptChars: t.Number(),
});

export function serializePublicFeature(feature: AiFeaturePrice) {
  return {
    key: feature.key,
    nameEn: feature.nameEn,
    nameAr: feature.nameAr,
    descriptionEn: feature.descriptionEn,
    descriptionAr: feature.descriptionAr,
    lenses: feature.lenses,
    enabled: feature.enabled,
    maxPromptChars: feature.maxPromptChars,
  };
}
