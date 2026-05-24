import { t } from 'elysia';

export const paginationSchema = t.Object(
  {
    page: t.Number(),
    pageSize: t.Number(),
  },
  {
    default: {
      page: 1,
      pageSize: 10,
    },
  },
);

export const sortingSchema = t.Object(
  {
    column: t.String(),
    direction: t.Optional(t.Union([t.Literal('asc'), t.Literal('desc')])),
  },
  {
    default: {
      column: 'createdAt',
      direction: 'desc',
    },
  },
);

export const errorSchema = t.Object({
  message: t.String(),
});
