import { FileType } from '@prisma/client';
import { FilePlain } from '@/lib/db';
import { uploadImage, uploadVideo } from '@/lib/storage';
import { Elysia, t } from 'elysia';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';

export const files = new Elysia({ prefix: '/files', tags: ['Files'] })
  .use(setup)

  .post(
    '/upload',
    async ({ body, prisma, t }) => {
      if (body.type === 'Image') {
        const uploadedImage = await uploadImage({
          file: body.file,
        });

        return prisma.file.create({
          data: {
            url: uploadedImage.url,
            provider_image_id: uploadedImage.id,
            delete_url: uploadedImage.delete_url,
            // userId: user?.id,
            type: body.type,
          },
        });
      }

      if (body.type === 'Video') {
        const uploadedVideo = await uploadVideo({
          file: body.file,
        });

        return prisma.file.create({
          data: {
            url: uploadedVideo.url,
            provider_image_id: uploadedVideo.id,
            delete_url: uploadedVideo.delete_url,
            // userId: user?.id,
            type: body.type,
          },
        });
      }

      throw new HttpError({
        message: t({
          en: 'Invalid file type',
          ar: 'نوع الملف غير صالح',
        }),
      });
    },
    {
      body: t.Object({
        file: t.File(),
        type: t.Union([t.Literal('Image'), t.Literal('Video')]),
      }),
      response: {
        200: FilePlain,
      },
    },
  );
