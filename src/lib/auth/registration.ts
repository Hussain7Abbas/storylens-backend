import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '@/env';
import type { EmailMessage } from '@/lib/email';

export const REGISTRATION_CODE_TTL_MS = 10 * 60 * 1000;
export const REGISTRATION_RESEND_COOLDOWN_MS = 60 * 1000;
export const REGISTRATION_MAX_ATTEMPTS = 5;

type VerificationStore = Pick<PrismaClient, 'verification' | '$transaction'>;
type Translate = (text: { en: string; ar: string }) => string;

/** Account details held until the email owner confirms the code. */
export type PendingRegistration = {
  email: string;
  username: string;
  name: string;
  passwordHash: string;
};

type StoredRegistration = PendingRegistration & {
  codeHash: string;
  attempts: number;
};

export type StageResult =
  | { status: 'staged'; code: string; expiresAt: Date }
  | { status: 'cooldown'; retryAfterSeconds: number };

export type ConsumeResult =
  | { status: 'verified'; registration: PendingRegistration }
  | { status: 'invalid'; attemptsLeft: number }
  | { status: 'expired' };

// Pending registrations share Better Auth's `verification` table; the prefix
// keeps them apart from its OAuth state rows.
function identifierFor(email: string): string {
  return `register:${email}`;
}

// Keyed by the server secret so a leaked table does not reveal codes.
function hashCode(email: string, code: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(`${email}:${code}`).digest('hex');
}

function codeMatches(stored: string, email: string, code: string): boolean {
  const expected = Buffer.from(stored, 'hex');
  const actual = Buffer.from(hashCode(email, code), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseStored(value: string): StoredRegistration | null {
  try {
    const data: unknown = JSON.parse(value);
    if (
      typeof data === 'object' &&
      data !== null &&
      'codeHash' in data &&
      typeof data.codeHash === 'string' &&
      'attempts' in data &&
      typeof data.attempts === 'number' &&
      'email' in data &&
      typeof data.email === 'string' &&
      'username' in data &&
      typeof data.username === 'string' &&
      'name' in data &&
      typeof data.name === 'string' &&
      'passwordHash' in data &&
      typeof data.passwordHash === 'string'
    ) {
      return {
        codeHash: data.codeHash,
        attempts: data.attempts,
        email: data.email,
        username: data.username,
        name: data.name,
        passwordHash: data.passwordHash,
      };
    }
  } catch {
    // Treated as missing below.
  }
  return null;
}

/** A uniformly random six-digit code, zero-padded. */
export function generateRegistrationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Replaces any pending registration for the email with a new code, unless one
 * was issued within the resend cooldown.
 */
export async function stageRegistration(
  prisma: VerificationStore,
  registration: PendingRegistration,
  now = new Date(),
): Promise<StageResult> {
  const identifier = identifierFor(registration.email);
  const latest = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: 'desc' },
  });

  if (latest) {
    const waitMs = latest.createdAt.getTime() + REGISTRATION_RESEND_COOLDOWN_MS - now.getTime();
    if (waitMs > 0) {
      return { status: 'cooldown', retryAfterSeconds: Math.ceil(waitMs / 1000) };
    }
  }

  const code = generateRegistrationCode();
  const expiresAt = new Date(now.getTime() + REGISTRATION_CODE_TTL_MS);
  const stored: StoredRegistration = {
    ...registration,
    codeHash: hashCode(registration.email, code),
    attempts: 0,
  };

  await prisma.$transaction([
    prisma.verification.deleteMany({ where: { identifier } }),
    prisma.verification.create({
      data: { identifier, value: JSON.stringify(stored), expiresAt, createdAt: now },
    }),
  ]);

  return { status: 'staged', code, expiresAt };
}

/** Removes the pending registration, e.g. when its email could not be sent. */
export async function discardRegistration(prisma: VerificationStore, email: string): Promise<void> {
  await prisma.verification.deleteMany({ where: { identifier: identifierFor(email) } });
}

/**
 * Checks a code and, when it matches, removes the pending registration so it
 * can be used only once. Wrong codes count toward the attempt limit.
 */
export async function consumeRegistration(
  prisma: VerificationStore,
  email: string,
  code: string,
  now = new Date(),
): Promise<ConsumeResult> {
  const identifier = identifierFor(email);
  const row = await prisma.verification.findFirst({
    where: { identifier },
    orderBy: { createdAt: 'desc' },
  });
  const stored = row ? parseStored(row.value) : null;

  if (!row || !stored || row.expiresAt <= now || stored.attempts >= REGISTRATION_MAX_ATTEMPTS) {
    if (row) await prisma.verification.deleteMany({ where: { id: row.id } });
    return { status: 'expired' };
  }

  if (!codeMatches(stored.codeHash, email, code)) {
    const attempts = stored.attempts + 1;
    // Compare-and-set on the old value so parallel guesses cannot share one
    // attempt; a lost race still counts as a wrong guess.
    await prisma.verification.updateMany({
      where: { id: row.id, value: row.value },
      data: { value: JSON.stringify({ ...stored, attempts }) },
    });
    return { status: 'invalid', attemptsLeft: Math.max(0, REGISTRATION_MAX_ATTEMPTS - attempts) };
  }

  // Only the request that deletes the row may complete the registration.
  const claimed = await prisma.verification.deleteMany({ where: { id: row.id, value: row.value } });
  if (claimed.count === 0) {
    return { status: 'expired' };
  }

  return {
    status: 'verified',
    registration: {
      email: stored.email,
      username: stored.username,
      name: stored.name,
      passwordHash: stored.passwordHash,
    },
  };
}

export function registrationCodeEmail(to: string, code: string, translate: Translate): EmailMessage {
  const minutes = REGISTRATION_CODE_TTL_MS / 60_000;
  const subject = translate({
    en: `${code} is your Story Lens verification code`,
    ar: `${code} هو رمز التحقق الخاص بك في Story Lens`,
  });
  const intro = translate({
    en: 'Enter this code to finish creating your Story Lens account:',
    ar: 'أدخل هذا الرمز لإكمال إنشاء حسابك في Story Lens:',
  });
  const expiry = translate({
    en: `The code expires in ${minutes} minutes.`,
    ar: `تنتهي صلاحية الرمز خلال ${minutes} دقائق.`,
  });
  const ignore = translate({
    en: 'If you did not request this, you can ignore this email.',
    ar: 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة.',
  });
  const dir = translate({ en: 'ltr', ar: 'rtl' });

  return {
    to,
    subject,
    text: `${intro}\n\n${code}\n\n${expiry}\n${ignore}`,
    html: `<div dir="${dir}" style="font-family:Inter,Arial,sans-serif;color:#1f1b2e;line-height:1.5">
  <p>${intro}</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:24px 0" dir="ltr">${code}</p>
  <p>${expiry}</p>
  <p style="color:#6b6680">${ignore}</p>
</div>`,
  };
}
