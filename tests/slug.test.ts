import { expect, it } from 'vitest';
import { slugify, uniqueSlug } from '../src/core/slug.js';
import { SLUG_RE } from '../src/core/theme.js';

it('slugify strips accents and disallowed characters', () => {
  expect(slugify('Report Qualit\u00e0 2026!')).toBe('report-qualita-2026');
  expect(slugify('  --  ')).toBe('template');
  expect(slugify('x'.repeat(100))).toMatch(SLUG_RE);
});

it('uniqueSlug adds a numeric suffix', () => {
  expect(uniqueSlug('report', [])).toBe('report');
  expect(uniqueSlug('report', ['report', 'report-2'])).toBe('report-3');
});
