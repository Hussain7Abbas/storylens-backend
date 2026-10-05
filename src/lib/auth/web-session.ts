import { env } from '@/env';

/**
 * The website's own session (decision D13): an HttpOnly cookie on the API host
 * that page JavaScript never reads. The website (`storylens.iscoded.com`) and the
 * API (`storylens-api.iscoded.com`) are the same site, so `SameSite=Strict`
 * cookies reach the API from the website's `fetch(…, { credentials: "include" })`.
 *
 * The cookie is honored only from the website's origin, and writes also need
 * the `X-Storylens-Web: 1` header (CSRF defense): requests from other origins
 * that carry it are treated as signed out.
 */

export const WEB_SESSION_HEADER = 'x-storylens-web';
export const WEB_SESSION_COOKIE = env.WEB_SESSION_INSECURE_COOKIE ? 'sl_web' : '__Host-sl_web';

type WebsiteOriginConfig = Pick<typeof env, 'WEBSITE_URL' | 'NODE_ENV' | 'WEBSITE_DEV_ORIGINS'>;

export function webOrigins(config: WebsiteOriginConfig = env): string[] {
  const origins = [new URL(config.WEBSITE_URL).origin];
  if (config.NODE_ENV !== 'production') {
    // The website's default dev port; trust exact origins, never every localhost port.
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
    for (const origin of (config.WEBSITE_DEV_ORIGINS ?? '').split(',')) {
      const trimmed = origin.trim();
      if (trimmed) origins.push(new URL(trimmed).origin);
    }
  }
  return [...new Set(origins)];
}

export function isWebOrigin(origin: string | null): boolean {
  return origin !== null && webOrigins().includes(origin);
}

/** A request the website made: its origin, and the CSRF header on writes. */
export function isWebRequest(request: Request): boolean {
  if (!isWebOrigin(request.headers.get('origin'))) return false;
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  return request.headers.get(WEB_SESSION_HEADER) === '1';
}

export function readWebSessionToken(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === WEB_SESSION_COOKIE) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function cookie(value: string, maxAge: number): string {
  const secure = env.WEB_SESSION_INSECURE_COOKIE ? '' : '; Secure';
  return `${WEB_SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function webSessionCookie(token: string, maxAgeSeconds: number): string {
  return cookie(encodeURIComponent(token), maxAgeSeconds);
}

export function clearWebSessionCookie(): string {
  return cookie('', 0);
}

type HeaderSet = { headers: Record<string, unknown> };

/** Adds a `Set-Cookie` header without dropping ones already set on the response. */
export function appendSetCookie(set: HeaderSet, value: string): void {
  const current = set.headers['set-cookie'];
  const list = Array.isArray(current) ? current : typeof current === 'string' ? [current] : [];
  set.headers['set-cookie'] = [...list, value];
}
