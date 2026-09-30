import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULTS, ID_RE, lighten, newId, parsePlaceholders, parseTemplate } from '../src/core/theme.js';
import { MdpressError, localizeIssue } from '../src/core/errors.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { t } from '../src/i18n/index.js';

const base = { id: 'abcd1234', slug: 'sample', name: 'Sample' };

function issuesOf(input: unknown): string[] {
  try {
    parseTemplate(input);
  } catch (err) {
    if (err instanceof MdpressError) return err.issues.map((i) => i.path);
    throw err;
  }
  return [];
}

describe('parseTemplate', () => {
  it('fills a minimal template with defaults', () => {
    const t = parseTemplate(base);
    expect(t.schemaVersion).toBe(1);
    expect(t.page.size).toBe('A4');
    expect(t.fonts.size).toBe(11);
    expect(t.logo.file).toBeNull();
  });
  it('merges partial nested fields', () => {
    const t = parseTemplate({ ...base, colors: { accent: '#ff0000' } });
    expect(t.colors.accent).toBe('#ff0000');
    expect(t.colors.text).toBe(DEFAULTS.colors.text);
  });
  it('reports invalid colors with the field path', () => {
    expect(issuesOf({ ...base, colors: { accent: 'red' } })).toEqual(['colors.accent']);
  });
  it('rejects invalid slugs', () => {
    expect(issuesOf({ ...base, slug: 'Bad Slug' })).toEqual(['slug']);
  });
  it('rejects unknown schema versions', () => {
    expect(issuesOf({ ...base, schemaVersion: 2 })).toEqual(['schemaVersion']);
  });
  it('accepts only logo.png or logo.jpg as the logo', () => {
    expect(issuesOf({ ...base, logo: { file: '../x.png' } })).toEqual(['logo.file']);
    expect(parseTemplate({ ...base, logo: { file: 'logo.jpg' } }).logo.file).toBe('logo.jpg');
  });
  it('rejects out-of-range margins', () => {
    expect(issuesOf({ ...base, page: { margins: { top: 200 } } })).toEqual(['page.margins.top']);
  });
  it('rejects input that is not an object', () => {
    expect(issuesOf('text')).toEqual(['']);
  });
});

describe('parsePlaceholders', () => {
  it('splits text and known placeholders', () => {
    expect(parsePlaceholders('{title} - p. {page}/{pages} {foo}')).toEqual([
      { kind: 'field', name: 'title' },
      { kind: 'text', value: ' - p. ' },
      { kind: 'field', name: 'page' },
      { kind: 'text', value: '/' },
      { kind: 'field', name: 'pages' },
      { kind: 'text', value: ' {foo}' },
    ]);
  });
  it('empty string gives no segments', () => {
    expect(parsePlaceholders('')).toEqual([]);
  });
});

describe('utilities', () => {
  it('lighten mixes with white', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080');
    expect(lighten('#0b3d91', 0)).toBe('#0b3d91');
    expect(lighten('#0b3d91', 1)).toBe('#ffffff');
  });
  it('newId produces valid ids', () => {
    expect(newId()).toMatch(ID_RE);
  });
});

describe('built-in standard', () => {
  it('is valid and matches the defaults', async () => {
    const raw = JSON.parse(await readFile(join(builtinTemplatesDir, 'standard', 'template.json'), 'utf8'));
    const { id, slug, name, description, ...rest } = parseTemplate(raw);
    expect({ id, slug, name }).toEqual({ id: 'mdpstd01', slug: 'standard', name: 'Standard' });
    expect({ ...rest, description: DEFAULTS.description }).toEqual(DEFAULTS);
    expect(description.length).toBeGreaterThan(0);
  });
});

describe('validation issues carry translation keys', () => {
  const keysOf = (input: unknown) => {
    try {
      parseTemplate(input);
    } catch (err) {
      if (err instanceof MdpressError) return err.issues.map((i) => [i.path, i.key, i.params]);
      throw err;
    }
    return [];
  };

  it('maps each zod issue to a key', () => {
    expect(keysOf({ ...base, fonts: { size: 20 } })).toEqual([['fonts.size', 'validation.tooBig', { max: 16 }]]);
    expect(keysOf({ ...base, fonts: { size: 2 } })).toEqual([['fonts.size', 'validation.tooSmall', { min: 8 }]]);
    expect(keysOf({ ...base, page: { margins: { top: null } } })).toEqual([['page.margins.top', 'validation.number', {}]]);
    expect(keysOf({ ...base, headings: { numbered: 'yes' } })).toEqual([['headings.numbered', 'validation.boolean', {}]]);
    expect(keysOf({ ...base, colors: { accent: 'red' } })).toEqual([['colors.accent', 'validation.color', {}]]);
    expect(keysOf({ ...base, slug: 'Bad Slug' })).toEqual([['slug', 'validation.slug', {}]]);
    expect(keysOf({ ...base, logo: { file: '../x.png' } })).toEqual([['logo.file', 'validation.logoFile', {}]]);
    expect(keysOf({ ...base, page: { size: 'A3' } })).toEqual([['page.size', 'validation.oneOf', { values: 'A4, A5, Letter' }]]);
    expect(keysOf({ ...base, name: '' })).toEqual([['name', 'validation.required', {}]]);
    expect(keysOf({ ...base, description: 'x'.repeat(301) })).toEqual([['description', 'validation.tooLong', { max: 300 }]]);
    expect(keysOf({ ...base, header: { left: { type: 'image' } } })).toEqual([
      ['header.left.type', 'validation.oneOf', { values: 'empty, logo, text' }],
    ]);
    expect(keysOf('text')).toEqual([['', 'validation.notObject', {}]]);
  });

  it('localizes issues', () => {
    const issue = { path: 'fonts.size', key: 'validation.tooBig', params: { max: 16 } };
    expect(localizeIssue(issue, 'en')).toBe('must be at most 16');
    expect(localizeIssue(issue, 'it')).toBe(t('validation.tooBig', { max: 16 }, 'it'));
  });

  it('defaults the document language to English and accepts Italian', () => {
    expect(parseTemplate(base).language).toBe('en');
    expect(parseTemplate({ ...base, language: 'it' }).language).toBe('it');
    expect(keysOf({ ...base, language: 'fr' })).toEqual([['language', 'validation.oneOf', { values: 'en, it' }]]);
  });
});
