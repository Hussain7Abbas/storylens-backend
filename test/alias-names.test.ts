import { describe, expect, it } from 'bun:test';
import { aliasNameColumns, aliasNames, scriptLanguage } from '@/utils/translation';

describe('scriptLanguage', () => {
  it('reads the language from the script', () => {
    expect(scriptLanguage('ميرا')).toBe('ar');
    expect(scriptLanguage('Mira')).toBe('en');
    expect(scriptLanguage('Ling’er 2')).toBe('en');
    expect(scriptLanguage('123')).toBeNull();
    expect(scriptLanguage('١٢٣')).toBeNull();
    expect(scriptLanguage('Ali ْ')).toBe('en');
  });
});

describe('aliasNames', () => {
  it('fills the language of an older alias from its name', () => {
    expect(aliasNames({ name: 'Little Mira' })).toEqual({ ar: null, en: 'Little Mira' });
    expect(aliasNames({ name: 'ميرا الصغيرة', nameAr: null, nameEn: null })).toEqual({ ar: 'ميرا الصغيرة', en: null });
  });

  it('keeps a translation next to the name', () => {
    expect(aliasNames({ name: 'Little Mira', nameAr: 'ميرا الصغيرة', nameEn: null })).toEqual({
      ar: 'ميرا الصغيرة',
      en: 'Little Mira',
    });
  });

  it('does not repeat a name already stored in the other column', () => {
    // An English name filed as Arabic stays where it was put.
    expect(aliasNames({ name: 'Mira', nameAr: 'Mira', nameEn: null })).toEqual({ ar: 'Mira', en: null });
  });

  it('leaves a name without letters out', () => {
    expect(aliasNames({ name: '007' })).toEqual({ ar: null, en: null });
  });
});

describe('aliasNameColumns', () => {
  it('files a new alias under its script', () => {
    expect(aliasNameColumns('Little Mira')).toEqual({ nameAr: null, nameEn: 'Little Mira' });
    expect(aliasNameColumns('ميرا')).toEqual({ nameAr: 'ميرا', nameEn: null });
    expect(aliasNameColumns('007')).toEqual({ nameAr: null, nameEn: null });
  });

  it('moves the renamed name and keeps the translation', () => {
    const previous = { name: 'Little Mira', nameAr: 'ميرا الصغيرة', nameEn: 'Little Mira' };
    expect(aliasNameColumns('Tiny Mira', previous)).toEqual({ nameAr: 'ميرا الصغيرة', nameEn: 'Tiny Mira' });
  });

  it('clears the old name when the rename changes language', () => {
    expect(aliasNameColumns('ميرا', { name: 'Mira', nameAr: null, nameEn: 'Mira' })).toEqual({
      nameAr: 'ميرا',
      nameEn: null,
    });
  });

  it('renames an older alias that had no language columns', () => {
    expect(aliasNameColumns('Tiny Mira', { name: 'Little Mira', nameAr: null, nameEn: null })).toEqual({
      nameAr: null,
      nameEn: 'Tiny Mira',
    });
  });
});
