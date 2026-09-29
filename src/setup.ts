import { bearer } from '@elysiajs/bearer';
import { prisma } from '@/lib/db';
import { getSessionFromBearerToken, toAuthUser } from '@/lib/auth/session';
import { Elysia } from 'elysia';
import { toLanguage } from '@/utils/translation';

export const setup = new Elysia({ name: 'setup' })

  // Decoraters
  .decorate('prisma', prisma)

  // Plugins
  .use(bearer())

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

  // Auth: resolve current user, as seen by the session's portal, from the bearer token
  .derive({ as: 'scoped' }, async ({ bearer }) => {
    const session = await getSessionFromBearerToken(prisma, bearer);

    return {
      currentUser: session ? toAuthUser(session.user, session.portal) : null,
    };
  });
