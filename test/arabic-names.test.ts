import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { prisma } from '@/lib/db';
import { cleanKeywordName, stripArabicDiacritics } from '@/utils/arabic';
import { type Actor, call, cleanup, live, makeActor, makeStyles } from './helpers/live-db';

type Row = { id: string; updatedAt: string; nameAr: string | null; nameEn: string | null };
type ErrorBody = { message: string; code?: string };

describe('stripArabicDiacritics', () => {
  it('removes harakat, tanween, shadda, sukun, the dagger alif and tatweel', () => {
    expect(stripArabicDiacritics('مُحَمَّدٌ')).toBe('محمد');
    expect(stripArabicDiacritics('إِبْرَاهِيم')).toBe('إبراهيم');
    expect(stripArabicDiacritics('هٰذا')).toBe('هذا');
    expect(stripArabicDiacritics('مـحـمـد')).toBe('محمد');
  });

  it('keeps hamza and madda letters, composing decomposed ones', () => {
    expect(stripArabicDiacritics('أَحْمَد')).toBe('أحمد');
    expect(stripArabicDiacritics('آدَم')).toBe('آدم');
    expect(stripArabicDiacritics('ا\u{0654}حمد')).toBe('أحمد');
    expect(stripArabicDiacritics('ا\u{0655}براهيم')).toBe('إبراهيم');
    expect(stripArabicDiacritics('مُؤْمِن')).toBe('مؤمن');
  });

  it('leaves other scripts alone', () => {
    expect(stripArabicDiacritics('Zhang Wei')).toBe('Zhang Wei');
    expect(stripArabicDiacritics('Café')).toBe('Café');
  });

  it('cleanKeywordName trims and returns null when only marks are left', () => {
    expect(cleanKeywordName('  سَيْف  ')).toBe('سيف');
    expect(cleanKeywordName(' ً ')).toBeNull();
    expect(cleanKeywordName('')).toBeNull();
  });
});

const marker = crypto.randomUUID().slice(0, 8);
const ids = { novels: [] as string[], users: [] as string[], categories: [] as string[], natures: [] as string[] };
let owner: Actor;
let novelId: string;
let categoryId: string;
let natureId: string;

beforeAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  owner = await makeActor('reader', marker);
  ids.users.push(owner.id);
  const novel = await prisma.novel.create({ data: { nameEn: `Diacritics ${marker}`, createdById: owner.id } });
  novelId = novel.id;
  ids.novels.push(novel.id);
  const styles = await makeStyles(marker);
  categoryId = styles.category.id;
  natureId = styles.nature.id;
  ids.categories.push(categoryId);
  ids.natures.push(natureId);
});

afterAll(async () => {
  if (process.env.STORYLENS_LIVE_DB_TEST !== '1') return;
  await cleanup(ids);
});

describe('stored keyword and alias names', () => {
  live('reader routes store names without diacritics and treat them as the same name', async () => {
    const keywordId = crypto.randomUUID();
    const created = await call<Row>(owner, 'POST', '/keywords', {
      id: keywordId, versionId: crypto.randomUUID(), novelId, categoryId, natureId, nameAr: `مُحَمَّد ${marker}`,
    });
    expect(created.status).toBe(200);
    expect(created.body.nameAr).toBe(`محمد ${marker}`);

    const twin = await call<ErrorBody>(owner, 'POST', '/keywords', {
      id: crypto.randomUUID(), versionId: crypto.randomUUID(), novelId, categoryId, natureId, nameAr: `محمّد ${marker}`,
    });
    expect(twin.status).toBe(409);
    expect(twin.body.code).toBe('KEYWORD_NAME_TAKEN');

    const updated = await call<Row>(owner, 'PUT', `/keywords/${keywordId}`, {
      baseUpdatedAt: created.body.updatedAt, nameAr: `أَحْمَد ${marker}`,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.nameAr).toBe(`أحمد ${marker}`);

    const alias = await call<Row>(owner, 'POST', '/keyword-aliases', {
      id: crypto.randomUUID(), keywordId, nameAr: 'سَيْفُ الدِّين',
    });
    expect(alias.status).toBe(200);
    expect(alias.body.nameAr).toBe('سيف الدين');
    expect((await prisma.keywordAlias.findUniqueOrThrow({ where: { id: alias.body.id } })).nameAr).toBe('سيف الدين');
  });

  live('a name made only of diacritics counts as missing', async () => {
    const result = await call<ErrorBody>(owner, 'POST', '/keywords', {
      id: crypto.randomUUID(), versionId: crypto.randomUUID(), novelId, categoryId, natureId, nameAr: 'ً',
    });
    expect(result.status).toBe(422);
  });
});
