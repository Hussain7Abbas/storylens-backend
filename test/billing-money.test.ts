import { describe, expect, it } from 'bun:test';
import { parseBillingConfig, validateConfigValue } from '@/lib/billing/config';
import { formatCents, formatMicros, parseUsdToMicros, priceCents } from '@/lib/billing/money';

// The website (`src/lib/billing/money.ts`) and dashboard (`src/lib/money.ts`) copy
// `priceCents`; keep these vectors identical in all three test suites.
const PRICE_VECTORS: Array<[lenses: number, micros: number, cents: number]> = [
  [1, 10_000, 1],
  [100, 10_000, 100],
  [333, 15_000, 500],
  [1, 4_000, 0],
  [1, 5_000, 1],
  [7, 1_234_567, 864],
  [50_000, 9_999_999_999, 49_999_999_995],
];

describe('money', () => {
  it('rounds lens totals half-up to cents', () => {
    for (const [lenses, micros, cents] of PRICE_VECTORS) expect(priceCents(lenses, micros)).toBe(cents);
  });

  it('parses dollar amounts strictly into micro-dollars', () => {
    expect(parseUsdToMicros('0.01')).toBe(10_000);
    expect(parseUsdToMicros('1')).toBe(1_000_000);
    expect(parseUsdToMicros('0.000001')).toBe(1);
    expect(parseUsdToMicros('9999.999999')).toBe(9_999_999_999);
    for (const bad of ['.5', '1e-2', '-1', 'abc', '10000', '0.0000001', '', '1,5', ' 0.01x']) {
      expect(parseUsdToMicros(bad)).toBeNull();
    }
  });

  it('formats micro-dollars and cents', () => {
    expect(formatMicros(10_000)).toBe('0.010000');
    expect(formatMicros(1_234_567)).toBe('1.234567');
    expect(formatCents(500)).toBe('5.00');
    expect(formatCents(7)).toBe('0.07');
  });
});

describe('billing config', () => {
  it('reads valid values', () => {
    const config = parseBillingConfig([
      { key: 'Lens_Price_USD', value: '0.01' },
      { key: 'Lens_Trial_Gift', value: '10' },
      { key: 'Lens_Request_Min', value: '100' },
      { key: 'AI_Cloud_Enabled', value: 'true' },
      { key: 'AI_Daily_Spend_Cap_USD', value: '5' },
    ]);
    expect(config).toMatchObject({
      lensPriceMicros: 10_000,
      trialLenses: 10,
      requestMin: 100,
      requestMax: 50_000,
      pendingMax: 3,
      cloudAiEnabled: true,
      dailySpendCapMicros: 5_000_000,
      readerMaxRunning: 3,
      readerMaxPer10Min: 30,
    });
  });

  it('falls back on missing or invalid values', () => {
    const config = parseBillingConfig([
      { key: 'Lens_Price_USD', value: '0' },
      { key: 'Lens_Trial_Gift', value: '-1' },
      { key: 'AI_Cloud_Enabled', value: 'yes' },
    ]);
    expect(config.lensPriceMicros).toBeNull();
    expect(config.trialLenses).toBe(0);
    expect(config.cloudAiEnabled).toBe(false);
    expect(config.dailySpendCapMicros).toBeNull();
    expect(parseBillingConfig([]).lensPriceMicros).toBeNull();
  });

  it('never lets the request maximum fall below the minimum', () => {
    const config = parseBillingConfig([
      { key: 'Lens_Request_Min', value: '500' },
      { key: 'Lens_Request_Max', value: '100' },
    ]);
    expect(config.requestMax).toBe(500);
  });

  it('validates known keys on save and leaves others free-form', () => {
    expect(validateConfigValue('Lens_Price_USD', '0.01')).toBeNull();
    expect(validateConfigValue('Lens_Price_USD', 'abc')).toContain('Lens_Price_USD');
    expect(validateConfigValue('Lens_Price_USD', '0')).not.toBeNull();
    expect(validateConfigValue('Lens_Trial_Gift', '-1')).not.toBeNull();
    expect(validateConfigValue('Lens_Trial_Gift', '0')).toBeNull();
    expect(validateConfigValue('AI_Cloud_Enabled', 'yes')).not.toBeNull();
    expect(validateConfigValue('AI_Daily_Spend_Cap_USD', '')).toBeNull();
    expect(validateConfigValue('Billing_Notify_Email', 'owner@example.com')).toBeNull();
    expect(validateConfigValue('Billing_Notify_Email', 'nope')).not.toBeNull();
    expect(validateConfigValue('Review_Version', 'anything')).toBeNull();
  });
});

describe('lens balance writes', () => {
  it('happen only in the ledger', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? files(path) : /\.ts$/.test(entry) ? [path] : [];
      });
    const WRITE = /"lensBalance"\s*=|lensBalance\s*:\s*\{\s*(increment|decrement|set)\b|data:\s*\{[^}]*\blensBalance\s*:/;
    const hits = files(join(import.meta.dir, '../src'))
      .filter((file) => !file.endsWith('lib/billing/ledger.ts'))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, index) => (WRITE.test(line) ? [`${file}:${index + 1}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
