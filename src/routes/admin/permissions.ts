import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { permissionSchema, portalSchema } from '@/schemas/admin';
import { setup } from '@/setup';

// Rows are synced from the API routes on startup; the dashboard only reads
// them and assigns them to roles.
export const adminPermissions = new Elysia({ prefix: '/permissions', tags: ['Admin: Roles'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/',
    async ({ prisma, query }) => {
      const data = await prisma.permission.findMany({
        where: { portal: query.portal },
        select: {
          id: true,
          key: true,
          portal: true,
          group: true,
          method: true,
          path: true,
          description: true,
        },
        orderBy: [{ portal: 'asc' }, { group: 'asc' }, { path: 'asc' }, { method: 'asc' }],
      });
      return { data };
    },
    {
      query: t.Object({ portal: t.Optional(portalSchema) }),
      response: { 200: t.Object({ data: t.Array(permissionSchema) }) },
      detail: { summary: 'List permissions' },
    },
  );
