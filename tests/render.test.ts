import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { t } from '../src/i18n/index.js';
import { collectWarnings, outputPaths, renderFile } from '../src/core/render.js';
import { renderSample } from '../src/core/preview.js';
import { parseTemplate } from '../src/core/theme.js';
import { hasTools, makePng, pdfPageCount, tempDir, unzipText } from './helpers.js';

describe('outputPaths', () => {
  it('without -o writes next to the md file', () => {
    expect(outputPaths('/a/doc.md')).toEqual({ pdf: '/a/doc.pdf', docx: '/a/doc.docx' });
  });
  it('-o with or without an extension', () => {
    expect(outputPaths('/a/doc.md', '/b/report.pdf')).toEqual({ pdf: '/b/report.pdf', docx: '/b/report.docx' });
    expect(outputPaths('/a/doc.md', '/b/report')).toEqual({ pdf: '/b/report.pdf', docx: '/b/report.docx' });
  });
  it('-o ending with / is a folder', () => {
    expect(outputPaths('/a/doc.md', '/b/out/')).toEqual({ pdf: '/b/out/doc.pdf', docx: '/b/out/doc.docx' });
  });
});

describe('collectWarnings', () => {
  it('collectWarnings returns keys, deduplicated', () => {
    const typst = 'warning: unknown font family: inter\n  ┌─ doc.typ\nwarning: unknown font family: inter\n';
    const pandoc =
      '[WARNING] Could not fetch resource x.png: replacing image with description\n' +
      'mdpress:image-not-found:y.png\nmdpress:image-unreachable:http://h/z.png\n';
    expect(collectWarnings(typst, pandoc)).toEqual([
      { key: 'warnings.fontMissing', params: { font: 'inter' } },
      { key: 'warnings.tool', params: { details: 'Could not fetch resource x.png: replacing image with description' } },
      { key: 'warnings.imageNotFound', params: { src: 'y.png' } },
      { key: 'warnings.imageUnreachable', params: { src: 'http://h/z.png' } },
    ]);
  });
});

describe.runIf(hasTools)('render with pandoc and typst', () => {
  let dir: string;
  let catalog: Catalog;
  const MD = [
    '---',
    'title: Report',
    'subtitle: Q3',
    'author: Jane Doe',
    'date: September 30, 2026',
    '---',
    '',
    '# Introduction',
    '',
    'Text.',
    '',
    '![photo](img/photo.png)',
    '',
    '## Details',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
  ].join('\n');

  beforeAll(async () => {
    dir = join(await tempDir(), 'project with spaces');
    await mkdir(join(dir, 'img'), { recursive: true });
    await writeFile(join(dir, 'img', 'photo.png'), makePng(40, 30));
    await writeFile(join(dir, 'doc.md'), MD);
    catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(dir, '.templates') });
  });

  it('every built-in produces PDF and DOCX with the relative image', async () => {
    for (const entry of await catalog.list()) {
      const r = await renderFile(join(dir, 'doc.md'), {
        templateRef: entry.template.id,
        formats: ['pdf', 'docx'],
        output: join(dir, 'out', entry.template.slug),
        catalog,
      });
      expect(r.warnings.map((w) => w.key)).not.toContain('warnings.imageNotFound');
      expect((await readFile(r.outputs[0])).subarray(0, 4).toString()).toBe('%PDF');
      const documentXml = (await unzipText(await readFile(r.outputs[1]), 'word/document.xml')) ?? '';
      expect(documentXml).toContain('w:val="Heading1"');
      expect(documentXml).toContain('<a:blip');
    }
  });

  it('report with cover logo: no local path in the DOCX, logo in the Title paragraph, clean title', async () => {
    const r = await renderFile(join(dir, 'doc.md'), { templateRef: 'mdprep01', formats: ['docx'], output: join(dir, 'out', 'rep'), catalog });
    const docx = await readFile(r.outputs[0]);
    const documentXml = (await unzipText(docx, 'word/document.xml')) ?? '';
    expect(documentXml).not.toContain(join(builtinTemplatesDir, 'report', 'logo.png'));
    expect(documentXml).not.toContain(dir);
    const title = /<w:p>(?:(?!<\/w:p>)[\s\S])*?w:val="Title"[\s\S]*?<\/w:p>/.exec(documentXml)?.[0] ?? '';
    expect(title).toContain('<w:drawing>');
    expect(await unzipText(docx, 'docProps/core.xml')).toContain('<dc:title>Report</dc:title>');
  });

  it('image with a space in its name: present in PDF and DOCX, no warning', async () => {
    await writeFile(join(dir, 'img', 'photo one.png'), makePng(40, 30));
    await writeFile(join(dir, 'spaces.md'), '# T\n\n![x](<img/photo one.png>)\n');
    const r = await renderFile(join(dir, 'spaces.md'), { formats: ['pdf', 'docx'], output: join(dir, 'out', 'spaces'), catalog });
    expect(r.warnings.map((w) => w.key)).not.toContain('warnings.imageNotFound');
    expect((await readFile(r.outputs[0])).subarray(0, 4).toString()).toBe('%PDF');
    expect((await unzipText(await readFile(r.outputs[1]), 'word/document.xml')) ?? '').toContain('<a:blip');
  });

  it('cover and table of contents: extra pages, TOC field, page break and updateFields', async () => {
    const base = { formats: ['pdf', 'docx'] as const, catalog, overrides: { cover: true, toc: true } };
    const r = await renderFile(join(dir, 'doc.md'), { ...base, formats: [...base.formats], output: join(dir, 'out', 'tc') });
    expect(pdfPageCount(await readFile(r.outputs[0]))).toBeGreaterThanOrEqual(3);
    const docx = await readFile(r.outputs[1]);
    const documentXml = (await unzipText(docx, 'word/document.xml')) ?? '';
    expect(documentXml).toContain('TOC \\o');
    expect(documentXml).toContain('<w:br w:type="page"/>');
    expect(await unzipText(docx, 'word/settings.xml')).toContain('w:updateFields');

    const plain = await renderFile(join(dir, 'doc.md'), { formats: ['pdf'], catalog, output: join(dir, 'out', 'plain') });
    expect(pdfPageCount(await readFile(plain.outputs[0]))).toBe(1);
  });

  it('without front-matter uses the file name and adds no title block', async () => {
    await catalog.create({ slug: 'hdr', name: 'H', header: { right: { type: 'text', value: '{title}' } } });
    await writeFile(join(dir, 'my-file.md'), '# Only\n\nText.\n');
    const r = await renderFile(join(dir, 'my-file.md'), { templateRef: 'hdr', formats: ['pdf', 'docx'], catalog });
    const docx = await readFile(r.outputs[1]);
    expect(await unzipText(docx, 'word/header1.xml')).toContain('my-file');
    expect(await unzipText(docx, 'word/document.xml')).not.toContain('w:val="Title"');
  });

  it('special characters in the header: PDF compiles and DOCX is valid XML', async () => {
    await catalog.create({
      slug: 'special',
      name: 'S',
      header: { right: { type: 'text', value: 'Price $5 "x" #y \\ <z> & co' } },
    });
    const r = await renderFile(join(dir, 'doc.md'), { templateRef: 'special', formats: ['pdf', 'docx'], output: join(dir, 'out', 'sp'), catalog });
    expect((await readFile(r.outputs[0])).subarray(0, 4).toString()).toBe('%PDF');
    const header = (await unzipText(await readFile(r.outputs[1]), 'word/header1.xml')) ?? '';
    expect(header).toContain('&amp; co');
    expect(header).toContain('&lt;z&gt;');
  });

  it('missing images and unreachable remote images do not block rendering', async () => {
    await writeFile(join(dir, 'broken.md'), '# T\n\n![missing](nope.png)\n\n![remote](http://127.0.0.1:9/x.png)\n');
    const r = await renderFile(join(dir, 'broken.md'), { formats: ['pdf', 'docx'], catalog });
    const keys = r.warnings.map((w) => w.key);
    expect(keys).toContain('warnings.imageNotFound');
    expect(keys).toContain('warnings.imageUnreachable');
    expect(r.warnings.map((w) => w.params.details ?? '').join('\n')).toContain('Could not fetch resource');
    expect(r.outputs).toHaveLength(2);
  });

  it('font not installed: warning and rendering completed', async () => {
    await catalog.create({ slug: 'font', name: 'F', fonts: { body: 'Nonexistent Font Mdpress' } });
    const r = await renderFile(join(dir, 'doc.md'), { templateRef: 'font', formats: ['pdf'], output: join(dir, 'out', 'font'), catalog });
    expect(r.warnings).toContainEqual({ key: 'warnings.fontMissing', params: { font: 'nonexistent font mdpress' } });
    expect(existsSync(r.outputs[0])).toBe(true);
  });

  it('creates the output folder and keeps the work folder with debug', async () => {
    const r = await renderFile(join(dir, 'doc.md'), { formats: ['pdf'], output: join(dir, 'new', 'below') + '/', debug: true, catalog });
    expect(r.outputs[0]).toBe(join(dir, 'new', 'below', 'doc.pdf'));
    expect(existsSync(r.outputs[0])).toBe(true);
    expect(r.workDirs).toHaveLength(1);
    expect(existsSync(join(r.workDirs[0], 'doc.typ'))).toBe(true);
    await rm(r.workDirs[0], { recursive: true, force: true });
  });

  it('the table of contents title follows the template language', async () => {
    await catalog.create({ slug: 'italian', name: 'Italian', language: 'it' });
    const it = await renderFile(join(dir, 'doc.md'), { templateRef: 'italian', formats: ['docx'], overrides: { toc: true }, output: join(dir, 'out', 'toc-it'), catalog });
    expect(await unzipText(await readFile(it.outputs[0]), 'word/document.xml')).toContain(t('document.tocTitle', {}, 'it'));
    const en = await renderFile(join(dir, 'doc.md'), { formats: ['docx'], overrides: { toc: true }, output: join(dir, 'out', 'toc-en'), catalog });
    expect(await unzipText(await readFile(en.outputs[0]), 'word/document.xml')).toContain('Contents');
  });

  it('renderSample produces the PNG thumbnail', async () => {
    const t = parseTemplate({ id: 'abcd1234', slug: 'p', name: 'P' });
    const png = await renderSample(t, null, 'png');
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('missing file and unknown template give clear errors', async () => {
    await expect(renderFile(join(dir, 'nobody.md'), { formats: ['pdf'], catalog })).rejects.toThrow(/File not found/);
    await expect(renderFile(join(dir, 'doc.md'), { templateRef: 'nope', formats: ['pdf'], catalog })).rejects.toThrow(/not found/);
  });
});
