// import { verifyJwt } from '@/utils/auth';
import { HttpError } from './errors';

export async function authenticate({
  token,
  errorMessage,
}: {
  token: string;
  errorMessage: string;
}) {
  // if (!token) {
  //   return;
  //   // throw new HttpError({
  //   //   statusCode: 401,
  //   //   message: errorMessage,
  //   // });
  // }
  // try {
  //   return await verifyJwt(token);
  // } catch (_) {
  //   throw new HttpError({
  //     statusCode: 401,
  //     message: errorMessage,
  //   });
  // }
}

export async function authenticateSafe(token: string | undefined) {
  // if (!token) {
  //   return null;
  // }
  // try {
  //   return await verifyJwt(token);
  // } catch (_) {
  //   return null;
  // }
}

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
