import type { Prisma } from '@prisma/client';
import { HttpError } from '@/utils/errors';

type VersionRange = {
  id: string;
  startingChapter: number;
  endingChapter: number | null;
};

/** Serialize changes to one keyword's ranges, including concurrent creates. */
export async function lockKeywordVersions(tx: Prisma.TransactionClient, keywordId: string) {
  await tx.$queryRaw`SELECT id FROM "Keyword" WHERE id = ${keywordId} FOR UPDATE`;
}

/** Neighboring ranges for an edit; moving a start also moves the preceding end. */
export function versionEditNeighbors(
  versions: VersionRange[],
  id: string,
  startingChapter: number,
  endingChapter: number | null,
) {
  const index = versions.findIndex((version) => version.id === id);
  if (index < 0) throw new HttpError({ statusCode: 404, message: 'Version not found' });
  const previous = versions[index - 1];
  const next = versions[index + 1];
  if (!previous && startingChapter !== 0) {
    throw new HttpError({ statusCode: 409, message: 'The base version must start at chapter 0' });
  }
  if (previous && startingChapter <= previous.startingChapter) {
    throw new HttpError({ statusCode: 409, message: 'A version must start after the preceding version' });
  }
  if (next && startingChapter >= next.startingChapter) {
    throw new HttpError({ statusCode: 409, message: 'A version must start before the following version' });
  }
  // A nonlatest version cannot remain open. Close legacy open ranges at the
  // next start, including when an admin edits only their style.
  const boundedEnd = next && endingChapter === null ? next.startingChapter - 1 : endingChapter;
  if (boundedEnd !== null && boundedEnd < startingChapter) {
    throw new HttpError({ statusCode: 422, message: 'The ending chapter must not be before the starting chapter' });
  }
  if (next && boundedEnd !== null && boundedEnd >= next.startingChapter) {
    throw new HttpError({ statusCode: 409, message: 'A version must end before the following version starts' });
  }
  return { previous, next, endingChapter: boundedEnd };
}
