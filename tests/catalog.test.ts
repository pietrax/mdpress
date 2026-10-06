import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { LOGO_FILE_RE } from '../src/core/theme.js';
import { makePng, SVG_LOGO, svgLinking, tempDir } from './helpers.js';

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
  it('lists built-ins even without a user folder', async () => {
    const list = await catalog.list();
    expect(list.find((e) => e.template.slug === 'standard')?.builtin).toBe(true);
  });

  it('creates a template with a generated id and resolves it by id and slug', async () => {
    const e = await catalog.create({ slug: 'mine', name: 'Mine' });
    expect(e.template.id).toMatch(/^[a-z0-9]{8}$/);
    expect(e.dir).toBe(join(userDir, 'mine'));
    expect(e.builtin).toBe(false);
    expect((await catalog.resolve('mine')).template.id).toBe(e.template.id);
    expect((await catalog.resolve(e.template.id)).template.slug).toBe('mine');
  });

  it('rejects slugs already in use, including built-in ones', async () => {
    expect(await code(catalog.create({ slug: 'standard', name: 'X' }))).toBe('SLUG_TAKEN');
  });

  it('does not overwrite a folder with an unreadable template.json (create and duplicate)', async () => {
    await mkdir(join(userDir, 'broken'), { recursive: true });
    const file = join(userDir, 'broken', 'template.json');
    await writeFile(file, '{ not valid');
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    expect(await code(catalog.create({ slug: 'broken', name: 'X' }))).toBe('SLUG_TAKEN');
    expect(await code(catalog.duplicate('standard', 'broken'))).toBe('SLUG_TAKEN');
    warn.mockRestore();
    expect(await readFile(file, 'utf8')).toBe('{ not valid');
  });

  it('neither edits nor deletes built-ins', async () => {
    expect(await code(catalog.update('standard', { slug: 'standard', name: 'X' }))).toBe('TEMPLATE_READONLY');
    expect(await code(catalog.remove('standard'))).toBe('TEMPLATE_READONLY');
    expect(await code(catalog.setLogo('standard', makePng(2, 2), 'png'))).toBe('TEMPLATE_READONLY');
  });

  it("renames the folder when the slug changes, keeping the id", async () => {
    const e = await catalog.create({ slug: 'old', name: 'V' });
    const u = await catalog.update(e.template.id, { ...e.template, slug: 'new' });
    expect(u.template.id).toBe(e.template.id);
    expect(existsSync(join(userDir, 'old'))).toBe(false);
    expect(existsSync(join(userDir, 'new', 'template.json'))).toBe(true);
  });

  it('update validates the content', async () => {
    const e = await catalog.create({ slug: 'a', name: 'A' });
    const bad = { ...e.template, colors: { ...e.template.colors, text: 'black' } };
    expect(await code(catalog.update('a', bad))).toBe('TEMPLATE_INVALID');
  });

  it('duplicates a built-in into a user template', async () => {
    const d = await catalog.duplicate('standard', 'clone');
    expect(d.builtin).toBe(false);
    expect(d.template.name).toBe('Standard (copy)');
    expect(d.template.id).not.toBe('mdpstd01');
  });

  it('deletes a user template', async () => {
    await catalog.create({ slug: 'gone', name: 'Gone' });
    await catalog.remove('gone');
    expect(await code(catalog.resolve('gone'))).toBe('TEMPLATE_NOT_FOUND');
  });

  it('saves the logo and replaces the previous one', async () => {
    await catalog.create({ slug: 'logo', name: 'L' });
    const png = await catalog.setLogo('logo', makePng(40, 20), 'png');
    expect(png.template.logo.file).toBe('logo.png');
    expect(png.logoPath).toBe(join(userDir, 'logo', 'logo.png'));
    const jpg = await catalog.setLogo('logo', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'jpeg');
    expect(jpg.template.logo.file).toBe('logo.jpg');
    expect(await readdir(jpg.dir)).not.toContain('logo.png');
    const svg = await catalog.setLogo('logo', SVG_LOGO, 'svg');
    expect(svg.template.logo.file).toBe('logo.svg');
    expect(await readdir(svg.dir)).not.toContain('logo.jpg');
  });

  it('rejects a logo that is not PNG, JPG or SVG', async () => {
    await catalog.create({ slug: 'x', name: 'X' });
    expect(await code(catalog.setLogo('x', Buffer.from('text'), 'png'))).toBe('BAD_INPUT');
    expect(await code(catalog.setLogo('x', makePng(2, 2), 'svg'))).toBe('BAD_INPUT');
    expect(await code(catalog.setLogo('x', Buffer.from('<html><body>no</body></html>'), 'svg'))).toBe('BAD_INPUT');
    expect(await code(catalog.setLogo('x', makePng(2, 2), 'gif'))).toBe('BAD_INPUT');
  });

  it('rejects an SVG logo that refers to other files, accepts internal and data: references', async () => {
    await catalog.create({ slug: 'v', name: 'V' });
    for (const ref of ['../secret.png', '/etc/hosts', 'file:///etc/hosts', 'https://example.com/x.png', '&x;', ' ../s.png']) {
      expect(await code(catalog.setLogo('v', svgLinking(ref), 'svg'))).toBe('BAD_INPUT');
    }
    const style = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><style>rect { fill: url(../p.svg#g) }</style><rect/></svg>');
    expect(await code(catalog.setLogo('v', style, 'svg'))).toBe('BAD_INPUT');
    const entity = Buffer.from('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "/etc/hosts">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>');
    expect(await code(catalog.setLogo('v', entity, 'svg'))).toBe('BAD_INPUT');
    expect(await code(catalog.setLogo('v', svgLinking('#shape'), 'svg'))).toBe('OK');
    expect(await code(catalog.setLogo('v', svgLinking('data:image/png;base64,iVBORw0KGgo='), 'svg'))).toBe('OK');
    const gradient = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill: url(#g)" fill="url( \'#g\' )"/></svg>');
    expect(await code(catalog.setLogo('v', gradient, 'svg'))).toBe('OK');
  });

  it('ignores corrupted user templates', async () => {
    await mkdir(join(userDir, 'broken'), { recursive: true });
    await writeFile(join(userDir, 'broken', 'template.json'), '{ not json');
    expect((await catalog.list()).some((e) => e.dir.endsWith('broken'))).toBe(false);
  });

  it('does not use the reference as a path', async () => {
    expect(await code(catalog.resolve('../../etc'))).toBe('TEMPLATE_NOT_FOUND');
  });

  it('rejects a logo larger than 2 MB', async () => {
    await catalog.create({ slug: 'x', name: 'X' });
    const tooLarge = Buffer.concat([makePng(2, 2), Buffer.alloc(2 * 1024 * 1024 + 1)]);
    expect(await code(catalog.setLogo('x', tooLarge, 'png'))).toBe('BAD_INPUT');
  });

  it('writes the new logo before deleting the old one', async () => {
    await catalog.create({ slug: 'logo2', name: 'L2' });
    const png = await catalog.setLogo('logo2', makePng(40, 20), 'png');
    expect((await readdir(png.dir)).filter((f) => LOGO_FILE_RE.test(f))).toContain('logo.png');
    const jpg = await catalog.setLogo('logo2', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), 'jpeg');
    expect(jpg.template.logo.file).toBe('logo.jpg');
    expect((await readdir(jpg.dir)).filter((f) => LOGO_FILE_RE.test(f))).toEqual(['logo.jpg']);
  });

  it('updates the template in the right folder if it was renamed by hand', async () => {
    const e = await catalog.create({ slug: 'orig', name: 'Orig' });
    const renamed = join(userDir, 'other-folder');
    await mkdir(renamed, { recursive: true });
    await rm(join(userDir, 'orig'), { recursive: true });
    await writeFile(join(renamed, 'template.json'), JSON.stringify(e.template, null, 2) + '\n');

    // Update without slug change should write to other-folder, not create 'orig'
    const updated = await catalog.update(e.template.id, { ...e.template, name: 'Updated' });
    expect(updated.dir).toBe(renamed);
    expect(updated.template.name).toBe('Updated');
    expect(existsSync(join(userDir, 'orig'))).toBe(false);
    expect(existsSync(join(renamed, 'template.json'))).toBe(true);
  });

  it('refuses to rename onto an existing non-template folder', async () => {
    await catalog.create({ slug: 'usr', name: 'U' });
    await mkdir(join(userDir, 'occupied'), { recursive: true });
    await writeFile(join(userDir, 'occupied', 'dummy'), 'content');
    expect(await code(catalog.update('usr', { slug: 'occupied', name: 'U' }))).toBe('SLUG_TAKEN');
  });

  it('refuses to rename onto the slug of another user template', async () => {
    const a = await catalog.create({ slug: 'a', name: 'A' });
    await catalog.create({ slug: 'b', name: 'B' });
    expect(await code(catalog.update('a', { ...a.template, slug: 'b' }))).toBe('SLUG_TAKEN');
  });

  it('copies the logo when duplicating a user template', async () => {
    const orig = await catalog.create({ slug: 'withlogo', name: 'WL' });
    const withLogo = await catalog.setLogo('withlogo', makePng(20, 20), 'png');
    expect(withLogo.logoPath).not.toBeNull();

    const dupe = await catalog.duplicate('withlogo', 'logoclone');
    expect(dupe.logoPath).not.toBeNull();
    expect(existsSync(dupe.logoPath!)).toBe(true);
    expect(await readdir(dupe.dir)).toContain('logo.png');
  });
});
