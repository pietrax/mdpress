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
  fallbackTitle: 'document',
  ...over,
});

describe('typstString', () => {
  it('escapes quotes, backslashes, newlines and doubles $', () => {
    expect(typstString('a"b\\c$d\ne')).toBe('"a\\"b\\\\c$$d\\ne"');
  });
});

describe('textContent', () => {
  it('translates placeholders into Typst expressions', () => {
    expect(textContent('{title} — p. {page}/{pages}')).toBe(
      '[#meta-title#" — p. "#counter(page).display()#"/"#str(counter(page).final().first())]',
    );
  });
});

describe('buildTypstTemplate', () => {
  it('standard: portrait A4, footer with page number, no header or cover', () => {
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

  it('landscape Letter', () => {
    const out = buildTypstTemplate(ctx({ template: tpl({ page: { size: 'Letter', orientation: 'landscape' } }) }));
    expect(out).toContain('paper: "us-letter"');
    expect(out).toContain('flipped: true');
  });

  it('numbered headings down to level 3', () => {
    expect(buildTypstTemplate(ctx({ template: tpl({ headings: { numbered: true } }) }))).toContain(
      'numbering("1.1.1."',
    );
  });

  it('cover with a double-height logo', () => {
    const out = buildTypstTemplate(ctx({ cover: true, logoPath: '/tmp/logo.png' }));
    expect(out).toContain('#page(header: none, footer: none)[');
    expect(out).toContain('image("/tmp/logo.png", height: 24mm)');
  });

  it('cover: only the chosen fields', () => {
    const out = buildTypstTemplate(ctx({ cover: true, template: tpl({ cover: { fields: ['title', 'date'] } }) }));
    expect(out).toContain('meta-date');
    expect(out).not.toContain('meta-subtitle))');
  });

  it('a logo slot without a file counts as empty', () => {
    const out = buildTypstTemplate(ctx({ template: tpl({ header: { left: { type: 'logo' } } }) }));
    expect(out).toContain('header: none,');
  });

  it('skipFirstPage hides the band on the first physical page', () => {
    const t = tpl({ header: { right: { type: 'text', value: '{title}' }, skipFirstPage: true } });
    expect(buildTypstTemplate(ctx({ template: t }))).toContain('here().page() > 1');
  });

  it('table of contents and striped rows', () => {
    const out = buildTypstTemplate(ctx({ toc: true, template: tpl({ blocks: { tableStriped: true } }) }));
    expect(out).toContain('#outline(depth: 3)');
    expect(out).toContain('calc.even(y)');
  });

  it('the fallback title is escaped', () => {
    const out = buildTypstTemplate(ctx({ fallbackTitle: 'report "$"' }));
    expect(out).toContain(`$else$#${typstString('report "$"')}$endif$`);
  });

  it('sets the document language from the template', () => {
    expect(buildTypstTemplate(ctx())).toContain('lang: "en"');
    expect(buildTypstTemplate(ctx({ template: tpl({ language: 'it' }) }))).toContain('lang: "it"');
  });
});

describe.runIf(hasTools)('real compilation with pandoc and typst', () => {
  const md = [
    '---',
    'title: "Title $ \\"odd\\""',
    'author: [A, B]',
    '---',
    '',
    '# One',
    '',
    'Text *emphasis* and `code`.',
    '',
    '> quote',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    '    let x = 1;',
    '',
    '## Two',
    '',
    '---',
    '',
    'End.',
    '',
  ].join('\n');

  const cases: [string, Record<string, unknown>, Partial<TypstContext>][] = [
    ['standard', {}, {}],
    [
      'cover, table of contents, numbering, logo and special text in the header',
      {
        headings: { numbered: true },
        header: {
          left: { type: 'logo' },
          right: { type: 'text', value: 'Price $5 "quoted" #hash \\ <b> & co {title}' },
          rule: true,
          skipFirstPage: true,
        },
        footer: { rule: true },
        blocks: { tableStriped: true, quoteBar: false },
      },
      { cover: true, toc: true },
    ],
    ['landscape Letter', { page: { size: 'Letter', orientation: 'landscape' } }, {}],
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

  it('images.lua: absolute paths, missing images and unreachable remote images', async () => {
    const dir = join(await tempDir(), 'caf\u00e9 folder');
    await mkdir(join(dir, 'img'), { recursive: true });
    await writeFile(join(dir, 'img', 'p.png'), makePng(4, 4));
    await writeFile(join(dir, 'img', 'space one.png'), makePng(4, 4));
    const input = '![space](<img/space one.png>)\n\n![one](img/p.png)\n\n![missing](nope.png)\n\n![remote](http://127.0.0.1:9/x.png)\n';
    const r = await run('pandoc', ['-f', 'markdown', '-t', 'typst', '--lua-filter', join(assetsDir, 'filters', 'images.lua')], {
      input,
      env: { MDPRESS_BASE: dir, MDPRESS_WORKDIR: dir },
    });
    const out = r.stdout.toString('utf8');
    expect(out).toContain(join(dir, 'img', 'p.png'));
    expect(out).toContain(join(dir, 'img', 'space one.png'));
    expect(out).toContain('missing');
    expect(out).not.toContain('nope.png');
    expect(out).not.toContain('127.0.0.1');
    expect(r.stderr).toContain('mdpress:image-not-found:nope.png');
    expect(r.stderr).toContain('mdpress:image-unreachable:http://127.0.0.1:9/x.png');
  });
});
