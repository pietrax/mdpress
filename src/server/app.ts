import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import open from 'open';
import { Catalog, type CatalogEntry } from '../core/catalog.js';
import { defaultTemplateRef } from '../core/config.js';
import { checkDeps } from '../core/deps.js';
import { MdpressError, type ErrorCode } from '../core/errors.js';
import { listFonts } from '../core/fonts.js';
import { webDistDir } from '../core/paths.js';
import { renderSample } from '../core/preview.js';
import { render } from '../core/render.js';
import { parseTemplate } from '../core/theme.js';

const STATUS: Record<ErrorCode, number> = {
  TEMPLATE_INVALID: 400,
  BAD_INPUT: 400,
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_READONLY: 403,
  SLUG_TAKEN: 409,
  DEPENDENCY_MISSING: 503,
  RENDER_FAILED: 500,
};

const ALLOWED_HOSTS = ['127.0.0.1', 'localhost'];

const summary = (e: CatalogEntry) => ({ ...e.template, builtin: e.builtin, hasLogo: Boolean(e.logoPath) });

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

interface RenderBody {
  markdown?: unknown;
  filename?: unknown;
  template?: unknown;
  format?: unknown;
  toc?: unknown;
  cover?: unknown;
}

export async function buildServer(opts: { catalog?: Catalog } = {}): Promise<FastifyInstance> {
  const catalog = opts.catalog ?? Catalog.default();
  const app = Fastify({ bodyLimit: 6 * 1024 * 1024 });
  const thumbnails = new Map<string, Buffer>();
  let fonts: Promise<string[]> | null = null;

  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'application/zip', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!ALLOWED_HOSTS.includes(host)) return reply.code(403).send({ error: 'Host non consentito' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-mdpress'] !== '1') {
      return reply.code(403).send({ error: 'Header x-mdpress mancante' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof MdpressError) {
      return reply.code(STATUS[err.code]).send({ error: err.message, code: err.code, errors: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: (err as Error).message });
  });

  app.get('/api/templates', async () => (await catalog.list()).map(summary));

  app.get<{ Params: { ref: string } }>('/api/templates/:ref', async (req) => summary(await catalog.resolve(req.params.ref)));

  app.post<{ Body: Record<string, unknown> | undefined }>('/api/templates', async (req, reply) => {
    const { from, ...rest } = req.body ?? {};
    const entry =
      typeof from === 'string'
        ? await catalog.duplicate(from, String(rest.slug ?? ''), typeof rest.name === 'string' ? rest.name : undefined)
        : await catalog.create(rest);
    return reply.code(201).send(summary(entry));
  });

  app.put<{ Params: { ref: string }; Body: Record<string, unknown> | undefined }>('/api/templates/:ref', async (req) =>
    summary(await catalog.update(req.params.ref, req.body ?? {})),
  );

  app.delete<{ Params: { ref: string } }>('/api/templates/:ref', async (req, reply) => {
    await catalog.remove(req.params.ref);
    return reply.code(204).send();
  });

  app.put<{ Params: { ref: string } }>('/api/templates/:ref/logo', { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const type = req.headers['content-type'] ?? '';
    const ext = type.startsWith('image/png') ? 'png' : type.startsWith('image/jpeg') ? 'jpg' : null;
    if (!ext || !Buffer.isBuffer(req.body)) throw new MdpressError('Carica un logo PNG o JPG', 'BAD_INPUT');
    return summary(await catalog.setLogo(req.params.ref, req.body, ext));
  });

  app.get<{ Params: { ref: string } }>('/api/templates/:ref/logo', async (req, reply) => {
    const entry = await catalog.resolve(req.params.ref);
    if (!entry.logoPath) throw new MdpressError('Questo template non ha un logo', 'TEMPLATE_NOT_FOUND');
    return reply.type(entry.logoPath.endsWith('.png') ? 'image/png' : 'image/jpeg').send(await readFile(entry.logoPath));
  });

  app.get<{ Params: { ref: string } }>('/api/templates/:ref/thumbnail.png', async (req, reply) => {
    const entry = await catalog.resolve(req.params.ref);
    const logoStamp = entry.logoPath ? String((await stat(entry.logoPath)).mtimeMs) : '';
    const key = createHash('sha1').update(JSON.stringify(entry.template)).update(logoStamp).digest('hex');
    let png = thumbnails.get(key);
    if (!png) {
      png = await renderSample(entry.template, entry.logoPath, 'png');
      thumbnails.set(key, png);
    }
    return reply.type('image/png').header('cache-control', 'no-cache').send(png);
  });

  app.get<{ Params: { ref: string } }>('/api/templates/:ref/export', async (req, reply) => {
    const entry = await catalog.resolve(req.params.ref);
    return reply
      .type('application/zip')
      .header('content-disposition', contentDisposition(`${entry.template.slug}.zip`))
      .send(await catalog.exportZip(req.params.ref));
  });

  app.post('/api/templates/import', { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) throw new MdpressError('Carica un file .zip', 'BAD_INPUT');
    return reply.code(201).send(summary(await catalog.importZip(req.body)));
  });

  app.post<{ Body: { template?: unknown; ref?: unknown } | undefined }>('/api/preview', async (req, reply) => {
    const template = parseTemplate(req.body?.template);
    let logoPath: string | null = null;
    if (typeof req.body?.ref === 'string' && template.logo.file) {
      logoPath = (await catalog.resolve(req.body.ref)).logoPath;
    }
    return reply.type('application/pdf').send(await renderSample(template, logoPath, 'pdf'));
  });

  app.post<{ Body: RenderBody | undefined }>('/api/render', async (req, reply) => {
    const b = req.body ?? {};
    if (typeof b.markdown !== 'string' || !b.markdown.trim()) throw new MdpressError('Markdown mancante', 'BAD_INPUT');
    const format = b.format === undefined ? 'pdf' : b.format;
    if (format !== 'pdf' && format !== 'docx') throw new MdpressError('Formato non supportato', 'BAD_INPUT');
    const entry = await catalog.resolve(typeof b.template === 'string' ? b.template : await defaultTemplateRef());
    const rawName = typeof b.filename === 'string' ? b.filename : 'documento.md';
    const stem = rawName.replace(/\.(md|markdown)$/i, '').replace(/[^\p{L}\p{N}._ -]/gu, '_').trim() || 'documento';
    const result = await render({
      markdown: b.markdown,
      baseDir: tmpdir(),
      fallbackTitle: stem,
      template: entry.template,
      logoPath: entry.logoPath,
      kind: format,
      overrides: {
        toc: typeof b.toc === 'boolean' ? b.toc : undefined,
        cover: typeof b.cover === 'boolean' ? b.cover : undefined,
      },
    });
    return reply
      .type(format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', contentDisposition(`${stem}.${format}`))
      .header('x-mdpress-warnings', encodeURIComponent(JSON.stringify(result.warnings)))
      .send(result.data);
  });

  app.get('/api/fonts', async () => {
    fonts ??= listFonts().catch((err: unknown) => {
      fonts = null;
      throw err;
    });
    return fonts;
  });

  app.get('/api/doctor', async () => checkDeps(true));

  if (existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Non trovato' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}

export async function startServer(opts: { port: number; open: boolean; catalog?: Catalog }) {
  const app = await buildServer({ catalog: opts.catalog });
  await app.listen({ host: '127.0.0.1', port: opts.port });
  const url = `http://127.0.0.1:${opts.port}`;
  if (opts.open) await open(url);
  return { url, close: () => app.close() };
}
