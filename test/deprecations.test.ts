import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { Elysia, t } from 'elysia';
import { deprecate, deprecationHeaders, parseDeprecationDate, shouldLogHourly } from '@/lib/compat/deprecation';
import { deprecationStatus, scanDeprecations, scanSource } from '@/lib/compat/deprecation-scan';
import { deprecation } from '@/plugins/deprecation';

const window = { since: '2026-09-01', removeAfter: '2026-12-31' };

describe('deprecation dates', () => {
  it('accepts real calendar dates only', () => {
    expect(parseDeprecationDate('2028-02-29').toISOString()).toBe('2028-02-29T00:00:00.000Z');
    for (const value of ['2027-02-29', '2026-13-01', '2026-12-32', '2026-1-01', '31-12-2026', '']) {
      expect(() => parseDeprecationDate(value)).toThrow();
    }
  });

  it('expires only after the whole removal day (UTC)', () => {
    expect(deprecationStatus('2026-12-31', new Date('2026-12-31T23:59:59Z'))).toBe('due-soon');
    expect(deprecationStatus('2026-12-31', new Date('2027-01-01T00:00:00Z'))).toBe('expired');
    expect(deprecationStatus('2026-12-31', new Date('2026-12-02T00:00:00Z'))).toBe('due-soon');
    expect(deprecationStatus('2026-12-31', new Date('2026-12-01T23:59:59Z'))).toBe('ok');
  });
});

describe('deprecation headers', () => {
  it('sends Deprecation, Sunset at the end of the removal day, and Link', () => {
    expect(deprecationHeaders({ ...window, link: 'https://example.com/migrate' })).toEqual({
      deprecation: `@${Date.UTC(2026, 8, 1) / 1000}`,
      sunset: 'Fri, 01 Jan 2027 00:00:00 GMT',
      link: '<https://example.com/migrate>; rel="deprecation"',
    });
  });

  it('rejects a removal date that is not after the deprecation date', () => {
    expect(() => deprecationHeaders({ since: '2026-12-31', removeAfter: '2026-12-31' })).toThrow();
  });

  it('marks schema fields deprecated with the removal note', () => {
    const field = deprecate(t.String({ description: 'Old name.' }), { ...window, replacement: 'nameEn' });
    expect(field.deprecated).toBe(true);
    expect(field.description).toBe(
      'Old name. Deprecated since 2026-09-01; removed after 2026-12-31. Use nameEn instead.',
    );
  });
});

describe('deprecated route option', () => {
  const app = new Elysia()
    .use(deprecation)
    .get('/old', () => 'ok', { deprecated: window, detail: { summary: 'Old route' } })
    .get('/failing', () => {
      throw new Error('boom');
    }, { deprecated: window })
    .get('/current', () => 'ok');

  it('adds headers to successful and failing responses only on deprecated routes', async () => {
    const old = await app.handle(new Request('http://localhost/old'));
    expect(old.headers.get('sunset')).toBe('Fri, 01 Jan 2027 00:00:00 GMT');
    expect(old.headers.get('deprecation')).toStartWith('@');

    const failing = await app.handle(new Request('http://localhost/failing'));
    expect(failing.status).toBe(500);
    expect(failing.headers.get('deprecation')).toStartWith('@');

    const current = await app.handle(new Request('http://localhost/current'));
    expect(current.headers.get('deprecation')).toBeNull();
    expect(current.headers.get('sunset')).toBeNull();
  });

  it('marks the route deprecated in OpenAPI and keeps its summary', () => {
    const route = app.routes.find((item) => item.path === '/old');
    expect(route?.hooks.detail).toMatchObject({ deprecated: true, summary: 'Old route' });
  });
});

describe('deprecation scan', () => {
  it('requires a removal date on every marker', () => {
    const source = [
      '/** @deprecated use aliases. remove-after: 2026-12-31 (#12) */',
      '/** @deprecated use aliases */',
      '  /// @deprecated use nameEn. remove-after: 2027-02-29',
      "  .get('/old', handler, { deprecated: { since: '2026-09-01', removeAfter: '2026-12-31' } })",
      "  removeAfter: `2027-03-01`,",
      '  detail: { deprecated: true },',
      '  const removeAfter: string = value;',
      '/** @deprecated tight comment. remove-after: 2026-11-30*/',
    ].join('\n');

    const { markers, issues } = scanSource('src/example.ts', source);
    expect(markers.map((marker) => [marker.line, marker.removeAfter])).toEqual([
      [1, '2026-12-31'],
      [4, '2026-12-31'],
      [5, '2027-03-01'],
      [8, '2026-11-30'],
    ]);
    expect(issues.map((issue) => issue.line)).toEqual([2, 3, 6]);
  });

  it('finds nothing in files without deprecations', () => {
    expect(scanSource('src/plain.ts', 'export const a = 1;\n')).toEqual({ markers: [], issues: [] });
    expect(scanSource('src/empty.ts', '')).toEqual({ markers: [], issues: [] });
  });

  // The enforcement: fails once any deprecation's removal date passes, so it gets removed or deliberately extended.
  it('has no invalid or expired deprecations in this repository', async () => {
    const scan = await scanDeprecations(resolve(import.meta.dir, '..'));
    expect(scan.files).toBeGreaterThan(50);
    expect(scan.issues).toEqual([]);
    expect(scan.markers.filter((marker) => deprecationStatus(marker.removeAfter) === 'expired')).toEqual([]);
  });
});

describe('usage log throttle', () => {
  it('logs a key once per hour', () => {
    const key = `test-${Math.random()}`;
    const start = Date.UTC(2026, 0, 1);
    expect(shouldLogHourly(key, start)).toBe(true);
    expect(shouldLogHourly(key, start + 59 * 60 * 1000)).toBe(false);
    expect(shouldLogHourly(key, start + 60 * 60 * 1000)).toBe(true);
  });
});
