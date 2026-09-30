import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../src/cli/program.js';
import { Catalog } from '../src/core/catalog.js';
import { writeConfig } from '../src/core/config.js';
import { t } from '../src/i18n/index.js';
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
  const code = await main(['node', 'mdpress', ...args], { out: (s) => out.push(s), err: (s) => err.push(s) }, catalog, { LANG: 'C' });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('mdpress templates', () => {
  it('list shows the built-ins and marks the default with *', async () => {
    const r = await cli('templates', 'list');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\* mdpstd01\s+standard/);
  });

  it('new, show, default and delete', async () => {
    expect((await cli('templates', 'new', 'mine', '--name', 'My own')).code).toBe(0);
    expect(JSON.parse((await cli('templates', 'show', 'mine')).out).name).toBe('My own');
    expect((await cli('templates', 'default', 'mine')).code).toBe(0);
    expect((await cli('templates', 'list')).out).toMatch(/\* [a-z0-9]{8}\s+mine/);
    const del = await cli('templates', 'delete', 'mine');
    expect(del.code).toBe(0);
    expect(del.out).toContain('back to standard');
    expect((await cli('templates', 'show', 'mine')).code).toBe(1);
    expect((await cli('templates', 'default')).out).toBe('standard');
    expect(JSON.parse(await readFile(join(home, 'config.json'), 'utf8'))).toEqual({});
  });

  it('new --from duplicates', async () => {
    const r = await cli('templates', 'new', 'copy', '--from', 'standard');
    expect(r.code).toBe(0);
    expect(JSON.parse((await cli('templates', 'show', 'copy')).out).name).toBe('Standard (copy)');
  });

  it('export and import', async () => {
    const zip = join(home, 'std.zip');
    expect((await cli('templates', 'export', 'standard', '-o', zip)).code).toBe(0);
    expect(existsSync(zip)).toBe(true);
    const r = await cli('templates', 'import', zip);
    expect(r.code).toBe(0);
    expect(r.out).toContain('standard-2');
  });

  it('deleting a built-in fails with a message', async () => {
    const r = await cli('templates', 'delete', 'standard');
    expect(r.code).toBe(1);
    expect(r.err).toContain('built-in');
  });
});

describe('mdpress render', () => {
  it('usage errors: unknown template, format and file', async () => {
    await writeFile(join(home, 'd.md'), '# x\n');
    expect((await cli('render', join(home, 'd.md'), '-t', 'unknown-template')).err).toContain('not found');
    expect((await cli('render', join(home, 'd.md'), '-f', 'odt')).err).toContain('Unsupported format');
    const missing = await cli('render', join(home, 'missing.md'));
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('File not found');
  });

  it.runIf(hasTools)('produces PDF and DOCX', async () => {
    await writeFile(join(home, 'doc.md'), '---\ntitle: Sample\n---\n\n# Hello\n');
    const r = await cli('render', join(home, 'doc.md'), '-f', 'pdf,docx', '--toc');
    expect(r.code).toBe(0);
    expect(r.out).toContain(join(home, 'doc.pdf'));
    expect(existsSync(join(home, 'doc.docx'))).toBe(true);
  });
});

describe('mdpress general', () => {
  it('--version prints the version', async () => {
    const r = await cli('--version');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('unknown command → code 1', async () => {
    expect((await cli('unknown-template')).code).toBe(1);
  });
  it.runIf(hasTools)('doctor → code 0', async () => {
    const r = await cli('doctor');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ pandoc/);
  });
});

describe('language', () => {
  const run = async (args: string[], env: Record<string, string>) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['node', 'mdpress', ...args], { out: (s) => out.push(s), err: (s) => err.push(s) }, catalog, env);
    return { code, out: out.join('\n'), err: err.join('\n') };
  };

  it('is English by default', async () => {
    const r = await run(['templates', 'show', 'nope'], { LANG: 'C' });
    expect(r.err).toContain(t('errors.templateNotFound', { ref: 'nope' }, 'en'));
  });

  it('--lang it switches to Italian, before or after the subcommand', async () => {
    const expected = t('errors.templateNotFound', { ref: 'nope' }, 'it');
    expect((await run(['--lang', 'it', 'templates', 'show', 'nope'], { LANG: 'C' })).err).toContain(expected);
    expect((await run(['templates', 'show', 'nope', '--lang=it'], { LANG: 'C' })).err).toContain(expected);
  });

  it('reads the language from config.json and from LANG', async () => {
    await writeConfig({ language: 'it' });
    expect((await run(['templates', 'show', 'nope'], { LANG: 'C' })).err).toContain(t('errors.templateNotFound', { ref: 'nope' }, 'it'));
    await writeConfig({});
    expect((await run(['templates', 'show', 'nope'], { LANG: 'it_IT.UTF-8' })).err).toContain(t('errors.templateNotFound', { ref: 'nope' }, 'it'));
  });

  it('rejects an unsupported --lang', async () => {
    const r = await run(['--lang', 'fr', 'templates', 'list'], { LANG: 'C' });
    expect(r.code).toBe(1);
    expect(r.err).toContain(t('errors.unsupportedLanguage', { lang: 'fr', supported: 'en, it' }, 'en'));
  });

  it('prints validation issues in the chosen language', async () => {
    const r = await run(['--lang', 'it', 'templates', 'new', 'Bad Slug'], { LANG: 'C' });
    expect(r.err).toContain(t('validation.slug', {}, 'it'));
  });
});
