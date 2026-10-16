import { Elysia, t } from 'elysia';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

const colorsSchema = t.Object({
  category: t.Record(t.String(), t.String()),
  nature: t.Record(t.String(), t.String()),
});

/** Personal colors never change shared lookup rows. Every query derives its owner from the session. */
export const colorPreferences = new Elysia({ prefix: '/color-preferences', tags: ['ColorPreferences'] })
  .use(setup)
  .use(authorize('user'))
  .get('/', async ({ prisma, authedUser }) => {
    const [categories, natures] = await Promise.all([
      prisma.userCategoryColor.findMany({ where: { userId: authedUser.id } }),
      prisma.userNatureColor.findMany({ where: { userId: authedUser.id } }),
    ]);
    return {
      category: Object.fromEntries(categories.map(row => [row.categoryId, row.color])),
      nature: Object.fromEntries(natures.map(row => [row.natureId, row.color])),
    };
  }, { response: { 200: colorsSchema } })
  .put('/:kind/:id', async ({ prisma, authedUser, params: { kind, id }, body: { color } }) => {
    const userId = authedUser.id;
    // Clearing is idempotent even after a moderator deleted the lookup.
    if (kind === 'category') {
      if (color === null) await prisma.userCategoryColor.deleteMany({ where: { userId, categoryId: id } });
      else {
        if (!await prisma.keywordCategory.findUnique({ where: { id }, select: { id: true } }))
          throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Category not found' });
        await prisma.userCategoryColor.upsert({
          where: { userId_categoryId: { userId, categoryId: id } },
          create: { userId, categoryId: id, color }, update: { color },
        });
      }
    } else {
      if (color === null) await prisma.userNatureColor.deleteMany({ where: { userId, natureId: id } });
      else {
        if (!await prisma.keywordNature.findUnique({ where: { id }, select: { id: true } }))
          throw new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Nature not found' });
        await prisma.userNatureColor.upsert({
          where: { userId_natureId: { userId, natureId: id } },
          create: { userId, natureId: id, color }, update: { color },
        });
      }
    }
    return { color };
  }, {
    params: t.Object({ kind: t.Union([t.Literal('category'), t.Literal('nature')]), id: t.String({ format: 'uuid' }) }),
    body: t.Object({ color: t.Nullable(t.String({ pattern: '^#[0-9A-Fa-f]{6}$' })) }),
    response: { 200: t.Object({ color: t.Nullable(t.String()) }) },
  });
