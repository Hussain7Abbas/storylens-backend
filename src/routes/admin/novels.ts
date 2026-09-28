import type { Prisma } from '@prisma/client';
import { Elysia, t } from 'elysia';
import { FilePlain, NovelPlain } from '@/lib/db';
import { authorize } from '@/middleware/authorize';
import { adminListQuery, pageArgs } from '@/schemas/admin';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { sanitize } from '@/utils/sanitize';

const novelInclude = {
  image: true,
  createdBy: { select: { id: true, username: true } },
  _count: { select: { chapters: true, Keywords: true, replacements: true } },
} satisfies Prisma.NovelInclude;

type NovelRow = Prisma.NovelGetPayload<{ include: typeof novelInclude }>;

const adminNovelSchema = t.Composite([
  NovelPlain,
  t.Object({
    image: t.Nullable(FilePlain),
    createdBy: t.Nullable(t.Object({ id: t.String(), username: t.String() })),
    counts: t.Object({ chapters: t.Number(), keywords: t.Number(), replacements: t.Number() }),
  }),
]);

function toNovel({ _count, ...novel }: NovelRow) {
  return {
    ...novel,
    counts: { chapters: _count.chapters, keywords: _count.Keywords, replacements: _count.replacements },
  };
}

const novelBody = {
  name: t.String({ minLength: 1, maxLength: 300 }),
  description: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
  context: t.Optional(t.Nullable(t.String({ maxLength: 20000 }))),
  imageId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
  slugs: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 300 }))),
};

type NovelBody = {
  name?: string;
  description?: string | null;
  context?: string | null;
  imageId?: string | null;
  slugs?: string[];
};

function novelData(body: NovelBody) {
  const optionalText = (value: string | null | undefined) =>
    value === undefined ? undefined : value === null ? null : sanitize(value) || null;

  return {
    name: body.name === undefined ? undefined : sanitize(body.name),
    description: optionalText(body.description),
    context: optionalText(body.context),
    imageId: body.imageId,
    slugs: body.slugs ? [...new Set(body.slugs.map((slug) => sanitize(slug)))] : undefined,
  };
}

function notFound(): never {
  throw new HttpError({ statusCode: 404, message: 'Novel not found' });
}

async function assertNameFree(prisma: Prisma.TransactionClient, name: string, id?: string) {
  const existing = await prisma.novel.findUnique({ where: { name }, select: { id: true } });
  if (existing && existing.id !== id) {
    throw new HttpError({ statusCode: 409, message: 'A novel with this name already exists' });
  }
}

export const adminNovels = new Elysia({ prefix: '/novels', tags: ['Admin: Novels'] })
  .use(setup)
  .use(authorize('admin'))

  .get(
    '/',
    async ({ prisma, query }) => {
      const search = query.search?.trim();
      const where: Prisma.NovelWhereInput = search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { slugs: { has: search } },
            ],
          }
        : {};

      const [rows, total] = await Promise.all([
        prisma.novel.findMany({
          where,
          include: novelInclude,
          orderBy: query.sort === 'name' ? { name: 'asc' } : { createdAt: 'desc' },
          ...pageArgs(query),
        }),
        prisma.novel.count({ where }),
      ]);
      return { data: rows.map(toNovel), total };
    },
    {
      query: t.Object({
        ...adminListQuery,
        sort: t.Optional(t.Union([t.Literal('name'), t.Literal('newest')])),
      }),
      response: { 200: t.Object({ data: t.Array(adminNovelSchema), total: t.Number() }) },
      detail: { summary: 'List novels' },
    },
  )

  .get(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const novel = await prisma.novel.findUnique({ where: { id }, include: novelInclude });
      if (!novel) notFound();
      return toNovel(novel);
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: adminNovelSchema },
      detail: { summary: 'View a novel' },
    },
  )

  .post(
    '/',
    async ({ prisma, authedUser, body }) => {
      const data = novelData(body);
      await assertNameFree(prisma, data.name ?? '');
      const novel = await prisma.novel.create({
        data: { ...data, name: data.name ?? '', slugs: data.slugs ?? [], createdById: authedUser.id },
        include: novelInclude,
      });
      return toNovel(novel);
    },
    {
      body: t.Object(novelBody),
      response: { 200: adminNovelSchema },
      detail: { summary: 'Create a novel' },
    },
  )

  .put(
    '/:id',
    async ({ prisma, params: { id }, body }) => {
      const existing = await prisma.novel.findUnique({ where: { id }, select: { id: true } });
      if (!existing) notFound();

      const data = novelData(body);
      if (data.name) await assertNameFree(prisma, data.name, id);
      const novel = await prisma.novel.update({ where: { id }, data, include: novelInclude });
      return toNovel(novel);
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(t.Object(novelBody)),
      response: { 200: adminNovelSchema },
      detail: { summary: 'Update a novel' },
    },
  )

  .delete(
    '/:id',
    async ({ prisma, params: { id } }) => {
      const novel = await prisma.novel.findUnique({ where: { id }, include: novelInclude });
      if (!novel) notFound();
      // Chapters, keywords, replacements and biases cascade.
      await prisma.novel.delete({ where: { id } });
      return toNovel(novel);
    },
    {
      params: t.Object({ id: t.String() }),
      response: { 200: adminNovelSchema },
      detail: { summary: 'Delete a novel' },
    },
  );
