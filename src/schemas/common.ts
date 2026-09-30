import { t, type TSchema } from 'elysia';

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
  /** Machine-readable reason (`src/lib/sync/error-codes.ts`). */
  code: t.Optional(t.String()),
});

/** 409 `STALE_WRITE`: the row changed since `baseUpdatedAt`; `current` is it in the route's 200 shape. */
export function staleWriteSchema<T extends TSchema>(current: T) {
  return t.Object({
    message: t.String(),
    code: t.Literal('STALE_WRITE'),
    current,
  });
}
