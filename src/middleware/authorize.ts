import type { AuthUserPayload } from '@/lib/auth/session';
import { Elysia } from 'elysia';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

export type AuthedUser = AuthUserPayload;

function unauthorized(message = 'Authentication required'): never {
  throw new HttpError({ statusCode: 401, message });
}

function forbidden(message = 'Insufficient permissions'): never {
  throw new HttpError({ statusCode: 403, message });
}

/** Any authenticated role: guest, user, or admin (read access). */
export function shouldBeGuest() {
  return new Elysia({ name: 'middleware/shouldBeGuest' })
    .use(setup)
    .derive({ as: 'scoped' }, ({ currentUser }) => {
      if (!currentUser) {
        unauthorized();
      }

      return { authedUser: currentUser as AuthedUser };
    });
}

/** User or admin (mutations available to registered users). */
export function shouldBeUser() {
  return new Elysia({ name: 'middleware/shouldBeUser' })
    .use(setup)
    .derive({ as: 'scoped' }, ({ currentUser }) => {
      if (!currentUser) {
        unauthorized();
      }

      if (currentUser.role === 'guest') {
        forbidden('User role required');
      }

      return { authedUser: currentUser as AuthedUser };
    });
}

/** Admin only (full access). */
export function shouldBeAdmin() {
  return new Elysia({ name: 'middleware/shouldBeAdmin' })
    .use(setup)
    .derive({ as: 'scoped' }, ({ currentUser }) => {
      if (!currentUser) {
        unauthorized();
      }

      if (currentUser.role !== 'admin') {
        forbidden('Admin role required');
      }

      return { authedUser: currentUser as AuthedUser };
    });
}

/** User may only mutate their own resource; admin may mutate any. */
export function assertOwnsResource(
  createdById: string | null | undefined,
  authedUser: AuthedUser,
): void {
  if (authedUser.role === 'admin') {
    return;
  }

  if (authedUser.role === 'user' && createdById === authedUser.id) {
    return;
  }

  forbidden('You can only modify resources you created');
}

export function isAdmin(authedUser: AuthedUser): boolean {
  return authedUser.role === 'admin';
}

/** @deprecated Use shouldBeUser() or shouldBeAdmin() instead. */
export function requireAuth() {
  return shouldBeGuest();
}

/** @deprecated Use shouldBeAdmin() or shouldBeUser() instead. */
export function requireRole(...roles: Array<'guest' | 'user' | 'admin'>) {
  return new Elysia({ name: `middleware/requireRole:${roles.join(',')}` })
    .use(setup)
    .derive({ as: 'scoped' }, ({ currentUser }) => {
      if (!currentUser) {
        unauthorized();
      }

      if (!roles.includes(currentUser.role)) {
        forbidden();
      }

      return { authedUser: currentUser as AuthedUser };
    });
}
