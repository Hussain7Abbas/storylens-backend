import { Prisma, type File, type FileType, type PrismaClient } from '@prisma/client';
import type { ImageData } from '@/lib/storage/types';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

async function findExistingUploadedFile(
  prisma: PrismaClient,
  uploaded: ImageData,
): Promise<File | null> {
  return prisma.file.findFirst({
    where: {
      OR: [{ url: uploaded.url }, { provider_image_id: uploaded.id }],
    },
  });
}

/**
 * Stores an uploaded file's row. `owner` gives the client's file ID and the
 * uploader (reader uploads); dashboard uploads let the database pick the ID.
 */
export async function saveUploadedFile(
  prisma: PrismaClient,
  uploaded: ImageData,
  type: FileType,
  owner?: { id: string; userId: string },
): Promise<File> {
  const existing = await findExistingUploadedFile(prisma, uploaded);
  if (existing) {
    return existing;
  }

  try {
    return await prisma.file.create({
      data: {
        ...(owner ? { id: owner.id, userId: owner.userId } : {}),
        url: uploaded.url,
        provider_image_id: uploaded.id,
        delete_url: uploaded.delete_url,
        type,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const duplicate = await findExistingUploadedFile(prisma, uploaded);
    if (duplicate) {
      return duplicate;
    }

    throw error;
  }
}
