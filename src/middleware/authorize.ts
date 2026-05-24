import { Elysia } from 'elysia';
import { setup } from '@/setup';
import { AuthError } from '@/utils/errors';
import type { Role } from '@prisma/client';

export function requireAuth() {
  return new Elysia({ name: 'middleware/requireAuth' })
    .use(setup)
    .derive({ as: 'scoped' }, ({ currentUser }) => {
      if (!currentUser) {
        throw new AuthError('Authentication required');
      }
      return { authedUser: currentUser };
    });
}

export function requireRole(...roles: Role[]) {
  return new Elysia({ name: `middleware/requireRole:${roles.join(',')}` })
    .use(setup)
    .derive({ as: 'scoped' }, ({ currentUser }) => {
      if (!currentUser) {
        throw new AuthError('Authentication required');
      }

      const userRole = currentUser.role as Role;
      if (!roles.includes(userRole)) {
        throw new AuthError('Insufficient permissions');
      }

      return { authedUser: currentUser };
    });
}
