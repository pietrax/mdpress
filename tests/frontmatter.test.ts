import { expect, it } from 'vitest';
import { readFrontmatter } from '../src/core/frontmatter.js';

it('legge i metadati, unisce gli autori e toglie * e `', () => {
  const md = '---\ntitle: "Report *Q3*"\nauthor: [Mario Rossi, Anna Bianchi]\ndate: 2026-09-30\ntoc: true\n---\n\n# Ciao';
  expect(readFrontmatter(md)).toEqual({
    title: 'Report Q3',
    author: 'Mario Rossi, Anna Bianchi',
    date: '2026-09-30',
    toc: true,
  });
});

it('supporta autori come oggetti con name', () => {
  expect(readFrontmatter('---\nauthor:\n  - name: Ada\n  - name: Bob\n---\n').author).toBe('Ada, Bob');
});

it('senza front-matter restituisce {}', () => {
  expect(readFrontmatter('# Solo testo')).toEqual({});
});

it('ignora un blocco --- che non è in cima al file', () => {
  expect(readFrontmatter('Testo\n\n---\ntitle: x\n---\n')).toEqual({});
});

it('gestisce BOM e CRLF', () => {
  expect(readFrontmatter('﻿---\r\ntitle: Ciao\r\n---\r\n').title).toBe('Ciao');
});

it('segnala YAML non valido', () => {
  expect(() => readFrontmatter('---\ntitle: [aperta\n---\n')).toThrow(/Front-matter YAML non valido/);
});

it('ignora toc e cover non booleani', () => {
  expect(readFrontmatter('---\ntoc: "sì"\ncover: 1\n---\n')).toEqual({});
});
