import { beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, startServer } from '../src/server/app.js';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { hasTools, makePng, tempDir } from './helpers.js';

let app: FastifyInstance;
const H = { 'x-mdpress': '1' };

beforeEach(async () => {
  const catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 'templates') });
  app = await buildServer({ catalog });
});

describe('protezioni', () => {
  it('rifiuta Host estranei', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/templates', headers: { host: 'evil.example:4321' } });
    expect(r.statusCode).toBe(403);
  });
  it('rifiuta richieste non-GET senza x-mdpress', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/templates', payload: { slug: 'a', name: 'A' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('protezioni (regressioni)', () => {
  it('URL con percent-encoding non aggira il controllo Host', async () => {
    const r = await app.inject({ method: 'GET', url: '/%61pi/templates', headers: { host: 'evil.example' } });
    expect(r.statusCode).toBe(403);
  });
  it('POST con percent-encoding richiede x-mdpress', async () => {
    const r = await app.inject({ method: 'POST', url: '/%61pi/templates', headers: { host: 'localhost' }, payload: { slug: 'a', name: 'A' } });
    expect(r.statusCode).toBe(403);
  });
  it('percorsi non-API con Host estraneo → 403', async () => {
    const r = await app.inject({ method: 'GET', url: '/', headers: { host: 'evil.example' } });
    expect(r.statusCode).toBe(403);
  });
  it('logo e import oltre il limite → 413', async () => {
    const logo = await app.inject({ method: 'PUT', url: '/api/templates/standard/logo', headers: { ...H, 'content-type': 'image/png' }, payload: Buffer.alloc(2 * 1024 * 1024 + 10) });
    expect(logo.statusCode).toBe(413);
    const imp = await app.inject({ method: 'POST', url: '/api/templates/import', headers: { ...H, 'content-type': 'application/zip' }, payload: Buffer.alloc(5 * 1024 * 1024 + 10) });
    expect(imp.statusCode).toBe(413);
  });
  it('startServer con porta 0 restituisce la porta reale', async () => {
    const catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(await tempDir(), 'templates') });
    const s = await startServer({ port: 0, open: false, catalog });
    expect(Number(new URL(s.url).port)).toBeGreaterThan(0);
    await s.close();
  });
});

describe('template', () => {
  it('elenca i built-in', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/templates' })).json();
    expect(list.find((t: { slug: string }) => t.slug === 'standard')).toMatchObject({ builtin: true, hasLogo: false });
  });

  it('crea, aggiorna, rifiuta dati non validi ed elimina', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { slug: 'nuovo', name: 'Nuovo' } });
    expect(created.statusCode).toBe(201);
    const t = created.json();

    const bad = await app.inject({ method: 'PUT', url: `/api/templates/${t.id}`, headers: H, payload: { ...t, colors: { ...t.colors, accent: 'blu' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors[0].path).toBe('colors.accent');

    const ok = await app.inject({ method: 'PUT', url: `/api/templates/${t.id}`, headers: H, payload: { ...t, name: 'Rinominato' } });
    expect(ok.json().name).toBe('Rinominato');

    expect((await app.inject({ method: 'DELETE', url: `/api/templates/${t.id}`, headers: H })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/templates/${t.id}` })).statusCode).toBe(404);
  });

  it('slug duplicato → 409, built-in → 403', async () => {
    const dup = await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { slug: 'standard', name: 'X' } });
    expect(dup.statusCode).toBe(409);
    const std = (await app.inject({ method: 'GET', url: '/api/templates/standard' })).json();
    expect((await app.inject({ method: 'PUT', url: '/api/templates/standard', headers: H, payload: std })).statusCode).toBe(403);
  });

  it('duplica con from', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/templates', headers: H, payload: { from: 'standard', slug: 'mia-copia', name: 'Mia copia' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ slug: 'mia-copia', builtin: false });
  });

  it('logo: upload PNG, lettura e rifiuto di dati non validi', async () => {
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

  it('render senza markdown → 400', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/render', headers: H, payload: { markdown: '  ' } });
    expect(r.statusCode).toBe(400);
  });
});

describe.runIf(hasTools)('rendering via API', () => {
  it('preview restituisce un PDF', async () => {
    const std = (await app.inject({ method: 'GET', url: '/api/templates/standard' })).json();
    const r = await app.inject({ method: 'POST', url: '/api/preview', headers: H, payload: { template: { ...std, colors: { ...std.colors, accent: '#ff0000' } }, ref: std.id } });
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('render DOCX con nome file e warning', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/render',
      headers: H,
      payload: { markdown: '# Ciao\n\n![manca](x.png)\n', filename: 'Relazione è.md', format: 'docx' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''Relazione%20%C3%A8.docx");
    expect(JSON.parse(decodeURIComponent(String(r.headers['x-mdpress-warnings']))).length).toBeGreaterThan(0);
  });

  it('miniatura PNG e fonts', async () => {
    const png = await app.inject({ method: 'GET', url: '/api/templates/standard/thumbnail.png' });
    expect(png.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect((await app.inject({ method: 'GET', url: '/api/fonts' })).json().length).toBeGreaterThan(0);
  });
});
