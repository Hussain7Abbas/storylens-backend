import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

const PRIMARY_WEIGHT = 2;
const SECONDARY_WEIGHT = 1;

const SORT_COLUMNS: Record<string, Set<string>> = {
  Keyword: new Set(['name', 'description', 'createdAt', 'updatedAt']),
  Replacement: new Set(['from', 'to', 'createdAt', 'updatedAt']),
};

interface WeightedSearchFilters {
  novelId?: string;
  categoryId?: string;
  natureId?: string;
  keywordId?: string;
}

interface WeightedSearchParams {
  table: 'Keyword' | 'Replacement';
  primaryColumn: string;
  secondaryColumn: string;
  search: string;
  filters: WeightedSearchFilters;
  skip: number;
  take: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

function resolveSortColumn(
  table: 'Keyword' | 'Replacement',
  sortColumn: string | undefined,
  fallback: string,
): string {
  const topLevelColumn = sortColumn?.split('.')[0];
  const allowed = SORT_COLUMNS[table];

  if (topLevelColumn && allowed?.has(topLevelColumn)) {
    return topLevelColumn;
  }

  return fallback;
}

export async function queryWeightedSearchIds(
  prisma: PrismaClient,
  params: WeightedSearchParams,
): Promise<{ ids: string[]; total: number }> {
  const pattern = `%${params.search}%`;
  const sortColumn = resolveSortColumn(
    params.table,
    params.sortColumn,
    params.primaryColumn,
  );
  const sortDir = params.sortDirection === 'desc' ? 'DESC' : 'ASC';
  const filterSql: Prisma.Sql[] = [];

  if (params.filters.novelId) {
    filterSql.push(Prisma.sql`"novelId" = ${params.filters.novelId}`);
  }

  if (params.filters.categoryId) {
    filterSql.push(Prisma.sql`"categoryId" = ${params.filters.categoryId}`);
  }

  if (params.filters.natureId) {
    filterSql.push(Prisma.sql`"natureId" = ${params.filters.natureId}`);
  }

  if (params.filters.keywordId) {
    filterSql.push(Prisma.sql`"keywordId" = ${params.filters.keywordId}`);
  }

  filterSql.push(
    Prisma.sql`(
      ${Prisma.raw(`"${params.primaryColumn}"`)} ILIKE ${pattern}
      OR ${Prisma.raw(`"${params.secondaryColumn}"`)} ILIKE ${pattern}
    )`,
  );

  const whereSql = Prisma.join(filterSql, ' AND ');
  const table = Prisma.raw(`"${params.table}"`);
  const primaryCol = Prisma.raw(`"${params.primaryColumn}"`);
  const secondaryCol = Prisma.raw(`"${params.secondaryColumn}"`);
  const sortCol = Prisma.raw(`"${sortColumn}"`);
  const sortDirRaw = Prisma.raw(sortDir);

  const [idRows, countRows] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM ${table}
      WHERE ${whereSql}
      ORDER BY
        (
          CASE WHEN ${primaryCol} ILIKE ${pattern} THEN ${PRIMARY_WEIGHT} ELSE 0 END +
          CASE WHEN ${secondaryCol} ILIKE ${pattern} THEN ${SECONDARY_WEIGHT} ELSE 0 END
        ) DESC,
        ${sortCol} ${sortDirRaw}
      LIMIT ${params.take} OFFSET ${params.skip}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint as count FROM ${table}
      WHERE ${whereSql}
    `,
  ]);

  return {
    ids: idRows.map((row) => row.id),
    total: Number(countRows[0]?.count ?? 0),
  };
}

export function orderByIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));

  return [...items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
