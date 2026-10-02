import type { PrismaClient } from '@prisma/client';
import { MAX_PRICE_MICROS, parseUsdToMicros } from './money';

/**
 * Billing and cloud AI settings stored in the `Config` table and edited on the
 * dashboard's Configs page. Values are strings there; this module parses them.
 */
export const BILLING_CONFIG_KEYS = {
  Lens_Price_USD: 'Price of one lens in US dollars, up to 6 decimals (for example 0.01). Missing or invalid: buying lenses is unavailable.',
  Lens_Trial_Gift: 'Lenses given once to each new registered reader. 0 gives nothing and shows no celebration.',
  Lens_Request_Min: 'Smallest lens request (whole lenses).',
  Lens_Request_Max: 'Largest lens request (whole lenses, at most 50000).',
  Lens_Pending_Requests_Max: 'Pending requests one reader may have at a time (1–20).',
  Billing_Notify_Email: 'Email that receives each new lens request with the reader’s contact. Empty: DASHBOARD_ADMIN_EMAIL.',
  AI_Cloud_Enabled: 'true turns Story Lens Cloud AI on; false answers every cloud AI request as unavailable.',
  AI_Text_Model: 'OpenRouter model for every text feature and the image brief (default google/gemini-2.5-flash). Pick it in Settings → AI.',
  AI_Image_Model: 'OpenRouter model that draws character images (default bytedance-seed/seedream-5-0-flash). Pick it in Settings → AI.',
  AI_Daily_Spend_Cap_USD: 'Optional daily OpenRouter spending cap in US dollars (UTC days). Empty: no cap.',
  AI_Reader_Max_Running: 'Cloud AI actions one reader may run at the same time (1–10).',
  AI_Reader_Max_Per_10_Min: 'Cloud AI actions one reader may start in 10 minutes (1–500).',
} as const;

export type BillingConfigKey = keyof typeof BILLING_CONFIG_KEYS;

export const LENS_REQUEST_LIMIT = 50_000;

export const DEFAULT_TEXT_MODEL = 'google/gemini-2.5-flash';
export const DEFAULT_IMAGE_MODEL = 'bytedance-seed/seedream-5-0-flash';
/** An OpenRouter model ID such as `google/gemini-2.5-flash` or `openai/gpt-5-mini:free`. */
export const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9.:_-]*$/i;

export type BillingConfig = {
  /** Null when `Lens_Price_USD` is missing or invalid: buying is unavailable. */
  lensPriceMicros: number | null;
  trialLenses: number;
  requestMin: number;
  requestMax: number;
  pendingMax: number;
  notifyEmail: string | null;
  cloudAiEnabled: boolean;
  textModel: string;
  imageModel: string;
  dailySpendCapMicros: number | null;
  readerMaxRunning: number;
  readerMaxPer10Min: number;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function integer(text: string, min: number, max: number): Parsed<number> {
  if (!/^\d{1,9}$/.test(text.trim())) return { ok: false, message: `a whole number from ${min} to ${max}` };
  const value = Number(text.trim());
  if (value < min || value > max) return { ok: false, message: `a whole number from ${min} to ${max}` };
  return { ok: true, value };
}

function usd(text: string, { positive }: { positive: boolean }): Parsed<number> {
  const micros = parseUsdToMicros(text);
  if (micros === null || micros > MAX_PRICE_MICROS || (positive && micros === 0)) {
    return { ok: false, message: `a dollar amount${positive ? ' above 0' : ''} with up to 6 decimals, such as 0.01` };
  }
  return { ok: true, value: micros };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks one value; `null` means valid. Unknown keys stay free-form. */
export function validateConfigValue(key: string, value: string): string | null {
  const trimmed = value.trim();
  switch (key as BillingConfigKey) {
    case 'Lens_Price_USD': {
      const parsed = usd(trimmed, { positive: true });
      return parsed.ok ? null : `${key} must be ${parsed.message}.`;
    }
    case 'AI_Daily_Spend_Cap_USD': {
      if (trimmed === '') return null;
      const parsed = usd(trimmed, { positive: false });
      return parsed.ok ? null : `${key} must be empty or ${parsed.message}.`;
    }
    case 'Lens_Trial_Gift':
      return check(key, integer(trimmed, 0, 10_000));
    case 'Lens_Request_Min':
      return check(key, integer(trimmed, 1, LENS_REQUEST_LIMIT));
    case 'Lens_Request_Max':
      return check(key, integer(trimmed, 1, LENS_REQUEST_LIMIT));
    case 'Lens_Pending_Requests_Max':
      return check(key, integer(trimmed, 1, 20));
    case 'AI_Reader_Max_Running':
      return check(key, integer(trimmed, 1, 10));
    case 'AI_Reader_Max_Per_10_Min':
      return check(key, integer(trimmed, 1, 500));
    case 'AI_Cloud_Enabled':
      return trimmed === 'true' || trimmed === 'false' ? null : `${key} must be true or false.`;
    case 'AI_Text_Model':
    case 'AI_Image_Model':
      return MODEL_ID.test(trimmed) && trimmed.length <= 120 ? null : `${key} must be an OpenRouter model ID such as provider/model-name.`;
    case 'Billing_Notify_Email':
      return trimmed === '' || EMAIL.test(trimmed) ? null : `${key} must be empty or an email address.`;
    default:
      return null;
  }
}

function model(text: string): Parsed<string> {
  return MODEL_ID.test(text) && text.length <= 120 ? { ok: true, value: text } : { ok: false, message: 'an OpenRouter model ID' };
}

function check(key: string, parsed: Parsed<number>): string | null {
  return parsed.ok ? null : `${key} must be ${parsed.message}.`;
}

const warned = new Map<string, number>();

function warnInvalid(key: string, value: string): void {
  const last = warned.get(key) ?? 0;
  if (Date.now() - last < 60 * 60 * 1000) return;
  warned.set(key, Date.now());
  console.warn(`Invalid config ${key}=${JSON.stringify(value)}; using its fallback`);
}

/** Parses config rows; invalid values fall back (and log) instead of throwing. */
export function parseBillingConfig(rows: Array<{ key: string; value: string }>): BillingConfig {
  const values = new Map(rows.map((row) => [row.key, row.value.trim()]));

  const read = <T>(key: BillingConfigKey, parse: (text: string) => Parsed<T>, fallback: T): T => {
    const text = values.get(key);
    if (text === undefined || text === '') return fallback;
    const parsed = parse(text);
    if (parsed.ok) return parsed.value;
    warnInvalid(key, text);
    return fallback;
  };

  const requestMin = read('Lens_Request_Min', (text) => integer(text, 1, LENS_REQUEST_LIMIT), 100);
  const requestMax = Math.max(
    requestMin,
    read('Lens_Request_Max', (text) => integer(text, 1, LENS_REQUEST_LIMIT), LENS_REQUEST_LIMIT),
  );
  const notify = values.get('Billing_Notify_Email');

  return {
    lensPriceMicros: read<number | null>('Lens_Price_USD', (text) => usd(text, { positive: true }), null),
    trialLenses: read('Lens_Trial_Gift', (text) => integer(text, 0, 10_000), 0),
    requestMin,
    requestMax,
    pendingMax: read('Lens_Pending_Requests_Max', (text) => integer(text, 1, 20), 3),
    notifyEmail: notify && EMAIL.test(notify) ? notify : null,
    cloudAiEnabled: values.get('AI_Cloud_Enabled') === 'true',
    textModel: read('AI_Text_Model', model, DEFAULT_TEXT_MODEL),
    imageModel: read('AI_Image_Model', model, DEFAULT_IMAGE_MODEL),
    dailySpendCapMicros: read<number | null>('AI_Daily_Spend_Cap_USD', (text) => usd(text, { positive: false }), null),
    readerMaxRunning: read('AI_Reader_Max_Running', (text) => integer(text, 1, 10), 3),
    readerMaxPer10Min: read('AI_Reader_Max_Per_10_Min', (text) => integer(text, 1, 500), 30),
  };
}

/** Reads every billing key in one query. Not cached: dashboard edits apply at once. */
export async function getBillingConfig(prisma: Pick<PrismaClient, 'config'>): Promise<BillingConfig> {
  const rows = await prisma.config.findMany({
    where: { key: { in: Object.keys(BILLING_CONFIG_KEYS) } },
    select: { key: true, value: true },
  });
  return parseBillingConfig(rows);
}
