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

      // A transaction-scoped lock for this client ID spans the provider call.
      // A concurrent replay waits, sees the committed row and skips upload.
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(20260930, hashtext(${body.id}))`;
        const committed = await findReplay(
          () => tx.file.findUnique({ where: { id: body.id } }),
          (file) => file.userId === authedUser.id,
          t,
        );
        if (committed) return committed;

        if (body.type === 'Image') {
          const uploaded = await uploadImage({ file: body.file });
          return saveUploadedFile(tx, uploaded, body.type, { id: body.id, userId: authedUser.id });
        }
        if (body.type === 'Video') {
          const uploaded = await uploadVideo({ file: body.file });
          return saveUploadedFile(tx, uploaded, body.type, { id: body.id, userId: authedUser.id });
        }
        throw new HttpError({
          message: t({ en: 'Invalid file type', ar: 'نوع الملف غير صالح' }),
        });
      }, { timeout: 120_000 });
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
