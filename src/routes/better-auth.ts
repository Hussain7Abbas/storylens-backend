import { Elysia } from 'elysia';
import { auth } from '@/lib/auth';

// Better Auth (OAuth sign-in, callbacks, cookie sessions) stays at `/auth/*`
// because Google's authorized redirect URI is `{BETTER_AUTH_URL}/auth/callback/google`.
// Unguarded because OAuth starts signed out.
export const betterAuthRoutes = new Elysia({ prefix: '/auth', tags: ['Auth'] }).all(
  '/*',
  async ({ request }) => auth.handler(request),
  {
    detail: {
      hide: true,
    },
  },
);
