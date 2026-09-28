import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '@/env';
import type { EmailMessage } from '@/lib/email';
import {
  generateRegistrationCode,
  REGISTRATION_CODE_TTL_MS,
  REGISTRATION_MAX_ATTEMPTS,
  REGISTRATION_RESEND_COOLDOWN_MS,
  type StageResult,
} from './registration';

export const ACCOUNT_CHANGE_CODE_TTL_MS = REGISTRATION_CODE_TTL_MS;
export const ACCOUNT_CHANGE_RESEND_COOLDOWN_MS = REGISTRATION_RESEND_COOLDOWN_MS;
export const ACCOUNT_CHANGE_MAX_ATTEMPTS = REGISTRATION_MAX_ATTEMPTS;

type VerificationStore = Pick<PrismaClient, 'verification' | '$transaction'>;
type Translate = (text: { en: string; ar: string }) => string;

/** A signed-in change held until the emailed code confirms it. */
export type AccountChange =
  | { kind: 'password'; passwordHash: string }
  | { kind: 'email'; email: string };

export type AccountChangeKind = AccountChange['kind'];

type StoredChange = AccountChange & { codeHash: string; attempts: number };

export type ConsumeChangeResult<K extends AccountChangeKind> =
  | { status: 'verified'; change: Extract<AccountChange, { kind: K }> }
  | { status: 'invalid'; attemptsLeft: number }
  | { status: 'expired' };

// Shares Better Auth's `verification` table with registrations; the prefix
// keeps each user's pending change apart from other rows.
function identifierFor(userId: string, kind: AccountChangeKind): string {
  return `change-${kind}:${userId}`;
}

// Keyed by the server secret so a leaked table does not reveal codes.
function hashCode(identifier: string, code: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`${identifier}:${code}`).digest('hex');
}

function codeMatches(stored: string, identifier: string, code: string): boolean {
  const expected = Buffer.from(stored, 'hex');
  const actual = Buffer.from(hashCode(identifier, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseStored(value: string, kind: AccountChangeKind): StoredChange | null {
  try {
    const data: unknown = JSON.parse(value);
    if (
      typeof data !== 'object' ||
      data === null ||
      !('codeHash' in data) ||
      typeof data.codeHash !== 'string' ||
      !('attempts' in data) ||
      typeof data.attempts !== 'number' ||
      !('kind' in data) ||
      data.kind !== kind
    ) {
      return null;
    }
    const { codeHash, attempts } = data;
    if (kind === 'password' && 'passwordHash' in data && typeof data.passwordHash === 'string') {
      return { kind, passwordHash: data.passwordHash, codeHash, attempts };
    }
    if (kind === 'email' && 'email' in data && typeof data.email === 'string') {
      return { kind, email: data.email, codeHash, attempts };
    }
  } catch {
    // Treated as missing below.
  }
  return null;
}

/**
 * Replaces the user's pending change of this kind with a new code, unless one
 * was issued within the resend cooldown.
 */
export async function stageAccountChange(
  prisma: VerificationStore,
  userId: string,
  change: AccountChange,
  now = new Date(),
): Promise<StageResult> {
  const identifier = identifierFor(userId, change.kind);
  const latest = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: 'desc' },
  });

  if (latest) {
    const waitMs = latest.createdAt.getTime() + ACCOUNT_CHANGE_RESEND_COOLDOWN_MS - now.getTime();
    if (waitMs > 0) {
      return { status: 'cooldown', retryAfterSeconds: Math.ceil(waitMs / 1000) };
    }
  }

  const code = generateRegistrationCode();
  const expiresAt = new Date(now.getTime() + ACCOUNT_CHANGE_CODE_TTL_MS);
  const stored: StoredChange = { ...change, codeHash: hashCode(identifier, code), attempts: 0 };

  await prisma.$transaction([
    prisma.verification.deleteMany({ where: { identifier } }),
    prisma.verification.create({
      data: { identifier, value: JSON.stringify(stored), expiresAt, createdAt: now },
    }),
  ]);

  return { status: 'staged', code, expiresAt };
}

/** Removes the pending change, e.g. when its email could not be sent. */
export async function discardAccountChange(
  prisma: VerificationStore,
  userId: string,
  kind: AccountChangeKind,
): Promise<void> {
  await prisma.verification.deleteMany({ where: { identifier: identifierFor(userId, kind) } });
}

/**
 * Checks a code and, when it matches, removes the pending change so it can be
 * applied only once. Wrong codes count toward the attempt limit.
 */
export async function consumeAccountChange<K extends AccountChangeKind>(
  prisma: VerificationStore,
  userId: string,
  kind: K,
  code: string,
  now = new Date(),
): Promise<ConsumeChangeResult<K>> {
  const identifier = identifierFor(userId, kind);
  const row = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: 'desc' },
  });
  const stored = row ? parseStored(row.value, kind) : null;

  if (!row || !stored || row.expiresAt <= now || stored.attempts >= ACCOUNT_CHANGE_MAX_ATTEMPTS) {
    if (row) await prisma.verification.deleteMany({ where: { id: row.id } });
    return { status: 'expired' };
  }

  if (!codeMatches(stored.codeHash, identifier, code)) {
    const attempts = stored.attempts + 1;
    // Compare-and-set on the old value so parallel guesses cannot share one
    // attempt; a lost race still counts as a wrong guess.
    await prisma.verification.updateMany({
      where: { id: row.id, value: row.value },
      data: { value: JSON.stringify({ ...stored, attempts }) },
    });
    return { status: 'invalid', attemptsLeft: Math.max(0, ACCOUNT_CHANGE_MAX_ATTEMPTS - attempts) };
  }

  // Only the request that deletes the row may apply the change.
  const claimed = await prisma.verification.deleteMany({ where: { id: row.id, value: row.value } });
  if (claimed.count === 0) {
    return { status: 'expired' };
  }

  const { codeHash: _codeHash, attempts: _attempts, ...change } = stored;
  return { status: 'verified', change: change as Extract<AccountChange, { kind: K }> };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function emailLayout(dir: string, body: string): string {
  return `<div dir="${dir}" style="font-family:Inter,Arial,sans-serif;color:#1f1b2e;line-height:1.5">
${body}
</div>`;
}

export function accountChangeCodeEmail(
  to: string,
  code: string,
  kind: AccountChangeKind,
  translate: Translate,
): EmailMessage {
  const minutes = ACCOUNT_CHANGE_CODE_TTL_MS / 60_000;
  const subject = translate({
    en: `${code} is your Story Lens verification code`,
    ar: `${code} هو رمز التحقق الخاص بك في Story Lens`,
  });
  const intro =
    kind === 'password'
      ? translate({
          en: 'Enter this code to confirm your new Story Lens password:',
          ar: 'أدخل هذا الرمز لتأكيد كلمة المرور الجديدة لحسابك في Story Lens:',
        })
      : translate({
          en: 'Enter this code to confirm this address as your Story Lens email:',
          ar: 'أدخل هذا الرمز لتأكيد هذا العنوان كبريدك الإلكتروني في Story Lens:',
        });
  const expiry = translate({
    en: `The code expires in ${minutes} minutes.`,
    ar: `تنتهي صلاحية الرمز خلال ${minutes} دقائق.`,
  });
  const ignore = translate({
    en: 'If you did not request this, you can ignore this email; nothing changes without the code.',
    ar: 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة؛ لن يتغير شيء دون الرمز.',
  });
  const dir = translate({ en: 'ltr', ar: 'rtl' });

  return {
    to,
    subject,
    text: `${intro}\n\n${code}\n\n${expiry}\n${ignore}`,
    html: emailLayout(
      dir,
      `  <p>${intro}</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:24px 0" dir="ltr">${code}</p>
  <p>${expiry}</p>
  <p style="color:#6b6680">${ignore}</p>`,
    ),
  };
}

/** Tells the previous address that the account email moved. */
export function emailChangedNotice(
  previousEmail: string,
  newEmail: string,
  translate: Translate,
): EmailMessage {
  const subject = translate({
    en: 'Your Story Lens email was changed',
    ar: 'تم تغيير البريد الإلكتروني لحسابك في Story Lens',
  });
  const body = translate({
    en: 'The email address for your Story Lens account was changed to:',
    ar: 'تم تغيير البريد الإلكتروني لحسابك في Story Lens إلى:',
  });
  const warning = translate({
    en: 'If you did not make this change, contact Story Lens support right away.',
    ar: 'إذا لم تقم بهذا التغيير، يرجى التواصل مع دعم Story Lens فورًا.',
  });
  const dir = translate({ en: 'ltr', ar: 'rtl' });

  return {
    to: previousEmail,
    subject,
    text: `${body}\n\n${newEmail}\n\n${warning}`,
    html: emailLayout(
      dir,
      `  <p>${body}</p>
  <p style="font-weight:700" dir="ltr">${escapeHtml(newEmail)}</p>
  <p style="color:#6b6680">${warning}</p>`,
    ),
  };
}
