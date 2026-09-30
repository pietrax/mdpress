import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildTypstTemplate, textContent, typstString, type TypstContext } from '../src/core/typst.js';
import { parseTemplate } from '../src/core/theme.js';
import { run } from '../src/core/exec.js';
import { assetsDir } from '../src/core/paths.js';
import { hasTools, makePng, tempDir } from './helpers.js';

const tpl = (over: Record<string, unknown> = {}) => parseTemplate({ id: 'abcd1234', slug: 'p', name: 'P', ...over });
const ctx = (over: Partial<TypstContext> = {}): TypstContext => ({
  template: tpl(),
  logoPath: null,
  cover: false,
  toc: false,
  fallbackTitle: 'documento',
  ...over,
});

describe('typstString', () => {
  it('escapa virgolette, backslash, a capo e raddoppia $', () => {
    expect(typstString('a"b\\c$d\ne')).toBe('"a\\"b\\\\c$$d\\ne"');
  });
});

describe('textContent', () => {
  it('traduce i segnaposto in espressioni Typst', () => {
    expect(textContent('{title} — p. {page}/{pages}')).toBe(
      '[#meta-title#" — p. "#counter(page).display()#"/"#str(counter(page).final().first())]',
    );
  });
});

describe('buildTypstTemplate', () => {
  it('standard: A4 verticale, footer con numero di pagina, niente testata né copertina', () => {
    const out = buildTypstTemplate(ctx());
    expect(out).toContain('paper: "a4"');
    expect(out).toContain('flipped: false');
    expect(out).toContain('header: none,');
    expect(out).toContain('counter(page).display()');
    expect(out).toContain('$body$');
    expect(out).toContain('$if(title)$');
    expect(out).not.toContain('#page(header: none, footer: none)');
    expect(out).not.toContain('#outline');
  });

  it('Letter orizzontale', () => {
    const out = buildTypstTemplate(ctx({ template: tpl({ page: { size: 'Letter', orientation: 'landscape' } }) }));
    expect(out).toContain('paper: "us-letter"');
    expect(out).toContain('flipped: true');
  });

  it('titoli numerati fino al livello 3', () => {
    expect(buildTypstTemplate(ctx({ template: tpl({ headings: { numbered: true } }) }))).toContain(
      'numbering("1.1.1."',
    );
  });

  it('copertina con logo a doppia altezza', () => {
    const out = buildTypstTemplate(ctx({ cover: true, logoPath: '/tmp/logo.png' }));
    expect(out).toContain('#page(header: none, footer: none)[');
    expect(out).toContain('image("/tmp/logo.png", height: 24mm)');
  });

  it('copertina: solo i campi scelti', () => {
    const out = buildTypstTemplate(ctx({ cover: true, template: tpl({ cover: { fields: ['title', 'date'] } }) }));
    expect(out).toContain('meta-date');
    expect(out).not.toContain('meta-subtitle))');
  });

  it('slot logo senza file conta come vuoto', () => {
    const out = buildTypstTemplate(ctx({ template: tpl({ header: { left: { type: 'logo' } } }) }));
    expect(out).toContain('header: none,');
  });

  it('skipFirstPage nasconde la banda sulla prima pagina fisica', () => {
    const t = tpl({ header: { right: { type: 'text', value: '{title}' }, skipFirstPage: true } });
    expect(buildTypstTemplate(ctx({ template: t }))).toContain('here().page() > 1');
  });

  it('indice e righe alternate', () => {
    const out = buildTypstTemplate(ctx({ toc: true, template: tpl({ blocks: { tableStriped: true } }) }));
    expect(out).toContain('#outline(depth: 3)');
    expect(out).toContain('calc.even(y)');
  });

  it('il titolo di ripiego è escapato', () => {
    const out = buildTypstTemplate(ctx({ fallbackTitle: 'rapporto "$"' }));
    expect(out).toContain(`$else$#${typstString('rapporto "$"')}$endif$`);
  });
});

describe.runIf(hasTools)('compilazione reale con pandoc e typst', () => {
  const md = [
    '---',
    'title: "Titolo $ \\"strano\\""',
    'author: [A, B]',
    '---',
    '',
    '# Uno',
    '',
    'Testo *enfasi* e `codice`.',
    '',
    '> citazione',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    '    let x = 1;',
    '',
    '## Due',
    '',
    '---',
    '',
    'Fine.',
    '',
  ].join('\n');

  const cases: [string, Record<string, unknown>, Partial<TypstContext>][] = [
    ['standard', {}, {}],
    [
      'copertina, indice, numerazione, logo e testo speciale in testata',
      {
        headings: { numbered: true },
        header: {
          left: { type: 'logo' },
          right: { type: 'text', value: 'Prezzo $5 "citato" #hash \\ <b> & co {title}' },
          rule: true,
          skipFirstPage: true,
        },
        footer: { rule: true },
        blocks: { tableStriped: true, quoteBar: false },
      },
      { cover: true, toc: true },
    ],
    ['Letter orizzontale', { page: { size: 'Letter', orientation: 'landscape' } }, {}],
  ];

  it.each(cases)('%s', async (_name, over, flags) => {
    const dir = await tempDir();
    const logo = join(dir, 'logo.png');
    await writeFile(logo, makePng(60, 20));
    await writeFile(join(dir, 'in.md'), md);
    const template = buildTypstTemplate(ctx({ template: tpl(over), logoPath: logo, fallbackTitle: 'in', ...flags }));
    await writeFile(join(dir, 'template.typ'), template);
    await run('pandoc', ['in.md', '-f', 'markdown', '-t', 'typst', '--template', 'template.typ', '-o', 'doc.typ'], {
      cwd: dir,
    });
    await run('typst', ['compile', '--root', '/', 'doc.typ', 'doc.pdf'], { cwd: dir });
    expect((await readFile(join(dir, 'doc.pdf'))).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('images.lua: percorsi assoluti, immagini mancanti e remote irraggiungibili', async () => {
    const dir = join(await tempDir(), 'cartella con spazi è');
    await mkdir(join(dir, 'img'), { recursive: true });
    await writeFile(join(dir, 'img', 'p.png'), makePng(4, 4));
    await writeFile(join(dir, 'img', 'spazio uno.png'), makePng(4, 4));
    const input = '![spazio](<img/spazio uno.png>)\n\n![uno](img/p.png)\n\n![manca](nope.png)\n\n![remota](http://127.0.0.1:9/x.png)\n';
    const r = await run('pandoc', ['-f', 'markdown', '-t', 'typst', '--lua-filter', join(assetsDir, 'filters', 'images.lua')], {
      input,
      env: { MDPRESS_BASE: dir, MDPRESS_WORKDIR: dir },
    });
    const out = r.stdout.toString('utf8');
    expect(out).toContain(join(dir, 'img', 'p.png'));
    expect(out).toContain(join(dir, 'img', 'spazio uno.png'));
    expect(out).toContain('manca');
    expect(out).not.toContain('nope.png');
    expect(out).not.toContain('127.0.0.1');
    expect(r.stderr).toContain('mdpress: immagine non trovata');
    expect(r.stderr).toContain('mdpress: immagine non raggiungibile');
  });
});
