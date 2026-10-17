import { expect } from 'bun:test';
import { createSessionToken } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { app } from '@/server';
import { call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

type Styled = { id: string; imagePrompt: string | null; updatedAt: string };
type Keyword = { id: string; versions: Styled[] };

live('image prompts survive reader/admin saves, partial edits, replay, and explicit clears', async () => {
  const marker = crypto.randomUUID();
  const actor = await makeActor('reader', marker);
  const styles = await makeStyles(marker);
  const novel = await prisma.novel.create({ data: { nameEn: `Prompts ${marker}` } });
  const prompt = 'Ink illustration of Mira.\nSilver cloak, blue eyes, forest background.';
  const body = {
    id: crypto.randomUUID(), versionId: crypto.randomUUID(), novelId: novel.id,
    nameEn: `Mira ${marker}`, categoryId: styles.category.id, natureId: styles.nature.id,
    imagePrompt: prompt,
  };
  try {
    const created = await call<Keyword>(actor, 'POST', '/keywords', body);
    expect(created.status).toBe(200);
    expect(created.body.versions[0]?.imagePrompt).toBe(prompt);
    expect((await call<Keyword>(actor, 'POST', '/keywords', { ...body, imagePrompt: 'Ignored replay' })).body).toEqual(created.body);
    const alias = await call<Styled>(actor, 'POST', '/keyword-aliases', {
      id: crypto.randomUUID(), keywordId: body.id, nameEn: `Scout ${marker}`, imagePrompt: prompt,
    });
    const version = await call<Styled>(actor, 'POST', '/keyword-versions', {
      id: crypto.randomUUID(), keywordId: body.id, currentChapter: 10, imagePrompt: prompt,
    });
    expect(alias.status).toBe(200);
    expect(version.status).toBe(200);
    const base = await prisma.keywordVersion.findUniqueOrThrow({ where: { id: body.versionId } });
    for (const [route, row] of [
      ['keyword-versions', { ...base, updatedAt: base.updatedAt.toISOString() }],
      ['keyword-aliases', alias.body], ['keyword-versions', version.body],
    ] as const) {
      expect(row.imagePrompt).toBe(prompt);
      const edit = await call<Styled>(actor, 'PUT', `/${route}/${row.id}`, {
        baseUpdatedAt: row.updatedAt, imagePrompt: `${prompt}\nRed cloak instead.`,
      });
      expect(edit.status).toBe(200);
      const partial = await call<Styled>(actor, 'PUT', `/${route}/${row.id}`, {
        baseUpdatedAt: edit.body.updatedAt, descriptionEn: 'Updated description',
      });
      expect(partial.status).toBe(200);
      expect(partial.body.imagePrompt).toBe(`${prompt}\nRed cloak instead.`);
      const clear = await call<Styled>(actor, 'PUT', `/${route}/${row.id}`, {
        baseUpdatedAt: partial.body.updatedAt, imagePrompt: null,
      });
      expect(clear.status).toBe(200);
      expect(clear.body.imagePrompt).toBeNull();
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { slug: 'super-admin' } });
    await prisma.user.update({ where: { id: actor.id }, data: { isAdmin: true, adminRoleId: role.id } });
    const token = await createSessionToken(prisma, actor.id, 'admin');
    const admin = async <T>(method: string, path: string, data?: object): Promise<T> => {
      const response = await app.handle(new Request(`http://localhost/api/admin${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
      }));
      expect(response.status).toBe(200);
      return response.json() as Promise<T>;
    };
    const adminKeyword = await admin<Keyword>('POST', '/keywords', { novelId: novel.id, nameEn: `Admin ${marker}`, imagePrompt: prompt });
    expect(adminKeyword.versions[0]?.imagePrompt).toBe(prompt);
    const adminAlias = await admin<Styled>('POST', '/keyword-aliases', { keywordId: adminKeyword.id, nameEn: 'Alias', imagePrompt: prompt });
    const adminVersion = await admin<Styled>('POST', '/keyword-versions', { keywordId: adminKeyword.id, startingChapter: 10, imagePrompt: prompt });
    for (const [route, row] of [['keyword-aliases', adminAlias], ['keyword-versions', adminVersion]] as const) {
      expect(row.imagePrompt).toBe(prompt);
      expect((await admin<Styled>('PUT', `/${route}/${row.id}`, { descriptionEn: 'Partial' })).imagePrompt).toBe(prompt);
      expect((await admin<Styled>('PUT', `/${route}/${row.id}`, { imagePrompt: null })).imagePrompt).toBeNull();
    }
    const oldClient = await admin<Keyword>('POST', '/keywords', { novelId: novel.id, nameEn: `Legacy ${marker}` });
    expect(oldClient.versions[0]?.imagePrompt).toBeNull();
    const profile = await admin<{ data: Keyword[] }>('GET', `/novels/${novel.id}/keywords`);
    expect(profile.data.find((item) => item.id === adminKeyword.id)?.versions[0]?.imagePrompt).toBe(prompt);
  } finally {
    await cleanup({ novels: [novel.id], users: [actor.id], categories: [styles.category.id], natures: [styles.nature.id] });
  }
});
