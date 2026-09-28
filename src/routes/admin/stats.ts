import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';

const recentUserSchema = t.Object({
  id: t.String(),
  username: t.String(),
  email: t.String(),
  portal: t.Union([t.Literal('admin'), t.Literal('user')]),
  isGuest: t.Boolean(),
  createdAt: t.Date(),
});

const recentNovelSchema = t.Object({
  id: t.String(),
  name: t.String(),
  createdAt: t.Date(),
});

export const adminStats = new Elysia({ prefix: '/stats', tags: ['Admin: Overview'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/',
    async ({ prisma }) => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [
        readers,
        guests,
        dashboardUsers,
        newUsers,
        novels,
        keywords,
        replacements,
        roles,
        configs,
        recentUsers,
        recentNovels,
      ] = await Promise.all([
        prisma.user.count({ where: { portal: 'user', isGuest: false } }),
        prisma.user.count({ where: { portal: 'user', isGuest: true } }),
        prisma.user.count({ where: { portal: 'admin' } }),
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.novel.count(),
        prisma.keyword.count(),
        prisma.replacement.count(),
        prisma.role.count(),
        prisma.config.count(),
        prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, username: true, email: true, portal: true, isGuest: true, createdAt: true },
        }),
        prisma.novel.findMany({
          orderBy: { createdAt: 'desc' },
          take: 6,
          select: { id: true, name: true, createdAt: true },
        }),
      ]);

      return {
        users: { readers, guests, dashboard: dashboardUsers, newThisWeek: newUsers },
        content: { novels, keywords, replacements },
        roles,
        configs,
        recentUsers,
        recentNovels,
      };
    },
    {
      response: {
        200: t.Object({
          users: t.Object({
            readers: t.Number(),
            guests: t.Number(),
            dashboard: t.Number(),
            newThisWeek: t.Number(),
          }),
          content: t.Object({ novels: t.Number(), keywords: t.Number(), replacements: t.Number() }),
          roles: t.Number(),
          configs: t.Number(),
          recentUsers: t.Array(recentUserSchema),
          recentNovels: t.Array(recentNovelSchema),
        }),
      },
      detail: { summary: 'View dashboard overview' },
    },
  );
