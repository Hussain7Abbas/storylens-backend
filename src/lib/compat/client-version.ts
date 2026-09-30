/**
 * Installed clients report themselves in this header as `<app>/<version>`
 * (`extension/3.1.1`, `desktop/3.0.0`). Web apps are redeployed with the API
 * and do not send it.
 */
export const CLIENT_VERSION_HEADER = 'x-client-version';
/** Sent with a 426 so the client knows which version it needs. */
export const MIN_CLIENT_VERSION_HEADER = 'x-min-client-version';

export const CLIENT_APPS = ['extension', 'desktop'] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

/**
 * Oldest release of each installed client the API still serves; older ones get
 * 426 Upgrade Required. Raise a floor only in the change that drops support for
 * what those releases call, and only after usage logs show they are gone.
 */
export const MIN_CLIENT_VERSIONS: Record<ClientApp, string> = {
  // The offline-first release changed the synced routes without compatibility
  // (client IDs, `baseUpdatedAt`, alias `nameAr`/`nameEn`): every release up to
  // 3.2.1 is refused, and any version the release bump produces is served.
  extension: '3.2.2',
  desktop: '3.2.2',
};

export type ClientVersion = { app: ClientApp; version: string };

const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

/** Parses `<app>/<version>`; unknown apps and malformed values return null. */
export function parseClientVersion(value: string | null | undefined): ClientVersion | null {
  const [app, version, ...rest] = value?.trim().split('/') ?? [];
  if (rest.length || !app || !version || !VERSION_PATTERN.test(version)) return null;

  const known = CLIENT_APPS.find((name) => name === app.toLowerCase());
  return known ? { app: known, version } : null;
}

/** Numeric comparison of dotted versions; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }

  return 0;
}

/**
 * The minimum version when the header names a client older than its floor,
 * otherwise null. Requests without a recognizable header are served, since
 * releases from before the header existed cannot send one.
 */
export function requiredClientVersion(
  header: string | null | undefined,
  floors: Record<ClientApp, string> = MIN_CLIENT_VERSIONS,
): string | null {
  const client = parseClientVersion(header);
  if (!client) return null;

  const floor = floors[client.app];
  return compareVersions(client.version, floor) < 0 ? floor : null;
}
