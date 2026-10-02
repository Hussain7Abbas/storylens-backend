import { Prisma } from '@prisma/client';

/**
 * Money is integer micro-dollars (1 USD = 1,000,000) and cents; prices are never
 * parsed with `parseFloat`. The website and dashboard keep copies of
 * `priceCents` with the same test vectors (`test/billing-money.test.ts`).
 */

export const MICROS_PER_USD = 1_000_000;
/** Largest lens price the config accepts: 9999.999999 USD. */
export const MAX_PRICE_MICROS = 9_999_999_999;

const USD_PATTERN = /^(\d{1,4})(?:\.(\d{1,6}))?$/;

/** Parses a USD amount such as `0.01` into micro-dollars; null when malformed. */
export function parseUsdToMicros(text: string): number | null {
  const match = USD_PATTERN.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(6, '0'));
  return whole * MICROS_PER_USD + fraction;
}

/** `lenses × price`, rounded half-up to cents. */
export function priceCents(lenses: number, priceMicros: number): number {
  return Math.floor((lenses * priceMicros + 5_000) / 10_000);
}

/** `10000` → `"0.010000"`. */
export function formatMicros(micros: number): string {
  const whole = Math.floor(micros / MICROS_PER_USD);
  const fraction = String(micros % MICROS_PER_USD).padStart(6, '0');
  return `${whole}.${fraction}`;
}

/** `500` → `"5.00"`. */
export function formatCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

export function microsToDecimal(micros: number): Prisma.Decimal {
  return new Prisma.Decimal(formatMicros(micros));
}

export function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(formatCents(cents));
}

/** A stored `Decimal(12, 6)` price back to micro-dollars. */
export function decimalToMicros(value: Prisma.Decimal): number {
  return value.mul(MICROS_PER_USD).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

/** A USD cost such as OpenRouter's `usage.cost` (a float) to a stored decimal. */
export function usdToDecimal(cost: number): Prisma.Decimal {
  return new Prisma.Decimal(cost).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
}
