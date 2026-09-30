import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, startServer } from '../src/server/app.js';
import { Catalog } from '../src/core/catalog.js';
import { readConfig, writeConfig } from '../src/core/config.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { t } from '../src/i18n/index.js';
import { hasTools, makePng, tempDir } from './helpers.js';

let app: FastifyInstance;
const H = { 'x-mdpress': '1' };

const savedHome = process.env.MDPRESS_HOME;

beforeEach(async () => {
  process.env.MDPRESS_HOME = await tempDir();
  const catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 'templates') });
  app = await buildServer({ catalog, language: 'en' });
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.MDPRESS_HOME;
  else process.env.MDPRESS_HOME = savedHome;
});

describe('protections', () => {
  it('rejects foreign Hosts', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/templates', headers: { host: 'evil.example:4321' } });
    expect(r.statusCode).toBe(403);
  });
  it('rejects non-GET requests without x-mdpress', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/templates', payload: { slug: 'a', name: 'A' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('protections (regressions)', () => {
  it('percent-encoded URL does not bypass the Host check', async () => {
    const r = await app.inject({ method: 'GET', url: '/%61pi/templates', headers: { host: 'evil.example' } });
    expect(r.statusCode).toBe(403);
  });
  it('percent-encoded POST requires x-mdpress', async () => {
    const r = await app.inject({ method: 'POST', url: '/%61pi/templates', headers: { host: 'localhost' }, payload: { slug: 'a', name: 'A' } });
    expect(r.statusCode).toBe(403);
  });
  it('non-API paths with a foreign Host → 403', async () => {
    const r = await app.inject({ method: 'GET', url: '/', headers: { host: 'evil.example' } });
    expect(r.statusCode).toBe(403);
  });
  it('logo and import over the limit → 413', async () => {
    const logo = await app.inject({ method: 'PUT', url: '/api/templates/standard/logo', headers: { ...H, 'content-type': 'image/png' }, payload: Buffer.alloc(2 * 1024 * 1024 + 10) });
    expect(logo.statusCode).toBe(413);
    const imp = await app.inject({ method: 'POST', url: '/api/templates/import', headers: { ...H, 'content-type': 'application/zip' }, payload: Buffer.alloc(5 * 1024 * 1024 + 10) });
    expect(imp.statusCode).toBe(413);
  });
  it('startServer with port 0 returns the real port', async () => {
    const catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 'templates') });
    const s = await startServer({ port: 0, open: false, catalog });
    expect(Number(new URL(s.url).port)).toBeGreaterThan(0);
    await s.close();
  });
});

describe('templates', () => {
  it('lists the built-ins', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/templates' })).json();
    expect(list.find((x: { slug: string }) => x.slug === 'standard')).toMatchObject({ builtin: true, hasLogo: false });
  });

  it('creates, updates, rejects invalid data and deletes', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { slug: 'fresh', name: 'Fresh' } });
    expect(created.statusCode).toBe(201);
    const tpl = created.json();

    const bad = await app.inject({ method: 'PUT', url: `/api/templates/${tpl.id}`, headers: H, payload: { ...tpl, colors: { ...tpl.colors, accent: 'blue' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0].path).toBe('colors.accent');

    const ok = await app.inject({ method: 'PUT', url: `/api/templates/${tpl.id}`, headers: H, payload: { ...tpl, name: 'Renamed' } });
    expect(ok.json().name).toBe('Renamed');

    expect((await app.inject({ method: 'DELETE', url: `/api/templates/${tpl.id}`, headers: H })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/templates/${tpl.id}` })).statusCode).toBe(404);
  });

  it('duplicate slug → 409, built-in → 403', async () => {
    const dup = await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { slug: 'standard', name: 'X' } });
    expect(dup.statusCode).toBe(409);
    const std = (await app.inject({ method: 'GET', url: '/api/templates/standard' })).json();
    expect((await app.inject({ method: 'PUT', url: '/api/templates/standard', headers: H, payload: std })).statusCode).toBe(403);
  });

  it('duplicates with from', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { from: 'standard', slug: 'my-copy', name: 'My copy' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ slug: 'my-copy', builtin: false });
  });

  it('logo: PNG upload, read and rejection of invalid data', async () => {
    await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { slug: 'l', name: 'L' } });
    const up = await app.inject({ method: 'PUT', url: '/api/templates/l/logo', headers: { ...H, 'content-type': 'image/png' }, payload: makePng(8, 8) });
    expect(up.json()).toMatchObject({ hasLogo: true, logo: { file: 'logo.png' } });
    const img = await app.inject({ method: 'GET', url: '/api/templates/l/logo' });
    expect(img.headers['content-type']).toBe('image/png');
    const bad = await app.inject({ method: 'PUT', url: '/api/templates/l/logo', headers: { ...H, 'content-type': 'image/png' }, payload: Buffer.from('no') });
    expect(bad.statusCode).toBe(400);
  });

  it('export → import', async () => {
    const zip = await app.inject({ method: 'GET', url: '/api/templates/standard/export' });
    expect(zip.headers['content-disposition']).toContain('standard.zip');
    const imp = await app.inject({ method: 'POST', url: '/api/templates/import', headers: { ...H, 'content-type': 'application/zip' }, payload: zip.rawPayload });
    expect(imp.statusCode).toBe(201);
    expect(imp.json().slug).toBe('standard-2');
  });

  it('render without markdown → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/render', headers: H, payload: { markdown: '  ' } });
    expect(r.statusCode).toBe(400);
  });
});

describe.runIf(hasTools)('rendering via API', () => {
  it('preview returns a PDF', async () => {
    const std = (await app.inject({ method: 'GET', url: '/api/templates/standard' })).json();
    const r = await app.inject({ method: 'POST', url: '/api/preview', headers: H, payload: { template: { ...std, colors: { ...std.colors, accent: '#ff0000' } }, ref: std.id } });
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders DOCX with file name and warnings', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/render',
      headers: H,
      payload: { markdown: '# Hello\n\n![missing](x.png)\n', filename: 'Report ü.md', format: 'docx' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''Report%20%C3%BC.docx");
    expect(JSON.parse(decodeURIComponent(String(r.headers['x-mdpress-warnings']))).length).toBeGreaterThan(0);
  });

  it('PNG thumbnail and fonts', async () => {
    const png = await app.inject({ method: 'GET', url: '/api/templates/standard/thumbnail.png' });
    expect(png.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect((await app.inject({ method: 'GET', url: '/api/fonts' })).json().length).toBeGreaterThan(0);
  });
});

describe('language', () => {
  it('localizes error bodies with x-mdpress-lang', async () => {
    const en = await app.inject({ method: 'GET', url: '/api/templates/nope' });
    expect(en.json()).toMatchObject({ key: 'errors.templateNotFound', error: t('errors.templateNotFound', { ref: 'nope' }, 'en') });
    const it = await app.inject({ method: 'GET', url: '/api/templates/nope', headers: { 'x-mdpress-lang': 'it' } });
    expect(it.json().error).toBe(t('errors.templateNotFound', { ref: 'nope' }, 'it'));
  });

  it('localizes field issues', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { slug: 'x', name: 'X' } })).json();
    const r = await app.inject({
      method: 'PUT',
      url: `/api/templates/${created.id}`,
      headers: { ...H, 'x-mdpress-lang': 'it' },
      payload: { ...created, fonts: { ...created.fonts, size: 40 } },
    });
    expect(r.json().errors[0]).toMatchObject({ path: 'fonts.size', key: 'validation.tooBig', message: t('validation.tooBig', { max: 16 }, 'it') });
  });

  it('ignores an unsupported x-mdpress-lang', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/templates/nope', headers: { 'x-mdpress-lang': 'fr' } });
    expect(r.json().error).toBe(t('errors.templateNotFound', { ref: 'nope' }, 'en'));
  });

  it('localizes host and header rejections', async () => {
    const host = await app.inject({ method: 'GET', url: '/api/templates', headers: { host: 'evil.example', 'x-mdpress-lang': 'it' } });
    expect(host.json().error).toBe(t('errors.hostNotAllowed', {}, 'it'));
    const header = await app.inject({ method: 'POST', url: '/api/templates', headers: { 'x-mdpress-lang': 'it' }, payload: {} });
    expect(header.json().error).toBe(t('errors.headerMissing', {}, 'it'));
  });

  it('GET/PUT /api/settings reads and persists the language', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual({ language: 'en' });
    const put = await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { language: 'it' } });
    expect(put.json()).toEqual({ language: 'it' });
    expect((await readConfig()).language).toBe('it');
    expect((await app.inject({ method: 'GET', url: '/api/templates/nope' })).json().error).toBe(t('errors.templateNotFound', { ref: 'nope' }, 'it'));
    const bad = await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { language: 'fr' } });
    expect(bad.statusCode).toBe(400);
  });

  it('PUT /api/settings preserves other config keys', async () => {
    await writeConfig({ defaultTemplate: 'standard' });
    const put = await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { language: 'it' } });
    expect(put.statusCode).toBe(200);
    expect(await readConfig()).toMatchObject({ defaultTemplate: 'standard', language: 'it' });
  });

  it('PUT /api/settings without a language reports it is missing', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe(t('errors.languageMissing', { supported: 'en, it' }, 'en'));
  });

  it('PUT /api/settings requires x-mdpress', async () => {
    const r = await app.inject({ method: 'PUT', url: '/api/settings', payload: { language: 'it' } });
    expect(r.statusCode).toBe(403);
  });
});
