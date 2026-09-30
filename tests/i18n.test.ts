import { describe, expect, it } from 'vitest';
import en from '../src/i18n/locales/en.json' with { type: 'json' };
import itCatalogue from '../src/i18n/locales/it.json' with { type: 'json' };
import { isLanguage, normalizeLanguage, t } from '../src/i18n/index.js';
import { UnsupportedLanguageError, detectLanguage } from '../src/i18n/detect.js';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
  }
  return out;
}

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogues', () => {
  const enKeys = flatten(en as Tree);
  const itKeys = flatten(itCatalogue as Tree);

  it('have the same keys', () => {
    expect([...itKeys.keys()].sort()).toEqual([...enKeys.keys()].sort());
  });

  it('use the same parameters for every key', () => {
    for (const [key, value] of enKeys) expect(params(itKeys.get(key) ?? ''), key).toEqual(params(value));
  });

  it('have no empty strings', () => {
    for (const [key, value] of [...enKeys, ...itKeys]) expect(value.trim(), key).not.toBe('');
  });
});

describe('t', () => {
  it('interpolates parameters', () => {
    expect(t('errors.fileNotFound', { file: 'a.md' })).toBe('File not found: a.md');
  });
  it('uses the requested language', () => {
    expect(t('document.tocTitle', {}, 'it')).not.toBe(t('document.tocTitle', {}, 'en'));
  });
  it('falls back to the key when it is unknown', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
  it('leaves unknown placeholders untouched', () => {
    expect(t('errors.fileNotFound')).toBe('File not found: {file}');
  });
});

describe('languages', () => {
  it('normalizes locale strings', () => {
    expect(normalizeLanguage('it_IT.UTF-8')).toBe('it');
    expect(normalizeLanguage('it-IT')).toBe('it');
    expect(normalizeLanguage('EN')).toBe('en');
    expect(normalizeLanguage('C')).toBeNull();
    expect(normalizeLanguage('fr_FR')).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });
  it('isLanguage accepts only supported codes', () => {
    expect(isLanguage('it')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('follows flag → config → LC_ALL → LC_MESSAGES → LANG → en', () => {
    expect(detectLanguage({ env: {} })).toBe('en');
    expect(detectLanguage({ env: { LANG: 'it_IT.UTF-8' } })).toBe('it');
    expect(detectLanguage({ env: { LANG: 'it_IT.UTF-8', LC_MESSAGES: 'en_US.UTF-8' } })).toBe('en');
    expect(detectLanguage({ env: { LC_MESSAGES: 'en_US', LC_ALL: 'it_IT' } })).toBe('it');
    expect(detectLanguage({ config: 'it', env: { LANG: 'en_US' } })).toBe('it');
    expect(detectLanguage({ flag: 'en', config: 'it', env: { LANG: 'it_IT' } })).toBe('en');
  });
  it('ignores unsupported config and env values', () => {
    expect(detectLanguage({ config: 'fr', env: { LANG: 'de_DE' } })).toBe('en');
  });
  it('normalizes the flag', () => {
    expect(detectLanguage({ flag: 'IT', env: {} })).toBe('it');
    expect(detectLanguage({ flag: 'it-IT', env: {} })).toBe('it');
  });
  it('rejects an empty flag', () => {
    expect(() => detectLanguage({ flag: '', env: {} })).toThrow(UnsupportedLanguageError);
  });
  it('rejects an unsupported flag', () => {
    expect(() => detectLanguage({ flag: 'fr', env: {} })).toThrow(UnsupportedLanguageError);
  });
});
