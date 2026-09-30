import { expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../src/core/slug.js';
import { SLUG_RE } from '../src/core/theme.js';

it('slugify toglie accenti e caratteri non ammessi', () => {
  expect(slugify('Relazione Qualità 2026!')).toBe('relazione-qualita-2026');
  expect(slugify('  --  ')).toBe('template');
  expect(slugify('x'.repeat(100))).toMatch(SLUG_RE);
});

it('uniqueSlug aggiunge un suffisso numerico', () => {
  expect(uniqueSlug('report', [])).toBe('report');
  expect(uniqueSlug('report', ['report', 'report-2'])).toBe('report-3');
});
