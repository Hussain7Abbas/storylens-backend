interface PaginationProps {
  page: number;
  pageSize: number;
}
export function parsePaginationProps(p: PaginationProps | undefined) {
  if (!p) {
    return {
      skip: undefined,
      take: undefined,
    };
  }

  return {
    skip: (p.page - 1) * p.pageSize,
    take: p.pageSize,
  };
}

export function getNestedColumnObject(column?: string, defaultValue: unknown = {}) {
  if (!column) {
    return undefined;
  }

  const childrens = column.split('.');
  const lastChild = childrens.pop();

  if (!lastChild) {
    return { [column]: defaultValue };
  }

  return childrens.reduceRight(
    (acc, key) => {
      return { [key]: acc };
    },
    { [lastChild]: defaultValue },
  );
}
