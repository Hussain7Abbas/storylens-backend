import { bearer } from '@elysiajs/bearer';
import { prisma } from '@/lib/db';
import { getUserFromBearerToken, toAuthUser } from '@/lib/auth/session';
import { Elysia } from 'elysia';

export const setup = new Elysia({ name: 'setup' })

  // Decoraters
  .decorate('prisma', prisma)

  // Plugins
  .use(bearer())

  // Translation
  .derive({ as: 'scoped' }, ({ headers }) => {
    const lang = headers['accept-language']?.split(',')[0] || 'en';

    return {
      t: ({ en, ar }: { en: string; ar: string }) => {
        return lang === 'ar' ? ar : en;
      },
    };
  })

  // Auth: resolve current user from bearer session token
  .derive({ as: 'scoped' }, async ({ bearer }) => {
    const user = await getUserFromBearerToken(prisma, bearer);

    return {
      currentUser: user ? toAuthUser(user) : null,
    };
  });
