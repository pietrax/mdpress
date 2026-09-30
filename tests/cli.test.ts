import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../src/cli/program.js';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { hasTools, tempDir } from './helpers.js';

let home: string;
let catalog: Catalog;
const saved = process.env.MDPRESS_HOME;

beforeEach(async () => {
  home = await tempDir();
  process.env.MDPRESS_HOME = home;
  catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(home, 'templates') });
});
afterEach(() => {
  if (saved === undefined) delete process.env.MDPRESS_HOME;
  else process.env.MDPRESS_HOME = saved;
});

async function cli(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(['node', 'mdpress', ...args], { out: (s) => out.push(s), err: (s) => err.push(s) }, catalog);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('mdpress templates', () => {
  it('list mostra i built-in e segna il default con *', async () => {
    const r = await cli('templates', 'list');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\* mdpstd01\s+standard/);
  });

  it('new, show, default e delete', async () => {
    expect((await cli('templates', 'new', 'mio', '--name', 'Il mio')).code).toBe(0);
    expect(JSON.parse((await cli('templates', 'show', 'mio')).out).name).toBe('Il mio');
    expect((await cli('templates', 'default', 'mio')).code).toBe(0);
    expect((await cli('templates', 'list')).out).toMatch(/\* [a-z0-9]{8}\s+mio/);
    const del = await cli('templates', 'delete', 'mio');
    expect(del.code).toBe(0);
    expect(del.out).toContain('tornato a standard');
    expect((await cli('templates', 'show', 'mio')).code).toBe(1);
    expect((await cli('templates', 'default')).out).toBe('standard');
    expect(JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))).toEqual({});
  });

  it('new --from duplica', async () => {
    const r = await cli('templates', 'new', 'copia', '--from', 'standard');
    expect(r.code).toBe(0);
    expect(JSON.parse((await cli('templates', 'show', 'copia')).out).name).toBe('Standard (copia)');
  });

  it('export e import', async () => {
    const zip = join(home, 'std.zip');
    expect((await cli('templates', 'export', 'standard', '-o', zip)).code).toBe(0);
    expect(existsSync(zip)).toBe(true);
    const r = await cli('templates', 'import', zip);
    expect(r.code).toBe(0);
    expect(r.out).toContain('standard-2');
  });

  it('delete di un built-in fallisce con messaggio', async () => {
    const r = await cli('templates', 'delete', 'standard');
    expect(r.code).toBe(1);
    expect(r.err).toContain('built-in');
  });
});

describe('mdpress render', () => {
  it('errori d’uso: template sconosciuto, formato e file', async () => {
    await writeFile(join(home, 'd.md'), '# x\n');
    expect((await cli('render', join(home, 'd.md'), '-t', 'boh')).err).toContain('non trovato');
    expect((await cli('render', join(home, 'd.md'), '-f', 'odt')).err).toContain('Formato non supportato');
    const missing = await cli('render', join(home, 'nessuno.md'));
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('File non trovato');
  });

  it.runIf(hasTools)('produce PDF e DOCX', async () => {
    await writeFile(join(home, 'doc.md'), '---\ntitle: Prova\n---\n\n# Ciao\n');
    const r = await cli('render', join(home, 'doc.md'), '-f', 'pdf,docx', '--toc');
    expect(r.code).toBe(0);
    expect(r.out).toContain(join(home, 'doc.pdf'));
    expect(existsSync(join(home, 'doc.docx'))).toBe(true);
  });
});

describe('mdpress generale', () => {
  it('--version stampa la versione', async () => {
    const r = await cli('--version');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('comando sconosciuto → codice 1', async () => {
    expect((await cli('boh')).code).toBe(1);
  });
  it.runIf(hasTools)('doctor → codice 0', async () => {
    const r = await cli('doctor');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ pandoc/);
  });
});
