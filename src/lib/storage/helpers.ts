import * as path from 'node:path';
import sharp from 'sharp';
import axios from 'axios';
import { env } from './env';
import type {
  ImageData,
  ImgBBDeleteRequest,
  ImgBBUploadRequest,
  ImgBBUploadResponse,
} from './types';

const client = axios.create({
  baseURL: 'https://api.imgbb.com/1',
});

export async function deleteFile(imageId: string) {
  const imgbbDeleteParams: ImgBBDeleteRequest = {
    key: env.STORAGE_IMGBB_API_KEY,
    image_id: imageId,
  };

  await client.get('/delete', { params: imgbbDeleteParams });
}

export async function uploadFile(file: Buffer, fileName: string): Promise<ImageData> {
  const imgbbUploadBody: ImgBBUploadRequest = {
    key: env.STORAGE_IMGBB_API_KEY,
    image: file,
    name: fileName,
    expiration: 60 * 60 * 24 * 30,
  };
  const imgbbResponse: ImgBBUploadResponse = await client.post(
    '/upload',
    imgbbUploadBody,
  );

  if (!imgbbResponse.success) {
    throw new Error('Failed to upload image', { cause: imgbbResponse });
  }

  return imgbbResponse.data;
}

async function compressImage(imageFile: File, fileName: string): Promise<File> {
  const buffer = await imageFile.arrayBuffer();

  const webpBuffer = await sharp(Buffer.from(buffer))
    .webp({ quality: 80 })
    .toBuffer();

  return new File([new Uint8Array(webpBuffer)], fileName, {
    type: 'image/webp',
  });
}

function replaceFileExtension(fileName: string, newExtension: string): string {
  const baseName = fileName.slice(0, fileName.lastIndexOf('.'));
  return `${baseName}.${newExtension}`;
}

export async function uploadImage({
  file,
  useNameAsKey = false,
}: {
  file: File;
  useNameAsKey?: boolean;
}) {
  const key = useNameAsKey
    ? replaceFileExtension(file.name, 'webp')
    : `${crypto.randomUUID()}.webp`;

  const compressedFile = await compressImage(file, key);

  const arrayBuffer = await compressedFile.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return await uploadFile(buffer, key);
}

export async function uploadVideo({
  file,
  useNameAsKey = false,
}: {
  file: File;
  useNameAsKey?: boolean;
}) {
  const ext = path.extname(file.name);
  const key = useNameAsKey ? file.name : `${crypto.randomUUID()}${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return await uploadFile(buffer, key);
}
