import { beforeEach, expect, it } from 'vitest';
import { join } from 'node:path';
import JSZip from 'jszip';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { makePng, tempDir } from './helpers.js';

let catalog: Catalog;
beforeEach(async () => {
  catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 'templates') });
});

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

it('export → import nello stesso catalogo crea una copia con nuovo id e slug', async () => {
  await catalog.create({ slug: 'giro', name: 'Giro' });
  const orig = await catalog.setLogo('giro', makePng(10, 10), 'png');
  const imported = await catalog.importZip(await catalog.exportZip('giro'));
  expect(imported.template.slug).toBe('giro-2');
  expect(imported.template.id).not.toBe(orig.template.id);
  expect(imported.template.name).toBe('Giro');
  expect(imported.logoPath).not.toBeNull();
});

it('in un catalogo vuoto mantiene id e slug', async () => {
  const other = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 't') });
  const e = await catalog.create({ slug: 'porta', name: 'Porta' });
  const imported = await other.importZip(await catalog.exportZip('porta'));
  expect(imported.template.id).toBe(e.template.id);
  expect(imported.template.slug).toBe('porta');
});

it('accetta template.json in una sottocartella', async () => {
  const zip = new JSZip();
  zip.file('cartella/template.json', JSON.stringify({ slug: 'sotto', name: 'Sotto' }));
  const imported = await catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(imported.template.slug).toBe('sotto');
});

it('un logo citato ma assente nello zip viene azzerato', async () => {
  const zip = new JSZip();
  zip.file('template.json', JSON.stringify({ slug: 'senza', name: 'Senza', logo: { file: 'logo.png' } }));
  const imported = await catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(imported.template.logo.file).toBeNull();
});

it('rifiuta file non zip, zip senza template.json e JSON rotto', async () => {
  expect(await code(catalog.importZip(Buffer.from('ciao')))).toBe('BAD_INPUT');
  const empty = new JSZip();
  empty.file('altro.txt', 'x');
  expect(await code(catalog.importZip(await empty.generateAsync({ type: 'nodebuffer' })))).toBe('BAD_INPUT');
  const broken = new JSZip();
  broken.file('template.json', '{ rotto');
  expect(await code(catalog.importZip(await broken.generateAsync({ type: 'nodebuffer' })))).toBe('BAD_INPUT');
});

it('importare un built-in esportato crea un template utente', async () => {
  const imported = await catalog.importZip(await catalog.exportZip('standard'));
  expect(imported.builtin).toBe(false);
  expect(imported.template.slug).toBe('standard-2');
  expect(imported.template.id).not.toBe('mdpstd01');
});

it('rifiuta un logo che supera i 2 MB', async () => {
  const zip = new JSZip();
  const largeLogo = Buffer.alloc(2 * 1024 * 1024 + 1);
  zip.file('template.json', JSON.stringify({ slug: 'large', name: 'Large', logo: { file: 'logo.png' } }));
  zip.file('logo.png', largeLogo);
  expect(await code(catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' })))).toBe('BAD_INPUT');
});

it('evita cartelle stray non-template con lo stesso nome dello slug', async () => {
  // Create an existing non-template folder with slug 'test'
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(catalog.opts.userDir, 'test'), { recursive: true });

  // Import a template with slug 'test' should assign a different slug
  const zip = new JSZip();
  zip.file('template.json', JSON.stringify({ slug: 'test', name: 'Test' }));
  const imported = await catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(imported.template.slug).toBe('test-2');
});
