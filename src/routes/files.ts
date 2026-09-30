import { FilePlain } from '@/lib/db';
import { uploadImage, uploadVideo } from '@/lib/storage';
import { Elysia, t } from 'elysia';
import { findReplay } from '@/lib/sync/replay';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { HttpError } from '@/utils/errors';
import { saveUploadedFile } from '@/utils/save-uploaded-file';

export const files = new Elysia({ prefix: '/files', tags: ['Files'] })
  .use(setup)
  .use(authorize('user'))

  // The client sends the file's ID (images can be queued offline), so a replay of a
  // lost response returns the stored file without uploading it again.
  .post(
    '/upload',
    async ({ body, prisma, t, authedUser }) => {
      const replay = await findReplay(
        () => prisma.file.findUnique({ where: { id: body.id } }),
        (file) => file.userId === authedUser.id,
        t,
      );
      if (replay) return replay;

      if (body.type === 'Image') {
        const uploadedImage = await uploadImage({
          file: body.file,
        });

        return saveUploadedFile(prisma, uploadedImage, body.type, { id: body.id, userId: authedUser.id });
      }

      if (body.type === 'Video') {
        const uploadedVideo = await uploadVideo({
          file: body.file,
        });

        return saveUploadedFile(prisma, uploadedVideo, body.type, { id: body.id, userId: authedUser.id });
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
        id: t.String({ format: 'uuid' }),
        file: t.File(),
        type: t.Union([t.Literal('Image'), t.Literal('Video')]),
      }),
      response: {
        200: FilePlain,
      },
    },
  );
