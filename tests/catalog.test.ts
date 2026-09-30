import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { LOGO_FILE_RE } from '../src/core/theme.js';
import { makePng, tempDir } from './helpers.js';

let userDir: string;
let catalog: Catalog;

beforeEach(async () => {
  userDir = join(await tempDir(), 'templates');
  catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir });
});

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe('Catalog', () => {
  it('elenca i built-in anche senza cartella utente', async () => {
    const list = await catalog.list();
    expect(list.find((e) => e.template.slug === 'standard')?.builtin).toBe(true);
  });

  it('crea un template con id generato e lo risolve per id e slug', async () => {
    const e = await catalog.create({ slug: 'mio', name: 'Mio' });
    expect(e.template.id).toMatch(/^[a-z0-9]{8}$/);
    expect(e.dir).toBe(join(userDir, 'mio'));
    expect(e.builtin).toBe(false);
    expect((await catalog.resolve('mio')).template.id).toBe(e.template.id);
    expect((await catalog.resolve(e.template.id)).template.slug).toBe('mio');
  });

  it('rifiuta slug già usati, anche dai built-in', async () => {
    expect(await code(catalog.create({ slug: 'standard', name: 'X' }))).toBe('SLUG_TAKEN');
  });

  it('non modifica né elimina i built-in', async () => {
    expect(await code(catalog.update('standard', { slug: 'standard', name: 'X' }))).toBe('TEMPLATE_READONLY');
    expect(await code(catalog.remove('standard'))).toBe('TEMPLATE_READONLY');
    expect(await code(catalog.setLogo('standard', makePng(2, 2), 'png'))).toBe('TEMPLATE_READONLY');
  });

  it("rinomina la cartella quando cambia lo slug, mantenendo l'id", async () => {
    const e = await catalog.create({ slug: 'vecchio', name: 'V' });
    const u = await catalog.update(e.template.id, { ...e.template, slug: 'nuovo' });
    expect(u.template.id).toBe(e.template.id);
    expect(existsSync(join(userDir, 'vecchio'))).toBe(false);
    expect(existsSync(join(userDir, 'nuovo', 'template.json'))).toBe(true);
  });

  it('update valida il contenuto', async () => {
    const e = await catalog.create({ slug: 'a', name: 'A' });
    const bad = { ...e.template, colors: { ...e.template.colors, text: 'nero' } };
    expect(await code(catalog.update('a', bad))).toBe('TEMPLATE_INVALID');
  });

  it('duplica un built-in in un template utente', async () => {
    const d = await catalog.duplicate('standard', 'copia');
    expect(d.builtin).toBe(false);
    expect(d.template.name).toBe('Standard (copia)');
    expect(d.template.id).not.toBe('mdpstd01');
  });

  it('elimina un template utente', async () => {
    await catalog.create({ slug: 'via', name: 'Via' });
    await catalog.remove('via');
    expect(await code(catalog.resolve('via'))).toBe('TEMPLATE_NOT_FOUND');
  });

  it('salva il logo e sostituisce quello precedente', async () => {
    await catalog.create({ slug: 'logo', name: 'L' });
    const png = await catalog.setLogo('logo', makePng(40, 20), 'png');
    expect(png.template.logo.file).toBe('logo.png');
    expect(png.logoPath).toBe(join(userDir, 'logo', 'logo.png'));
    const jpg = await catalog.setLogo('logo', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'jpeg');
    expect(jpg.template.logo.file).toBe('logo.jpg');
    expect(await readdir(jpg.dir)).not.toContain('logo.png');
  });

  it('rifiuta un logo che non è PNG o JPG', async () => {
    await catalog.create({ slug: 'x', name: 'X' });
    expect(await code(catalog.setLogo('x', Buffer.from('ciao'), 'png'))).toBe('BAD_INPUT');
    expect(await code(catalog.setLogo('x', makePng(2, 2), 'svg'))).toBe('BAD_INPUT');
  });

  it('ignora template utente corrotti', async () => {
    await mkdir(join(userDir, 'rotto'), { recursive: true });
    await writeFile(join(userDir, 'rotto', 'template.json'), '{ non json');
    expect((await catalog.list()).some((e) => e.dir.endsWith('rotto'))).toBe(false);
  });

  it('non usa il riferimento come percorso', async () => {
    expect(await code(catalog.resolve('../../etc'))).toBe('TEMPLATE_NOT_FOUND');
  });

  it('rifiuta un logo che supera 2 MB', async () => {
    await catalog.create({ slug: 'x', name: 'X' });
    const tooLarge = Buffer.concat([makePng(2, 2), Buffer.alloc(2 * 1024 * 1024 + 1)]);
    expect(await code(catalog.setLogo('x', tooLarge, 'png'))).toBe('BAD_INPUT');
  });

  it('scrive il nuovo logo prima di eliminare il vecchio', async () => {
    await catalog.create({ slug: 'logo2', name: 'L2' });
    const png = await catalog.setLogo('logo2', makePng(40, 20), 'png');
    expect((await readdir(png.dir)).filter((f) => LOGO_FILE_RE.test(f))).toContain('logo.png');
    const jpg = await catalog.setLogo('logo2', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'jpeg');
    expect(jpg.template.logo.file).toBe('logo.jpg');
    expect((await readdir(jpg.dir)).filter((f) => LOGO_FILE_RE.test(f))).toEqual(['logo.jpg']);
  });

  it('aggiorna il template nella cartella corretta se la si è rinominata manualmente', async () => {
    const e = await catalog.create({ slug: 'orig', name: 'Orig' });
    const renamed = join(userDir, 'cartella-diversa');
    await mkdir(renamed, { recursive: true });
    await rm(join(userDir, 'orig'), { recursive: true });
    await writeFile(join(renamed, 'template.json'), JSON.stringify(e.template, null, 2) + '\n');

    // Update without slug change should write to cartella-diversa, not create 'orig'
    const updated = await catalog.update(e.template.id, { ...e.template, name: 'Updated' });
    expect(updated.dir).toBe(renamed);
    expect(updated.template.name).toBe('Updated');
    expect(existsSync(join(userDir, 'orig'))).toBe(false);
    expect(existsSync(join(renamed, 'template.json'))).toBe(true);
  });

  it('rifiuta di rinominare verso una cartella non-template esistente', async () => {
    await catalog.create({ slug: 'usr', name: 'U' });
    await mkdir(join(userDir, 'occupato'), { recursive: true });
    await writeFile(join(userDir, 'occupato', 'dummy'), 'content');
    expect(await code(catalog.update('usr', { slug: 'occupato', name: 'U' }))).toBe('SLUG_TAKEN');
  });

  it('rifiuta di rinominare verso lo slug di un altro template utente', async () => {
    const a = await catalog.create({ slug: 'a', name: 'A' });
    await catalog.create({ slug: 'b', name: 'B' });
    expect(await code(catalog.update('a', { ...a.template, slug: 'b' }))).toBe('SLUG_TAKEN');
  });

  it('copia il logo quando duplica un template utente', async () => {
    const orig = await catalog.create({ slug: 'withlogo', name: 'WL' });
    const withLogo = await catalog.setLogo('withlogo', makePng(20, 20), 'png');
    expect(withLogo.logoPath).not.toBeNull();

    const dupe = await catalog.duplicate('withlogo', 'copialogo');
    expect(dupe.logoPath).not.toBeNull();
    expect(existsSync(dupe.logoPath!)).toBe(true);
    expect(await readdir(dupe.dir)).toContain('logo.png');
  });
});
