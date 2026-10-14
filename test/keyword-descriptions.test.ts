import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { descriptionData } from '@/lib/keywords/descriptions';
import { prisma } from '@/lib/db';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

describe('translated description writes', () => {
  it('writes only the supplied language and preserves explicit clearing', () => {
    expect(descriptionData({ descriptionAr: 'بطل الرواية' })).toEqual({ descriptionAr: 'بطل الرواية', description: 'بطل الرواية' });
    expect(descriptionData({ descriptionAr: null })).toEqual({ descriptionAr: null, description: null });
    expect(descriptionData({})).toEqual({});
  });
  it('supports older shared-field clients without overwriting the other translation', () => {
    expect(descriptionData({ description: 'A hero' }, 'ar')).toEqual({ description: 'A hero', descriptionEn: 'A hero' });
    expect(descriptionData({ description: 'بطل الرواية' }, 'en')).toEqual({ description: 'بطل الرواية', descriptionAr: 'بطل الرواية' });
    expect(descriptionData({ description: 'Legacy', descriptionEn: 'English', descriptionAr: 'العربية' })).toEqual({ description: 'Legacy', descriptionEn: 'English', descriptionAr: 'العربية' });
  });
});

type Row = { id: string; updatedAt: string; descriptionAr: string | null; descriptionEn: string | null; description: string | null };
const ids = { novels: [] as string[], users: [] as string[], categories: [] as string[], natures: [] as string[] };
let owner: Actor;
let novelId: string;
let categoryId: string;
let natureId: string;
beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  owner = await makeActor('reader', 'descriptions');
  ids.users.push(owner.id);
  const novel = await prisma.novel.create({ data: { nameEn: 'Description test', createdById: owner.id } });
  novelId = novel.id;
  ids.novels.push(novel.id);
  const { category, nature } = await makeStyles('descriptions');
  categoryId = category.id;
  natureId = nature.id;
  ids.categories.push(category.id);
  ids.natures.push(nature.id);
});
afterAll(async () => { if (process.env.STORYLENS_LIVE_DB_TEST === '1') await cleanup(ids); });

describe('keyword and alias bilingual descriptions', () => {
  live('keeps EN when AR is saved or cleared, round trips both, and accepts legacy writes', async () => {
    const keyword = await call<{ id: string; versions: Row[] }>(owner, 'POST', '/keywords', {
      id: crypto.randomUUID(), versionId: crypto.randomUUID(), novelId, categoryId, natureId,
      nameEn: 'Mira', nameAr: 'ميرا', descriptionEn: 'An English description', descriptionAr: 'وصف عربي',
    });
    expect(keyword.status).toBe(200);
    const alias = await call<Row>(owner, 'POST', '/keyword-aliases', {
      id: crypto.randomUUID(), keywordId: keyword.body.id, nameEn: 'The hero', nameAr: 'البطل',
      descriptionEn: 'Alias in English', descriptionAr: 'وصف الاسم البديل',
    });
    expect(alias.status).toBe(200);
    for (const [route, initial] of [['keyword-versions', keyword.body.versions[0]], ['keyword-aliases', alias.body]] as const) {
      if (!initial) throw new Error('Created version missing');
      expect(initial.descriptionAr).toBeTruthy();
      expect(initial.descriptionEn).toBeTruthy();
      const updated = await call<Row>(owner, 'PUT', `/${route}/${initial.id}`, { baseUpdatedAt: initial.updatedAt, descriptionAr: 'وصف عربي جديد' });
      expect(updated.status).toBe(200);
      expect(updated.body.descriptionAr).toBe('وصف عربي جديد');
      expect(updated.body.descriptionEn).toBe(initial.descriptionEn);
      const cleared = await call<Row>(owner, 'PUT', `/${route}/${initial.id}`, { baseUpdatedAt: updated.body.updatedAt, descriptionAr: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.descriptionAr).toBeNull();
      expect(cleared.body.descriptionEn).toBe(initial.descriptionEn);
      const legacy = await call<Row>(owner, 'PUT', `/${route}/${initial.id}`, { baseUpdatedAt: cleared.body.updatedAt, description: 'قديم' });
      expect(legacy.status).toBe(200);
      expect(legacy.body.descriptionAr).toBe('قديم');
      expect(legacy.body.descriptionEn).toBe(initial.descriptionEn);
    }
    const read = await call<{ aliases: Row[]; versions: Row[] }>(owner, 'GET', `/keywords/${keyword.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.versions[0]?.descriptionEn).toBe('An English description');
    expect(read.body.aliases[0]?.descriptionEn).toBe('Alias in English');
  });
  live('preserves both descriptions when translation rows are linked', async () => {
    const create = async (name: { nameEn?: string; nameAr?: string }, descriptions: { descriptionAr?: string; descriptionEn?: string }) => {
      const result = await call<{ id: string; updatedAt: string; versions: Row[] }>(owner, 'POST', '/keywords', {
        id: crypto.randomUUID(), versionId: crypto.randomUUID(), novelId, categoryId, natureId, ...name, ...descriptions,
      });
      expect(result.status).toBe(200);
      return result.body;
    };
    const target = await create({ nameEn: 'Translation target' }, { descriptionEn: 'Keep English' });
    const source = await create({ nameAr: 'مصدر الترجمة' }, { descriptionAr: 'احتفظ بالعربية' });
    const linked = await call<{ versions: Row[] }>(owner, 'PUT', `/keywords/${target.id}`, { baseUpdatedAt: target.updatedAt, translationKeywordId: source.id });
    expect(linked.status).toBe(200);
    expect(linked.body.versions[0]?.descriptionEn).toBe('Keep English');
    expect(linked.body.versions[0]?.descriptionAr).toBe('احتفظ بالعربية');
    const aliasTarget = await call<Row>(owner, 'POST', '/keyword-aliases', { id: crypto.randomUUID(), keywordId: target.id, nameEn: 'English alias', descriptionEn: 'Keep alias English' });
    const aliasSource = await call<Row>(owner, 'POST', '/keyword-aliases', { id: crypto.randomUUID(), keywordId: target.id, nameAr: 'الاسم العربي', descriptionAr: 'احتفظ بوصف الاسم' });
    const aliasLinked = await call<Row>(owner, 'PUT', `/keyword-aliases/${aliasTarget.body.id}`, { baseUpdatedAt: aliasTarget.body.updatedAt, translationAliasId: aliasSource.body.id });
    expect(aliasLinked.status).toBe(200);
    expect(aliasLinked.body.descriptionEn).toBe('Keep alias English');
    expect(aliasLinked.body.descriptionAr).toBe('احتفظ بوصف الاسم');
  });

});
