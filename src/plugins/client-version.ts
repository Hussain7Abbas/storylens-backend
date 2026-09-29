import chalk from 'chalk';
import { Elysia, status } from 'elysia';
import {
  CLIENT_VERSION_HEADER,
  MIN_CLIENT_VERSION_HEADER,
  requiredClientVersion,
} from '@/lib/compat/client-version';
import { shouldLogHourly } from '@/lib/compat/deprecation';
import { toLanguage } from '@/utils/translation';

/**
 * Refuses `/api/*` requests from installed clients older than their floor with
 * 426 Upgrade Required. Runs before routing, so an outdated client never reaches
 * body validation or a changed handler.
 */
export const clientVersion = new Elysia({ name: 'client-version' }).onRequest(
  ({ request, set }) => {
    if (!new URL(request.url).pathname.startsWith('/api/')) return;

    const client = request.headers.get(CLIENT_VERSION_HEADER);
    const minVersion = requiredClientVersion(client);
    if (!minVersion) return;

    // Refused before routing, so the request logger never sees it.
    if (shouldLogHourly(`outdated ${client}`)) {
      console.warn(chalk.yellow(`OUTDATED ${client} refused with 426 (minimum ${minVersion})`));
    }

    set.headers[MIN_CLIENT_VERSION_HEADER] = minVersion;
    const message =
      toLanguage(request.headers.get('accept-language') ?? undefined) === 'ar'
        ? `هذا الإصدار من Story Lens قديم. حدّثه إلى ${minVersion} أو أحدث.`
        : `This version of Story Lens is outdated. Update to ${minVersion} or newer.`;

    return status(426, { message, minVersion });
  },
);
