import { describe, expect, it } from 'bun:test';
import { scriptLanguage } from '@/utils/translation';

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
