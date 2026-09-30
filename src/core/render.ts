import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { Catalog } from './catalog.js';
import { defaultTemplateRef } from './config.js';
import { assertDeps } from './deps.js';
import { buildReferenceDocx, finalizeDocx } from './docx.js';
import { MdpressError } from './errors.js';
import { CommandError, run } from './exec.js';
import { readFrontmatter, type DocMeta } from './frontmatter.js';
import { resolveOptions, type EffectiveOptions, type Format, type RenderOverrides } from './options.js';
import { assetsDir } from './paths.js';
import type { Template } from './theme.js';
import { buildTypstTemplate } from './typst.js';

export type RenderKind = Format | 'png';

export interface RenderRequest {
  markdown: string;
  /** Cartella rispetto a cui risolvere le immagini relative. */
  baseDir: string;
  /** Titolo usato per {title} e copertina se il front-matter non lo ha. */
  fallbackTitle: string;
  template: Template;
  logoPath: string | null;
  kind: RenderKind;
  overrides?: RenderOverrides;
  debug?: boolean;
}

export interface RenderResult {
  data: Buffer;
  warnings: string[];
  workDir: string | null;
}

const FILTERS = {
  images: join(assetsDir, 'filters', 'images.lua'),
  docx: join(assetsDir, 'filters', 'docx.lua'),
};

export function collectWarnings(...stderrs: string[]): string[] {
  const out = new Set<string>();
  for (const stderr of stderrs) {
    for (const m of stderr.matchAll(/unknown font family: ([^\n]+)/g)) {
      out.add(`Font non installato: ${m[1].trim()} (uso un font di ripiego)`);
    }
    for (const m of stderr.matchAll(/^\[WARNING\] (.+)$/gm)) out.add(m[1].trim());
    for (const m of stderr.matchAll(/^mdpress: (.+)$/gm)) out.add(m[1].trim());
  }
  return [...out];
}

function cleanStderr(stderr: string): string {
  return stderr.trim().split('\n').slice(0, 40).join('\n');
}

let baseReference: Promise<Buffer> | null = null;
function defaultReferenceDocx(): Promise<Buffer> {
  baseReference ??= run('pandoc', ['--print-default-data-file', 'reference.docx']).then((r) => r.stdout);
  return baseReference;
}

async function renderTypst(req: RenderRequest, eff: EffectiveOptions, work: string, kind: 'pdf' | 'png') {
  const template = buildTypstTemplate({
    template: req.template,
    logoPath: req.logoPath,
    cover: eff.cover,
    toc: eff.toc,
    fallbackTitle: req.fallbackTitle,
  });
  await writeFile(join(work, 'template.typ'), template);
  const pandoc = await run(
    'pandoc',
    ['input.md', '-f', 'markdown', '-t', 'typst', '--template', 'template.typ', '--lua-filter', FILTERS.images, '-o', 'doc.typ'],
    { cwd: work, env: { MDPRESS_BASE: req.baseDir, MDPRESS_WORKDIR: work } },
  );
  const out = kind === 'pdf' ? 'doc.pdf' : 'page.png';
  const args = ['compile', '--root', '/', 'doc.typ', out];
  if (kind === 'png') args.push('--pages', '1', '--format', 'png', '--ppi', '48');
  const typst = await run('typst', args, { cwd: work });
  return { data: await readFile(join(work, out)), warnings: collectWarnings(pandoc.stderr, typst.stderr) };
}

async function renderDocx(req: RenderRequest, meta: DocMeta, eff: EffectiveOptions, work: string) {
  const t = req.template;
  const logo = req.logoPath
    ? { data: await readFile(req.logoPath), ext: extname(req.logoPath).slice(1).toLowerCase() === 'png' ? ('png' as const) : ('jpg' as const) }
    : null;
  const reference = await buildReferenceDocx(await defaultReferenceDocx(), {
    template: t,
    meta: { ...meta, title: meta.title ?? req.fallbackTitle },
    cover: eff.cover,
    logo,
  });
  await writeFile(join(work, 'reference.docx'), reference);
  const args = [
    'input.md', '-f', 'markdown', '-t', 'docx',
    '--reference-doc', 'reference.docx',
    '--lua-filter', FILTERS.docx,
    `--resource-path=${req.baseDir}`,
    '-o', 'out.docx',
  ];
  if (t.headings.numbered) args.push('--number-sections');
  if (eff.toc) args.push('--toc', '--toc-depth=3', '-M', 'toc-title=Indice');
  const pandoc = await run('pandoc', args, {
    cwd: work,
    env: {
      MDPRESS_COVER: eff.cover ? '1' : '',
      MDPRESS_TOC: eff.toc ? '1' : '',
      MDPRESS_LOGO: eff.cover && t.cover.showLogo && req.logoPath ? req.logoPath : '',
      MDPRESS_LOGO_HEIGHT: `${t.logo.height * 2}mm`,
      MDPRESS_FIELDS: t.cover.fields.length > 0 ? t.cover.fields.join(',') : 'none',
      MDPRESS_FALLBACK_TITLE: req.fallbackTitle,
    },
  });
  const data = await finalizeDocx(await readFile(join(work, 'out.docx')), { updateFields: eff.toc });
  return { data, warnings: collectWarnings(pandoc.stderr) };
}

export async function render(req: RenderRequest): Promise<RenderResult> {
  await assertDeps();
  const meta = readFrontmatter(req.markdown);
  const eff = resolveOptions(req.template, meta, req.overrides ?? {});
  const work = await mkdtemp(join(tmpdir(), 'mdpress-'));
  try {
    await writeFile(join(work, 'input.md'), req.markdown);
    const { data, warnings } =
      req.kind === 'docx' ? await renderDocx(req, meta, eff, work) : await renderTypst(req, eff, work, req.kind);
    return { data, warnings, workDir: req.debug ? work : null };
  } catch (err) {
    if (err instanceof CommandError) {
      const where = req.debug ? `\nCartella di lavoro: ${work}` : '';
      throw new MdpressError(`Rendering fallito (${err.command}): ${cleanStderr(err.stderr)}${where}`, 'RENDER_FAILED');
    }
    throw err;
  } finally {
    if (!req.debug) await rm(work, { recursive: true, force: true });
  }
}

export function outputPaths(input: string, output?: string): Record<Format, string> {
  const stem = basename(input, extname(input));
  let base: string;
  if (!output) base = join(dirname(input), stem);
  else if (output.endsWith('/') || output.endsWith(sep)) base = join(resolve(output), stem);
  else {
    const ext = extname(output).toLowerCase();
    base = resolve(ext === '.pdf' || ext === '.docx' ? output.slice(0, -ext.length) : output);
  }
  return { pdf: `${base}.pdf`, docx: `${base}.docx` };
}

export interface RenderFileOptions {
  templateRef?: string;
  formats: Format[];
  output?: string;
  overrides?: RenderOverrides;
  debug?: boolean;
  catalog?: Catalog;
}

export interface RenderFileResult {
  outputs: string[];
  warnings: string[];
  workDirs: string[];
}

export async function renderFile(file: string, opts: RenderFileOptions): Promise<RenderFileResult> {
  const input = resolve(file);
  let markdown: string;
  try {
    markdown = await readFile(input, 'utf8');
  } catch {
    throw new MdpressError(`File non trovato: ${file}`, 'BAD_INPUT');
  }
  const catalog = opts.catalog ?? Catalog.default();
  const entry = await catalog.resolve(opts.templateRef ?? (await defaultTemplateRef()));
  const paths = outputPaths(input, opts.output);
  const result: RenderFileResult = { outputs: [], warnings: [], workDirs: [] };
  for (const kind of opts.formats) {
    const r = await render({
      markdown,
      baseDir: dirname(input),
      fallbackTitle: basename(input, extname(input)),
      template: entry.template,
      logoPath: entry.logoPath,
      kind,
      overrides: opts.overrides,
      debug: opts.debug,
    });
    await mkdir(dirname(paths[kind]), { recursive: true });
    await writeFile(paths[kind], r.data);
    result.outputs.push(paths[kind]);
    for (const w of r.warnings) if (!result.warnings.includes(w)) result.warnings.push(w);
    if (r.workDir) result.workDirs.push(r.workDir);
  }
  return result;
}
