import { Elysia, t } from 'elysia';
import { FilePlain } from '@/lib/db';
import { uploadImage } from '@/lib/storage';
import { authorize } from '@/middleware/authorize';
import { setup } from '@/setup';
import { saveUploadedFile } from '@/utils/save-uploaded-file';

export const adminFiles = new Elysia({ prefix: '/files', tags: ['Admin: Files'] })
  .use(setup)
  .use(authorize('admin'))

  .post(
    '/upload',
    async ({ body, prisma }) => {
      const uploaded = await uploadImage({ file: body.file });
      return saveUploadedFile(prisma, uploaded, 'Image');
    },
    {
      body: t.Object({
        file: t.File({ type: 'image', maxSize: '8m' }),
      }),
      response: { 200: FilePlain },
      detail: { summary: 'Upload an image' },
    },
  );
