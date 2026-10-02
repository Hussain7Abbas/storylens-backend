import { bearer } from '@elysiajs/bearer';
import { prisma } from '@/lib/db';
import { getSessionFromBearerToken, getSessionFromWebToken, toAuthUser } from '@/lib/auth/session';
import { isWebRequest, readWebSessionToken } from '@/lib/auth/web-session';
import { Elysia } from 'elysia';
import { deprecation } from '@/plugins/deprecation';
import { toLanguage } from '@/utils/translation';

export const setup = new Elysia({ name: 'setup' })

  // Decoraters
  .decorate('prisma', prisma)

  // Plugins
  .use(bearer())
  // Adds the `deprecated` route option
  .use(deprecation)

  // Translation
  .derive({ as: 'scoped' }, ({ headers }) => {
    const lang = toLanguage(headers['accept-language']);

    return {
      // Readers see novel and keyword fields in this language only.
      lang,
      t: ({ en, ar }: { en: string; ar: string }) => {
        return lang === 'ar' ? ar : en;
      },
    };
  })

  // Auth: resolve the current user, as seen by the session's portal, from the
  // bearer token, or else from the website's session cookie (only from the
  // website's origin, with the CSRF header on writes).
  .derive({ as: 'scoped' }, async ({ bearer, request }) => {
    if (bearer) {
      const session = await getSessionFromBearerToken(prisma, bearer);
      return {
        currentUser: session ? toAuthUser(session.user, session.portal) : null,
        sessionKind: session ? ('bearer' as const) : null,
      };
    }

    if (isWebRequest(request)) {
      const session = await getSessionFromWebToken(prisma, readWebSessionToken(request));
      if (session) return { currentUser: toAuthUser(session.user, session.portal), sessionKind: 'web' as const };
    }

    return { currentUser: null, sessionKind: null };
  });
