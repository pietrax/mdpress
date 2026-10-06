import { beforeEach, expect, it } from 'vitest';
import { join } from 'node:path';
import JSZip from 'jszip';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { makePng, svgLinking, tempDir } from './helpers.js';

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

it('export then import in the same catalog creates a copy with a new id and slug', async () => {
  await catalog.create({ slug: 'loop', name: 'Loop' });
  const orig = await catalog.setLogo('loop', makePng(10, 10), 'png');
  const imported = await catalog.importZip(await catalog.exportZip('loop'));
  expect(imported.template.slug).toBe('loop-2');
  expect(imported.template.id).not.toBe(orig.template.id);
  expect(imported.template.name).toBe('Loop');
  expect(imported.logoPath).not.toBeNull();
});

it('in an empty catalog keeps the id and slug', async () => {
  const other = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 't') });
  const e = await catalog.create({ slug: 'gate', name: 'Gate' });
  const imported = await other.importZip(await catalog.exportZip('gate'));
  expect(imported.template.id).toBe(e.template.id);
  expect(imported.template.slug).toBe('gate');
});

it('accepts template.json in a subfolder', async () => {
  const zip = new JSZip();
  zip.file('folder/template.json', JSON.stringify({ slug: 'nested', name: 'Nested' }));
  const imported = await catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(imported.template.slug).toBe('nested');
});

it('a logo referenced but missing from the zip is cleared', async () => {
  const zip = new JSZip();
  zip.file('template.json', JSON.stringify({ slug: 'nologo', name: 'No logo', logo: { file: 'logo.png' } }));
  const imported = await catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(imported.template.logo.file).toBeNull();
});

it('rejects a logo that is not an image or an SVG that refers to other files', async () => {
  for (const [file, data] of [['logo.svg', svgLinking('../../secret.png')], ['logo.png', Buffer.from('text')]] as const) {
    const zip = new JSZip();
    zip.file('template.json', JSON.stringify({ slug: 'evil', name: 'Evil', logo: { file } }));
    zip.file(file, data);
    expect(await code(catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' })))).toBe('BAD_INPUT');
  }
});

it('rejects non-zip files, zips without template.json and broken JSON', async () => {
  expect(await code(catalog.importZip(Buffer.from('text')))).toBe('BAD_INPUT');
  const empty = new JSZip();
  empty.file('other.txt', 'x');
  expect(await code(catalog.importZip(await empty.generateAsync({ type: 'nodebuffer' })))).toBe('BAD_INPUT');
  const broken = new JSZip();
  broken.file('template.json', '{ broken');
  expect(await code(catalog.importZip(await broken.generateAsync({ type: 'nodebuffer' })))).toBe('BAD_INPUT');
});

it('importing an exported built-in creates a user template', async () => {
  const imported = await catalog.importZip(await catalog.exportZip('standard'));
  expect(imported.builtin).toBe(false);
  expect(imported.template.slug).toBe('standard-2');
  expect(imported.template.id).not.toBe('mdpstd01');
});

it('rejects a logo larger than 2 MB', async () => {
  const zip = new JSZip();
  const largeLogo = Buffer.alloc(2 * 1024 * 1024 + 1);
  zip.file('template.json', JSON.stringify({ slug: 'large', name: 'Large', logo: { file: 'logo.png' } }));
  zip.file('logo.png', largeLogo);
  expect(await code(catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' })))).toBe('BAD_INPUT');
});

it('avoids stray non-template folders named like the slug', async () => {
  // Create an existing non-template folder with slug 'test'
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(catalog.opts.userDir, 'test'), { recursive: true });

  // Import a template with slug 'test' should assign a different slug
  const zip = new JSZip();
  zip.file('template.json', JSON.stringify({ slug: 'test', name: 'Test' }));
  const imported = await catalog.importZip(await zip.generateAsync({ type: 'nodebuffer' }));
  expect(imported.template.slug).toBe('test-2');
});
