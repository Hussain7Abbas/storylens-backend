import { afterAll, describe, expect, mock } from 'bun:test';
import { prisma } from '@/lib/db';
import * as storage from '@/lib/storage/helpers';
import type { ImageData } from '@/lib/storage/types';
import { app } from '@/server';
import { cleanup, live, makeActor } from './helpers/live-db';

const marker = crypto.randomUUID().slice(0, 8);
const users: string[] = [];
let uploads = 0;

mock.module('@/lib/storage/helpers', () => ({
  ...storage,
  uploadImage: async () => {
    uploads++;
    const id = `${marker}-${uploads}`;
    return { id, url: `https://example.invalid/${id}.png`, delete_url: `https://example.invalid/${id}/delete` } as ImageData;
  },
}));

async function upload(token: string, fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const response = await app.handle(
    new Request('http://localhost/api/user/files/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Client-Version': 'extension/3.2.2' },
      body: form,
    }),
  );
  return { status: response.status, body: (await response.json().catch(() => ({}))) as { id?: string; code?: string } };
}

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await prisma.file.deleteMany({ where: { provider_image_id: { startsWith: marker } } });
  await cleanup({ users });
});

describe('file uploads with client IDs', () => {
  live('replays an upload without calling the storage provider again', async () => {
    const [reader, other] = await Promise.all([makeActor('reader', marker), makeActor('reader', marker)]);
    users.push(reader.id, other.id);
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' });
    const id = crypto.randomUUID();

    const first = await upload(reader.token, { id, type: 'Image', file: image });
    expect([first.status, first.body.id]).toEqual([200, id]);
    const replay = await upload(reader.token, { id, type: 'Image', file: image });
    expect([replay.status, replay.body.id]).toEqual([200, id]);
    expect(uploads).toBe(1);
    expect((await prisma.file.findUniqueOrThrow({ where: { id } })).userId).toBe(reader.id);

    const foreign = await upload(other.token, { id, type: 'Image', file: image });
    expect([foreign.status, foreign.body.code]).toEqual([409, 'ID_CONFLICT']);
    const missing = await upload(reader.token, { type: 'Image', file: image });
    expect(missing.status).toBe(422);
  });

  live('serializes concurrent replays before the provider call', async () => {
    const reader = await makeActor('reader', marker);
    users.push(reader.id);
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'parallel.png', { type: 'image/png' });
    const id = crypto.randomUUID();
    const before = uploads;
    const [first, second] = await Promise.all([
      upload(reader.token, { id, type: 'Image', file: image }),
      upload(reader.token, { id, type: 'Image', file: image }),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect([first.body.id, second.body.id]).toEqual([id, id]);
    expect(uploads - before).toBe(1);
  });
});
