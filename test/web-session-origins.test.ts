import { describe, expect, it } from 'bun:test';
import { isWebRequest, webOrigins } from '@/lib/auth/web-session';

const website = 'https://storylens.iscoded.com';

describe('website session origins', () => {
  for (const mode of ['development', 'test'] as const) {
    it(`allows the default localhost website in ${mode}`, () => {
      const origins = webOrigins({ WEBSITE_URL: website, NODE_ENV: mode, WEBSITE_DEV_ORIGINS: undefined });
      expect(origins).toContain(website);
      expect(origins).toContain('http://localhost:3000');
      expect(origins).toContain('http://127.0.0.1:3000');
      for (const origin of ['http://localhost:3040', 'http://localhost:3050', 'http://localhost.evil.example:3000', 'https://evil.example', 'null']) {
        expect(origins).not.toContain(origin);
      }
    });
  }

  it('allows custom development origins and deduplicates the configured website', () => {
    expect(webOrigins({
      WEBSITE_URL: 'http://localhost:3000/en/', NODE_ENV: 'development',
      WEBSITE_DEV_ORIGINS: ' http://localhost:3010 , http://localhost:3000, ',
    })).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3010']);
  });

  it('allows only the configured website in production', () => {
    expect(webOrigins({
      WEBSITE_URL: website, NODE_ENV: 'production',
      WEBSITE_DEV_ORIGINS: 'http://localhost:3000,https://evil.example',
    })).toEqual([website]);
  });

  it('still requires the CSRF header on local writes', () => {
    const request = (method: string, csrf = false, origin = 'http://localhost:3000') =>
      new Request('http://localhost:3030/api/user/auth/web/login', {
        method, headers: { Origin: origin, ...(csrf ? { 'X-Storylens-Web': '1' } : {}) },
      });
    expect(isWebRequest(request('GET'))).toBe(true);
    expect(isWebRequest(request('POST'))).toBe(false);
    expect(isWebRequest(request('POST', true))).toBe(true);
    expect(isWebRequest(request('POST', true, 'http://localhost:3040'))).toBe(false);
  });

  it('uses an HTTP-compatible cookie only when explicitly enabled outside production', () => {
    const code = `
      import { webSessionCookie, isWebOrigin } from './src/lib/auth/web-session';
      console.log(JSON.stringify({ cookie: webSessionCookie('fixture-token', 60), local: isWebOrigin('http://localhost:3000') }));
    `;
    function run(mode: string, insecure: string) {
      return Bun.spawnSync(['bun', '-e', code], {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, NODE_ENV: mode, WEB_SESSION_INSECURE_COOKIE: insecure, WEBSITE_URL: website, WEBSITE_DEV_ORIGINS: '' },
        stdout: 'pipe', stderr: 'pipe',
      });
    }
    const local = run('development', 'true');
    expect(local.exitCode, local.stderr.toString()).toBe(0);
    expect(JSON.parse(local.stdout.toString())).toEqual({
      cookie: 'sl_web=fixture-token; Path=/; HttpOnly; SameSite=Strict; Max-Age=60', local: true,
    });
    const production = run('production', 'false');
    expect(production.exitCode, production.stderr.toString()).toBe(0);
    expect(JSON.parse(production.stdout.toString())).toEqual({
      cookie: '__Host-sl_web=fixture-token; Path=/; HttpOnly; SameSite=Strict; Max-Age=60; Secure', local: false,
    });
    const refused = run('production', 'true');
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr.toString()).toContain('WEB_SESSION_INSECURE_COOKIE is only for local development');
  });
});
