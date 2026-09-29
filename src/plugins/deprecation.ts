import chalk from 'chalk';
import { Elysia } from 'elysia';
import { CLIENT_VERSION_HEADER } from '@/lib/compat/client-version';
import {
  type Deprecation,
  deprecationHeaders,
  describeDeprecation,
  shouldLogHourly,
} from '@/lib/compat/deprecation';

/**
 * `deprecated: { since, removeAfter, replacement?, link? }` route option: marks
 * the route deprecated in OpenAPI (its description becomes the deprecation note),
 * sends `Deprecation`/`Sunset`/`Link` headers, and logs which clients still call
 * it (hourly per client).
 */
export const deprecation = new Elysia({ name: 'deprecation' }).macro({
  deprecated: (options: Deprecation) => {
    const headers = deprecationHeaders(options);
    const note = describeDeprecation(options);

    return {
      detail: { deprecated: true, description: note },
      // `transform` runs before validation, so handler and validation errors
      // carry the headers; rejections from an earlier derive (`authorize`) do not.
      transform({ request, route, set }) {
        Object.assign(set.headers, headers);

        const client = request.headers.get(CLIENT_VERSION_HEADER) ?? 'unknown';
        const key = `${request.method} ${route} ${client}`;
        if (shouldLogHourly(key)) {
          console.warn(chalk.yellow(`DEPRECATED ${key} (${note})`));
        }
      },
    };
  },
});
