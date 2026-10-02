import { Elysia, t } from 'elysia';
import { auth } from '@/lib/auth';
import { mergeGuestInto } from '@/lib/auth/oauth';
import { assertReaderPortal, completeRegistration, verifyLogin } from '@/lib/auth/reader-auth';
import {
  authUserInclude,
  createSessionToken,
  deleteSessionToken,
  getSessionFromBearerToken,
  SESSION_TTL_SECONDS,
  toAuthUser,
} from '@/lib/auth/session';
import {
  appendSetCookie,
  clearWebSessionCookie,
  isWebRequest,
  readWebSessionToken,
  webSessionCookie,
} from '@/lib/auth/web-session';
import { authorize } from '@/middleware/authorize';
import { authUserSchema } from '@/schemas/admin';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

const userResponse = t.Object({ user: authUserSchema });
const giftSchema = t.Nullable(t.Object({ lenses: t.Number() }));

function webOriginRequired(): never {
  throw new HttpError({
    statusCode: 403,
    code: 'WEB_ORIGIN_REQUIRED',
    message: 'Website sessions can only be used from the Story Lens website',
  });
}

/**
 * The website's own session, mounted at `/api/user/auth/web` (decision D13). The
 * website signs in with an HttpOnly cookie, then hands a bearer session to an
 * installed extension (`/extension-session`) or adopts the extension's session
 * (`/adopt`). Every route answers only the website's origin with the CSRF header.
 */
export const webSession = new Elysia({ prefix: '/auth/web', tags: ['Auth'] })
  .use(setup)
  .onBeforeHandle(({ request }) => {
    if (!isWebRequest(request)) webOriginRequired();
  })

  .post(
    '/login',
    async ({ prisma, body, set, t: translate }) => {
      const user = await verifyLogin(prisma, body.email, body.password, translate);
      const token = await createSessionToken(prisma, user.id, 'user', 'web');
      appendSetCookie(set, webSessionCookie(token, SESSION_TTL_SECONDS));
      return { user: toAuthUser(user, 'user') };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 1 }),
      }),
      response: { 200: userResponse },
    },
  )

  // The extension's guest token, when sent as bearer, upgrades that guest in place.
  .post(
    '/register/verify',
    async ({ prisma, body, set, currentUser, t: translate }) => {
      const { user, gift } = await completeRegistration(prisma, {
        email: body.email,
        code: body.code,
        currentUser,
        translate,
      });
      const token = await createSessionToken(prisma, user.id, 'user', 'web');
      appendSetCookie(set, webSessionCookie(token, SESSION_TTL_SECONDS));
      return { user: toAuthUser(user, 'user'), gift };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        code: t.String({ pattern: '^[0-9]{6}$' }),
      }),
      response: { 200: t.Object({ user: authUserSchema, gift: giftSchema }) },
    },
  )

  // Trades the Better Auth cookie left by Google sign-in for a website session.
  .post(
    '/oauth/session',
    async ({ prisma, request, set, t: translate }) => {
      const oauth = await auth.api.getSession({ headers: request.headers });
      if (!oauth) {
        throw new HttpError({
          statusCode: 401,
          message: translate({
            en: 'Sign-in session expired. Please try again.',
            ar: 'انتهت جلسة تسجيل الدخول. يرجى المحاولة مجددًا.',
          }),
        });
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: oauth.user.id }, include: authUserInclude });
      assertReaderPortal(user, translate);

      const token = await createSessionToken(prisma, user.id, 'user', 'web');
      const signOut = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
      for (const cookie of signOut.headers.getSetCookie()) appendSetCookie(set, cookie);
      appendSetCookie(set, webSessionCookie(token, SESSION_TTL_SECONDS));
      return { user: toAuthUser(user, 'user') };
    },
    { response: { 200: userResponse } },
  )

  // Public, so an expired session can still clear its cookie.
  .post('/logout', async ({ prisma, request, set }) => {
    const token = readWebSessionToken(request);
    if (token) await deleteSessionToken(prisma, token);
    appendSetCookie(set, clearWebSessionCookie());
    return { success: true };
  })

  .use(authorize('user'))

  // A bearer session for the extension, from the website's session. A guest
  // the extension holds merges into the account, as with Google sign-in.
  .post(
    '/extension-session',
    async ({ prisma, body, authedUser, sessionKind }) => {
      if (sessionKind !== 'web') webOriginRequired();
      const guest = (await getSessionFromBearerToken(prisma, body.guestToken))?.user;
      if (guest?.isGuest && guest.id !== authedUser.id) {
        await mergeGuestInto(prisma, guest.id, authedUser.id);
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: authedUser.id }, include: authUserInclude });
      const token = await createSessionToken(prisma, user.id, 'user');
      return { user: toAuthUser(user, 'user'), token };
    },
    {
      body: t.Object({ guestToken: t.Optional(t.String({ maxLength: 200 })) }),
      response: { 200: t.Object({ user: authUserSchema, token: t.String() }) },
    },
  )

  // A website session for the account the extension is signed in to.
  .post(
    '/adopt',
    async ({ prisma, set, authedUser, sessionKind }) => {
      if (sessionKind !== 'bearer') webOriginRequired();
      if (authedUser.isGuest) {
        throw new HttpError({
          statusCode: 403,
          code: 'REGISTERED_ACCOUNT_REQUIRED',
          message: 'Guests cannot sign in to the website',
        });
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: authedUser.id }, include: authUserInclude });
      const token = await createSessionToken(prisma, user.id, 'user', 'web');
      appendSetCookie(set, webSessionCookie(token, SESSION_TTL_SECONDS));
      return { user: toAuthUser(user, 'user') };
    },
    { response: { 200: userResponse } },
  );
