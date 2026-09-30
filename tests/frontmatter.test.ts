import { expect, it } from 'vitest';
import { readFrontmatter } from '../src/core/frontmatter.js';

it('reads metadata, joins authors and strips * and `', () => {
  const md = '---\ntitle: "Report *Q3*"\nauthor: [Mario Rossi, Anna Bianchi]\ndate: 2026-09-30\ntoc: true\n---\n\n# Hello';
  expect(readFrontmatter(md)).toEqual({
    title: 'Report Q3',
    author: 'Mario Rossi, Anna Bianchi',
    date: '2026-09-30',
    toc: true,
  });
});

it('supports authors as objects with name', () => {
  expect(readFrontmatter('---\nauthor:\n  - name: Ada\n  - name: Bob\n---\n').author).toBe('Ada, Bob');
});

it('returns {} without front-matter', () => {
  expect(readFrontmatter('# Text only')).toEqual({});
});

it('ignores a --- block that is not at the top of the file', () => {
  expect(readFrontmatter('Text\n\n---\ntitle: x\n---\n')).toEqual({});
});

it('handles BOM and CRLF', () => {
  expect(readFrontmatter('﻿---\r\ntitle: Hello\r\n---\r\n').title).toBe('Hello');
});

it('reports invalid YAML', () => {
  expect(() => readFrontmatter('---\ntitle: [open\n---\n')).toThrow(expect.objectContaining({ key: 'errors.frontmatterInvalid' }));
});

it('ignores non-boolean toc and cover', () => {
  expect(readFrontmatter('---\ntoc: "s\u00ec"\ncover: 1\n---\n')).toEqual({});
});
