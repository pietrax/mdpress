import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Catalog } from '../src/core/catalog.js';
import { builtinTemplatesDir } from '../src/core/paths.js';
import { collectWarnings, outputPaths, renderFile } from '../src/core/render.js';
import { renderSample } from '../src/core/preview.js';
import { parseTemplate } from '../src/core/theme.js';
import { hasTools, makePng, pdfPageCount, tempDir, unzipText } from './helpers.js';

describe('outputPaths', () => {
  it('senza -o scrive accanto all’md', () => {
    expect(outputPaths('/a/doc.md')).toEqual({ pdf: '/a/doc.pdf', docx: '/a/doc.docx' });
  });
  it('-o con estensione o senza', () => {
    expect(outputPaths('/a/doc.md', '/b/report.pdf')).toEqual({ pdf: '/b/report.pdf', docx: '/b/report.docx' });
    expect(outputPaths('/a/doc.md', '/b/report')).toEqual({ pdf: '/b/report.pdf', docx: '/b/report.docx' });
  });
  it('-o che finisce con / è una cartella', () => {
    expect(outputPaths('/a/doc.md', '/b/out/')).toEqual({ pdf: '/b/out/doc.pdf', docx: '/b/out/doc.docx' });
  });
});

describe('collectWarnings', () => {
  it('estrae font mancanti, warning di pandoc e dei filtri, senza doppioni', () => {
    const typst = 'warning: unknown font family: inter\n  ┌─ doc.typ\nwarning: unknown font family: inter\n';
    const pandoc = '[WARNING] Could not fetch resource x.png: replacing image with description\nmdpress: immagine non trovata, sostituita dal testo alternativo: y.png\n';
    expect(collectWarnings(typst, pandoc)).toEqual([
      'Font non installato: inter (uso un font di ripiego)',
      'Could not fetch resource x.png: replacing image with description',
      'immagine non trovata, sostituita dal testo alternativo: y.png',
    ]);
  });
});

describe.runIf(hasTools)('render con pandoc e typst', () => {
  let dir: string;
  let catalog: Catalog;
  const MD = [
    '---',
    'title: Relazione',
    'subtitle: Q3',
    'author: Mario Rossi',
    'date: 30 settembre 2026',
    '---',
    '',
    '# Introduzione',
    '',
    'Testo.',
    '',
    '![Foto](img/foto.png)',
    '',
    '## Dettagli',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
  ].join('\n');

  beforeAll(async () => {
    dir = join(await tempDir(), 'progetto con spazi è');
    await mkdir(join(dir, 'img'), { recursive: true });
    await writeFile(join(dir, 'img', 'foto.png'), makePng(40, 30));
    await writeFile(join(dir, 'doc.md'), MD);
    catalog = new Catalog({ builtinDir: builtinTemplatesDir, userDir: join(dir, '.templates') });
  });

  it('ogni built-in produce PDF e DOCX con l’immagine relativa', async () => {
    for (const entry of await catalog.list()) {
      const r = await renderFile(join(dir, 'doc.md'), {
        templateRef: entry.template.id,
        formats: ['pdf', 'docx'],
        output: join(dir, 'out', entry.template.slug),
        catalog,
      });
      expect(r.warnings.join('\n')).not.toContain('non trovata');
      expect((await readFile(r.outputs[0])).subarray(0, 4).toString()).toBe('%PDF');
      const documentXml = (await unzipText(await readFile(r.outputs[1]), 'word/document.xml')) ?? '';
      expect(documentXml).toContain('w:val="Heading1"');
      expect(documentXml).toContain('<a:blip');
    }
  });

  it('immagine con spazio nel nome: presente in PDF e DOCX, nessun warning', async () => {
    await writeFile(join(dir, 'img', 'foto uno.png'), makePng(40, 30));
    await writeFile(join(dir, 'spazi.md'), '# T\n\n![x](<img/foto uno.png>)\n');
    const r = await renderFile(join(dir, 'spazi.md'), { formats: ['pdf', 'docx'], output: join(dir, 'out', 'spazi'), catalog });
    expect(r.warnings.join('\n')).not.toContain('non trovata');
    expect((await readFile(r.outputs[0])).subarray(0, 4).toString()).toBe('%PDF');
    expect((await unzipText(await readFile(r.outputs[1]), 'word/document.xml')) ?? '').toContain('<a:blip');
  });

  it('copertina e indice: pagine in più, campo TOC, interruzione e updateFields', async () => {
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

  it('senza front-matter usa il nome del file e non mette il blocco titolo', async () => {
    await catalog.create({ slug: 'hdr', name: 'H', header: { right: { type: 'text', value: '{title}' } } });
    await writeFile(join(dir, 'mio-file.md'), '# Solo\n\nTesto.\n');
    const r = await renderFile(join(dir, 'mio-file.md'), { templateRef: 'hdr', formats: ['pdf', 'docx'], catalog });
    const docx = await readFile(r.outputs[1]);
    expect(await unzipText(docx, 'word/header1.xml')).toContain('mio-file');
    expect(await unzipText(docx, 'word/document.xml')).not.toContain('w:val="Title"');
  });

  it('caratteri speciali in testata: PDF compila e DOCX è XML valido', async () => {
    await catalog.create({
      slug: 'speciale',
      name: 'S',
      header: { right: { type: 'text', value: 'Prezzo $5 "x" #y \\ <z> & co' } },
    });
    const r = await renderFile(join(dir, 'doc.md'), { templateRef: 'speciale', formats: ['pdf', 'docx'], output: join(dir, 'out', 'sp'), catalog });
    expect((await readFile(r.outputs[0])).subarray(0, 4).toString()).toBe('%PDF');
    const header = (await unzipText(await readFile(r.outputs[1]), 'word/header1.xml')) ?? '';
    expect(header).toContain('&amp; co');
    expect(header).toContain('&lt;z&gt;');
  });

  it('immagini mancanti e remote irraggiungibili non bloccano il rendering', async () => {
    await writeFile(join(dir, 'rotte.md'), '# T\n\n![manca](nope.png)\n\n![remota](http://127.0.0.1:9/x.png)\n');
    const r = await renderFile(join(dir, 'rotte.md'), { formats: ['pdf', 'docx'], catalog });
    const all = r.warnings.join('\n');
    expect(all).toContain('immagine non trovata');
    expect(all).toContain('immagine non raggiungibile');
    expect(all).toContain('Could not fetch resource');
    expect(r.outputs).toHaveLength(2);
  });

  it('font non installato: warning e rendering completato', async () => {
    await catalog.create({ slug: 'font', name: 'F', fonts: { body: 'Font Inesistente Mdpress' } });
    const r = await renderFile(join(dir, 'doc.md'), { templateRef: 'font', formats: ['pdf'], output: join(dir, 'out', 'font'), catalog });
    expect(r.warnings.join('\n').toLowerCase()).toContain('font non installato: font inesistente mdpress');
    expect(existsSync(r.outputs[0])).toBe(true);
  });

  it('crea la cartella di output e con debug conserva la cartella di lavoro', async () => {
    const r = await renderFile(join(dir, 'doc.md'), { formats: ['pdf'], output: join(dir, 'nuova', 'sotto') + '/', debug: true, catalog });
    expect(r.outputs[0]).toBe(join(dir, 'nuova', 'sotto', 'doc.pdf'));
    expect(existsSync(r.outputs[0])).toBe(true);
    expect(r.workDirs).toHaveLength(1);
    expect(existsSync(join(r.workDirs[0], 'doc.typ'))).toBe(true);
    await rm(r.workDirs[0], { recursive: true, force: true });
  });

  it('renderSample produce la miniatura PNG', async () => {
    const t = parseTemplate({ id: 'abcd1234', slug: 'p', name: 'P' });
    const png = await renderSample(t, null, 'png');
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('file inesistente e template sconosciuto danno errori chiari', async () => {
    await expect(renderFile(join(dir, 'nessuno.md'), { formats: ['pdf'], catalog })).rejects.toThrow(/File non trovato/);
    await expect(renderFile(join(dir, 'doc.md'), { templateRef: 'boh', formats: ['pdf'], catalog })).rejects.toThrow(/non trovato/);
  });
});
