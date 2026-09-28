import type { Portal } from '@prisma/client';
import { Elysia } from 'elysia';
import type { AuthUserPayload } from '@/lib/auth/session';
import { CAPABILITIES, permissionKey } from '@/lib/permissions';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

export type AuthedUser = AuthUserPayload;

function unauthorized(message = 'Authentication required'): never {
  throw new HttpError({ statusCode: 401, message });
}

function forbidden(message = 'Insufficient permissions'): never {
  throw new HttpError({ statusCode: 403, message });
}

const PORTAL_MISMATCH: Record<Portal, string> = {
  admin: 'A dashboard account is required',
  user: 'A reader account is required',
};

/**
 * Signs the caller in to one portal and checks that their role holds the
 * permission of the matched route (`METHOD /api/{portal}/...`). Use it once per
 * route module, after `.use(setup)` and that module's public routes. It
 * derives (rather than resolves) so signed-out callers get 401 before input
 * validation runs.
 */
export function authorize(portal: Portal) {
  return new Elysia({ name: `middleware/authorize:${portal}` })
    .use(setup)
    .derive({ as: 'scoped' }, ({ currentUser, request, route }) => {
      if (!currentUser) {
        unauthorized();
      }

      if (currentUser.portal !== portal) {
        forbidden(PORTAL_MISMATCH[portal]);
      }

      const key = permissionKey(request.method, route);
      if (!currentUser.permissions.includes(key)) {
        forbidden(`Missing permission: ${key}`);
      }

      return { authedUser: currentUser as AuthedUser };
    });
}

export function hasPermission(authedUser: AuthedUser, key: string): boolean {
  return authedUser.permissions.includes(key);
}

/** Moderators may change shared data and other readers' content. */
export function canModerate(authedUser: AuthedUser): boolean {
  return hasPermission(authedUser, CAPABILITIES.moderate);
}

/** Readers may only mutate what they created; moderators may mutate anything. */
export function assertOwnsResource(
  createdById: string | null | undefined,
  authedUser: AuthedUser,
): void {
  if (canModerate(authedUser)) {
    return;
  }

  if (createdById && createdById === authedUser.id) {
    return;
  }

  forbidden('You can only modify resources you created');
}
