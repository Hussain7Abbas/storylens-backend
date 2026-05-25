import { FilePlain } from '@/lib/db';
import { uploadImage, uploadVideo } from '@/lib/storage';
import { Elysia, t } from 'elysia';
import { shouldBeUser } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { saveUploadedFile } from '@/utils/save-uploaded-file';

export const files = new Elysia({ prefix: '/files', tags: ['Files'] })
  .use(setup)
  .use(shouldBeUser())

  .post(
    '/upload',
    async ({ body, prisma, t }) => {
      if (body.type === 'Image') {
        const uploadedImage = await uploadImage({
          file: body.file,
        });

        return saveUploadedFile(prisma, uploadedImage, body.type);
      }

      if (body.type === 'Video') {
        const uploadedVideo = await uploadVideo({
          file: body.file,
        });

        return saveUploadedFile(prisma, uploadedVideo, body.type);
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
