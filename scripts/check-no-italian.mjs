#!/usr/bin/env node
// Fails when Italian words appear in the software. Italian belongs only in src/i18n/locales/it.json.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_PATHS = [
  'src', 'web/src', 'web/index.html', 'tests', 'assets', 'scripts', 'templates',
  'packaging', '.github', 'README.md', 'package.json', 'bin', 'vite.config.ts', 'vitest.config.ts',
  'tsconfig.json', 'tsconfig.build.json', 'web/tsconfig.json',
];
const EXCLUDED = new Set(['src/i18n/locales/it.json', 'scripts/check-no-italian.mjs']);
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git']);
const TEXT_EXT = /\.(ts|tsx|js|mjs|json|lua|md|html|css|sh|yml|yaml|rb|template|typ)$/;

// Common Italian words that are not English words. Accented letters are checked separately.
const WORDS = [
  'della', 'delle', 'degli', 'dello', 'questo', 'questa', 'sono', 'essere', 'errore', 'pagina',
  'pagine', 'copertina', 'indice', 'carica', 'scarica', 'salva', 'salvato', 'nessun', 'nessuna',
  'trovato', 'trovata', 'mancante', 'mancanti', 'inserisci', 'deve', 'devono', 'anche', 'oppure',
  'quando', 'cartella', 'modifica', 'elimina', 'eliminato', 'duplica', 'crea', 'creato', 'testo',
  'titolo', 'sottotitolo', 'autore', 'testata', 'scegli', 'utente', 'uscire', 'lingua', 'anteprima',
  'documento', 'immagine', 'esempio', 'relazione', 'aggiorna', 'impagina', 'nome', 'valido', 'valida',
  'dati', 'tutti', 'tutte', 'ogni', 'quindi', 'perché', 'già', 'può', 'più', 'piè', 'così',
];
const WORD_RE = new RegExp(`(?<![\\p{L}])(${WORDS.join('|')})(?![\\p{L}])`, 'giu');
const ACCENT_RE = /[\p{L}]*[àèéìòù][\p{L}]*/giu;

function* files(path) {
  const abs = join(ROOT, path);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    for (const name of readdirSync(abs)) if (!SKIPPED_DIRS.has(name)) yield* files(join(path, name));
  } else if (TEXT_EXT.test(path)) {
    yield path;
  }
}

const explicit = process.argv.slice(2);
const targets = explicit.length > 0 ? explicit : DEFAULT_PATHS;
const hits = [];
for (const target of targets) {
  if (explicit.length > 0 && !existsSync(resolve(ROOT, target))) {
    console.error(`Path not found: ${target}`);
    process.exit(1);
  }
  for (const file of files(relative(ROOT, resolve(ROOT, target)))) {
    if (EXCLUDED.has(file)) continue;
    readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(WORD_RE)) hits.push(`${file}:${i + 1}: ${m[0]}`);
      for (const m of line.matchAll(ACCENT_RE)) hits.push(`${file}:${i + 1}: ${m[0]}`);
    });
  }
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error(`\n${hits.length} Italian word(s) found outside src/i18n/locales/it.json`);
  process.exit(1);
}
console.log('No Italian words found.');
