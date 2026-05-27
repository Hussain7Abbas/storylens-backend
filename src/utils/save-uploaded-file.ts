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

export async function saveUploadedFile(
  prisma: PrismaClient,
  uploaded: ImageData,
  type: FileType,
): Promise<File> {
  const existing = await findExistingUploadedFile(prisma, uploaded);
  if (existing) {
    return existing;
  }

  try {
    return await prisma.file.create({
      data: {
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
