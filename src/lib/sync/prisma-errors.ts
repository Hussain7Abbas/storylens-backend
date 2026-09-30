import { Prisma } from '@prisma/client';
import { HttpError } from '@/utils/errors';

/**
 * Prisma errors that concurrent sync makes expected: a unique race (`P2002`)
 * answers 409 `UNIQUE_VIOLATION` and a row removed mid-request (`P2025`) answers
 * 404 `NOT_FOUND`, so clients classify them instead of retrying a 500 forever.
 */
export function toPrismaHttpError(error: unknown): HttpError | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code === 'P2002') {
    return new HttpError({ statusCode: 409, code: 'UNIQUE_VIOLATION', message: 'A record with these values already exists' });
  }
  if (error.code === 'P2025') {
    return new HttpError({ statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' });
  }
  return null;
}
