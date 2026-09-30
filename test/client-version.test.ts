import { describe, expect, it } from 'bun:test';
import {
  compareVersions,
  MIN_CLIENT_VERSIONS,
  parseClientVersion,
  requiredClientVersion,
} from '@/lib/compat/client-version';
import { app } from '@/server';

const floors = { extension: '3.2.0', desktop: '3.0.0' };

describe('client version header', () => {
  it('parses known apps and rejects anything else', () => {
    expect(parseClientVersion('extension/3.1.1')).toEqual({ app: 'extension', version: '3.1.1' });
    expect(parseClientVersion(' Desktop/3.0.0.4 ')).toEqual({ app: 'desktop', version: '3.0.0.4' });
    expect(parseClientVersion('extension/3')).toEqual({ app: 'extension', version: '3' });

    for (const value of [undefined, null, '', 'extension', 'extension/', 'extension/v3.1.1', 'extension/3.1.1-beta', 'extension/3.1.1/x', 'dashboard/3.1.0', '/3.1.1', 'extension/1.2.3.4.5']) {
      expect(parseClientVersion(value)).toBeNull();
    }
  });

  it('compares dotted versions numerically', () => {
    expect(compareVersions('3.10.0', '3.9.9')).toBe(1);
    expect(compareVersions('3.1', '3.1.0')).toBe(0);
    expect(compareVersions('3.1.0.1', '3.1.0')).toBe(1);
    expect(compareVersions('2.99.99', '3.0.0')).toBe(-1);
  });

  it('requires an upgrade only below the app floor', () => {
    expect(requiredClientVersion('extension/3.1.9', floors)).toBe('3.2.0');
    expect(requiredClientVersion('extension/3.2.0', floors)).toBeNull();
    expect(requiredClientVersion('extension/4.0.0', floors)).toBeNull();
    expect(requiredClientVersion('desktop/2.9.9', floors)).toBe('3.0.0');
    // Releases from before the header existed send nothing and stay served.
    expect(requiredClientVersion(undefined, floors)).toBeNull();
    expect(requiredClientVersion('garbage', floors)).toBeNull();
  });

  it('keeps valid floors', () => {
    for (const floor of Object.values(MIN_CLIENT_VERSIONS)) {
      expect(parseClientVersion(`extension/${floor}`)).not.toBeNull();
    }
  });
});

describe('outdated clients', () => {
  const request = (path: string, headers: Record<string, string> = {}) =>
    app.handle(new Request(`http://localhost${path}`, { headers: { origin: 'https://site.test', ...headers } }));

  it('gets 426 on /api with the minimum version, in its language', async () => {
    const response = await request('/api/user/auth/me', {
      'x-client-version': 'extension/0.9.0',
      'accept-language': 'ar',
    });

    expect(response.status).toBe(426);
    expect(response.headers.get('x-min-client-version')).toBe(MIN_CLIENT_VERSIONS.extension);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://site.test');
    expect(response.headers.get('access-control-expose-headers')).toContain('X-Min-Client-Version');
    const body = (await response.json()) as { message: string; minVersion: string };
    expect(body.minVersion).toBe(MIN_CLIENT_VERSIONS.extension);
    expect(body.message).toContain('حدّثه');
  });

  it('passes current clients, unversioned callers and non-API paths through', async () => {
    const current = await request('/api/user/auth/me', { 'x-client-version': `extension/${MIN_CLIENT_VERSIONS.extension}` });
    expect(current.status).toBe(401);

    const unversioned = await request('/api/user/auth/me');
    expect(unversioned.status).toBe(401);

    const health = await request('/health', { 'x-client-version': 'extension/0.9.0' });
    expect(health.status).toBe(200);
  });

  it('refuses unversioned sync writes before body validation', async () => {
    const response = await app.handle(new Request('http://localhost/api/user/keywords', { method: 'POST' }));
    expect(response.status).toBe(426);
    expect(response.headers.get('x-min-client-version')).toBe(MIN_CLIENT_VERSIONS.extension);
  });
});
