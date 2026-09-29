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
  nameAr: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  nameEn: t.Optional(t.Nullable(t.String({ maxLength: 300 }))),
  descriptionAr: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
  descriptionEn: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
  context: t.Optional(t.Nullable(t.String({ maxLength: 20000 }))),
  imageId: t.Optional(t.Nullable(t.String({ format: 'uuid' }))),
  slugs: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 300 }))),
};

type NovelBody = {
  nameAr?: string | null;
  nameEn?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  context?: string | null;
  imageId?: string | null;
  slugs?: string[];
};

function novelData(body: NovelBody) {
  const optionalText = (value: string | null | undefined) =>
    value === undefined ? undefined : value === null ? null : sanitize(value) || null;

  return {
    nameAr: optionalText(body.nameAr),
    nameEn: optionalText(body.nameEn),
    descriptionAr: optionalText(body.descriptionAr),
    descriptionEn: optionalText(body.descriptionEn),
    context: optionalText(body.context),
    imageId: body.imageId,
    slugs: body.slugs ? [...new Set(body.slugs.map((slug) => sanitize(slug)))] : undefined,
  };
}

function notFound(): never {
  throw new HttpError({ statusCode: 404, message: 'Novel not found' });
}

async function assertNamesFree(
  prisma: Prisma.TransactionClient,
  names: { nameAr?: string | null; nameEn?: string | null },
  id?: string,
) {
  for (const [field, name] of [
    ['nameAr', names.nameAr],
    ['nameEn', names.nameEn],
  ] as const) {
    if (!name) continue;
    const existing = await prisma.novel.findFirst({ where: { [field]: name }, select: { id: true } });
    if (existing && existing.id !== id) {
      throw new HttpError({ statusCode: 409, message: 'A novel with this name already exists' });
    }
  }
}

function assertHasName(names: { nameAr?: string | null; nameEn?: string | null }) {
  if (!names.nameAr && !names.nameEn) {
    throw new HttpError({ statusCode: 422, message: 'An Arabic or English name is required' });
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
              { nameAr: { contains: search, mode: 'insensitive' } },
              { nameEn: { contains: search, mode: 'insensitive' } },
              { descriptionAr: { contains: search, mode: 'insensitive' } },
              { descriptionEn: { contains: search, mode: 'insensitive' } },
              { slugs: { has: search } },
            ],
          }
        : {};

      const [rows, total] = await Promise.all([
        prisma.novel.findMany({
          where,
          include: novelInclude,
          orderBy: query.sort === 'name' ? [{ nameAr: 'asc' }, { nameEn: 'asc' }] : { createdAt: 'desc' },
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
      assertHasName(data);
      await assertNamesFree(prisma, data);
      const novel = await prisma.novel.create({
        data: { ...data, slugs: data.slugs ?? [], createdById: authedUser.id },
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
      const existing = await prisma.novel.findUnique({
        where: { id },
        select: { id: true, nameAr: true, nameEn: true },
      });
      if (!existing) notFound();

      const data = novelData(body);
      assertHasName({
        nameAr: data.nameAr === undefined ? existing.nameAr : data.nameAr,
        nameEn: data.nameEn === undefined ? existing.nameEn : data.nameEn,
      });
      await assertNamesFree(prisma, data, id);
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
