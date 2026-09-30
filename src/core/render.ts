import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { Catalog } from './catalog.js';
import { defaultTemplateRef } from './config.js';
import { assertDeps } from './deps.js';
import { buildReferenceDocx, finalizeDocx } from './docx.js';
import { MdpressError } from './errors.js';
import { t, type Language, type Params } from '../i18n/index.js';
import { CommandError, run } from './exec.js';
import { listFonts } from './fonts.js';
import { readFrontmatter, type DocMeta } from './frontmatter.js';
import { resolveOptions, type EffectiveOptions, type Format, type RenderOverrides } from './options.js';
import { assetsDir } from './paths.js';
import type { Template } from './theme.js';
import { buildTypstTemplate } from './typst.js';

export type RenderKind = Format | 'png';

export interface RenderRequest {
  markdown: string;
  /** Folder that relative image paths are resolved against. */
  baseDir: string;
  /** Title used for {title} and the cover when the front-matter has none. */
  fallbackTitle: string;
  template: Template;
  logoPath: string | null;
  kind: RenderKind;
  overrides?: RenderOverrides;
  debug?: boolean;
}

export interface Warning {
  key: string;
  params: Params;
}

export interface RenderResult {
  data: Buffer;
  warnings: Warning[];
  workDir: string | null;
}

const FILTERS = {
  images: join(assetsDir, 'filters', 'images.lua'),
  docx: join(assetsDir, 'filters', 'docx.lua'),
};

export function localizeWarning(warning: Warning, lang: Language): string {
  return t(warning.key, warning.params, lang);
}

export function collectWarnings(...stderrs: string[]): Warning[] {
  const out = new Map<string, Warning>();
  const add = (w: Warning) => out.set(JSON.stringify(w), w);
  for (const stderr of stderrs) {
    for (const m of stderr.matchAll(/unknown font family: ([^\n]+)/g)) {
      add({ key: 'warnings.fontMissing', params: { font: m[1].trim() } });
    }
    for (const m of stderr.matchAll(/^\[WARNING\] (.+)$/gm)) add({ key: 'warnings.tool', params: { details: m[1].trim() } });
    for (const m of stderr.matchAll(/^mdpress:image-(not-found|unreachable):(.+)$/gm)) {
      add({ key: m[1] === 'not-found' ? 'warnings.imageNotFound' : 'warnings.imageUnreachable', params: { src: m[2].trim() } });
    }
  }
  // pandoc also reports "Could not fetch resource <src>" for images the Lua filter already flagged.
  const imageSrcs = new Set(
    [...out.values()].filter((w) => w.key === 'warnings.imageNotFound' || w.key === 'warnings.imageUnreachable').map((w) => String(w.params?.src).trim()),
  );
  return [...out.values()].filter((w) => {
    if (w.key !== 'warnings.tool') return true;
    const m = /^Could not fetch resource (.+?)(?:: .*)?$/s.exec(String(w.params?.details).trim());
    return !(m && imageSrcs.has(m[1].trim()));
  });
}

function cleanStderr(stderr: string): string {
  return stderr.trim().split('\n').slice(0, 40).join('\n');
}

let installedFonts: Promise<string[] | undefined> | null = null;
/** Font families Typst can see, cached per process; undefined if `typst fonts` fails. */
function typstFonts(): Promise<string[] | undefined> {
  installedFonts ??= listFonts().catch(() => {
    installedFonts = null;
    return undefined;
  });
  return installedFonts;
}

let baseReference: Promise<Buffer> | null = null;
function defaultReferenceDocx(): Promise<Buffer> {
  baseReference ??= run('pandoc', ['--print-default-data-file', 'reference.docx'])
    .then((r) => r.stdout)
    .catch((err: unknown) => {
      baseReference = null;
      throw err;
    });
  return baseReference;
}

async function renderTypst(req: RenderRequest, eff: EffectiveOptions, work: string, kind: 'pdf' | 'png') {
  const template = buildTypstTemplate({
    template: req.template,
    logoPath: req.logoPath,
    cover: eff.cover,
    toc: eff.toc,
    fallbackTitle: req.fallbackTitle,
    fonts: await typstFonts(),
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
  const template = req.template;
  const logo = req.logoPath
    ? { data: await readFile(req.logoPath), ext: extname(req.logoPath).slice(1).toLowerCase() === 'png' ? ('png' as const) : ('jpg' as const) }
    : null;
  const reference = await buildReferenceDocx(await defaultReferenceDocx(), {
    template,
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
  if (template.headings.numbered) args.push('--number-sections');
  if (eff.toc) args.push('--toc', '--toc-depth=3', '-M', `toc-title=${t('document.tocTitle', {}, template.language)}`);
  const pandoc = await run('pandoc', args, {
    cwd: work,
    env: {
      MDPRESS_COVER: eff.cover ? '1' : '',
      MDPRESS_TOC: eff.toc ? '1' : '',
      MDPRESS_LOGO: eff.cover && template.cover.showLogo && req.logoPath ? req.logoPath : '',
      MDPRESS_LOGO_HEIGHT: `${template.logo.height * 2}mm`,
      MDPRESS_FIELDS: template.cover.fields.length > 0 ? template.cover.fields.join(',') : 'none',
      MDPRESS_FALLBACK_TITLE: req.fallbackTitle,
    },
  });
  // The cover logo would end up in the document properties title: rewrite it as plain text.
  const plainTitle = eff.cover && template.cover.showLogo && req.logoPath ? (meta.title ?? req.fallbackTitle) : undefined;
  const data = await finalizeDocx(await readFile(join(work, 'out.docx')), { updateFields: eff.toc, title: plainTitle });
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
      throw new MdpressError(req.debug ? 'errors.renderFailedWorkDir' : 'errors.renderFailed', 'RENDER_FAILED', {
        tool: err.command,
        details: cleanStderr(err.stderr),
        dir: work,
      });
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
  warnings: Warning[];
  workDirs: string[];
}

export async function renderFile(file: string, opts: RenderFileOptions): Promise<RenderFileResult> {
  const input = resolve(file);
  let markdown: string;
  try {
    markdown = await readFile(input, 'utf8');
  } catch {
    throw new MdpressError('errors.fileNotFound', 'BAD_INPUT', { file });
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
    for (const w of r.warnings) {
      if (!result.warnings.some((x) => JSON.stringify(x) === JSON.stringify(w))) result.warnings.push(w);
    }
    if (r.workDir) result.workDirs.push(r.workDir);
  }
  return result;
}
