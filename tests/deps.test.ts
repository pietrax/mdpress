import { expect, it } from 'vitest';
import { checkDeps, compareVersions, formatDep, parseVersion } from '../src/core/deps.js';
import { listFonts } from '../src/core/fonts.js';
import { hasTools } from './helpers.js';

it('parseVersion estrae la versione', () => {
  expect(parseVersion('pandoc 3.10.2\nFeatures: +server')).toBe('3.10.2');
  expect(parseVersion('typst 0.15.1 (unknown commit)')).toBe('0.15.1');
  expect(parseVersion('nessuna')).toBeNull();
});

it('compareVersions confronta numericamente', () => {
  expect(compareVersions('3.10.2', '3.1')).toBeGreaterThan(0);
  expect(compareVersions('0.11.0', '0.12')).toBeLessThan(0);
  expect(compareVersions('0.12', '0.12.0')).toBe(0);
});

it('formatDep descrive lo stato', () => {
  expect(formatDep({ name: 'typst', found: false, version: null, min: '0.12', ok: false })).toBe('typst (non trovato)');
  expect(formatDep({ name: 'typst', found: true, version: '0.11.0', min: '0.12', ok: false })).toBe(
    'typst 0.11.0 (richiesta ≥ 0.12)',
  );
});

it.runIf(hasTools)('checkDeps trova pandoc e typst', async () => {
  const statuses = await checkDeps(true);
  expect(statuses.map((s) => s.name)).toEqual(['pandoc', 'typst']);
  expect(statuses.every((s) => s.ok)).toBe(true);
});

it.runIf(hasTools)('listFonts restituisce un elenco ordinato senza doppioni', async () => {
  const fonts = await listFonts();
  expect(fonts.length).toBeGreaterThan(0);
  expect(new Set(fonts).size).toBe(fonts.length);
  expect([...fonts].sort((a, b) => a.localeCompare(b))).toEqual(fonts);
});
