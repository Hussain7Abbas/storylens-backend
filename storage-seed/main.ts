import { readdir } from 'node:fs/promises';
import { uploadImage } from '../src/lib/storage/helpers';

const paths = ['./storage-seed/assets/avatars'];

for (const path of paths) {
  const filesNames = await readdir(path);

  const promises = [];
  for (const fileName of filesNames) {
    const bunFile = Bun.file(`${path}/${fileName}`);
    const arrayBuffer = await bunFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const file = new File([buffer], fileName);

    const promise = uploadImage({
      file,
      useNameAsKey: true,
    });

    promises.push(promise);
  }

  await Promise.all(promises);
}
