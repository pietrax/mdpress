import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildReferenceDocx, finalizeDocx, xmlEscape, type DocxContext } from '../src/core/docx.js';
import { parseTemplate } from '../src/core/theme.js';
import { makePng, unzipText } from './helpers.js';

async function minimalBase(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  );
  zip.file(
    'word/styles.xml',
    '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="character" w:styleId="Heading1Char"><w:name w:val="Heading 1 Char"/></w:style></w:styles>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p/><w:sectPr><w:footnotePr/></w:sectPr></w:body></w:document>',
  );
  zip.file(
    'word/settings.xml',
    '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:compat/></w:settings>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const tpl = (over: Record<string, unknown> = {}) => parseTemplate({ id: 'abcd1234', slug: 'p', name: 'P', ...over });

async function build(over: Record<string, unknown> = {}, extra: Partial<DocxContext> = {}) {
  const docx = await buildReferenceDocx(await minimalBase(), {
    template: tpl(over),
    meta: { title: 'Report & co', author: 'Ada <Lovelace>' },
    cover: false,
    logo: null,
    ...extra,
  });
  const text = async (path: string) => (await unzipText(docx, path)) ?? '';
  return { docx, text };
}

describe('xmlEscape', () => {
  it('escapa i caratteri XML', () => {
    expect(xmlEscape(`a&b<c>"d"`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;');
  });
  it('rimuove i caratteri di controllo illegali in XML 1.0', () => {
    expect(xmlEscape('a\x01b\x0bc')).toBe('abc');
  });
});

describe('buildReferenceDocx', () => {
  it('sostituisce gli stili una sola volta e imposta font e colori', async () => {
    const { text } = await build({ fonts: { body: 'Georgia' }, colors: { heading: '#0b3d91' } });
    const styles = await text('word/styles.xml');
    expect(styles.match(/w:styleId="Heading1"/g)).toHaveLength(1);
    expect(styles).toMatch(/w:styleId="Heading1"[\s\S]*?<w:color w:val="0B3D91"\/>/);
    expect(styles).toContain('w:styleId="Heading1Char"');
    expect(styles).toMatch(/<w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia"/);
    expect(styles).toContain('w:styleId="SourceCode"');
    expect(styles).toContain('w:styleId="TOCHeading"');
  });

  it('un $ nel nome del font non corrompe styles.xml', async () => {
    const { text } = await build({ fonts: { body: 'A$&B$$C' } });
    const styles = await text('word/styles.xml');
    expect(styles).toContain('w:ascii="A$&amp;B$$C"');
    expect(styles.match(/w:styleId="Heading1"/g)).toHaveLength(1);
  });

  it('standard: solo il footer con i campi PAGE e NUMPAGES', async () => {
    const { text } = await build();
    expect(await text('word/header1.xml')).toBe('');
    const footer = await text('word/footer1.xml');
    expect(footer).toContain('w:instr="PAGE"');
    expect(footer).toContain('w:instr="NUMPAGES"');
    expect(await text('word/_rels/document.xml.rels')).toContain('Target="footer1.xml"');
    expect(await text('[Content_Types].xml')).toContain('/word/footer1.xml');
  });

  it('i segnaposto della testata diventano testo escapato', async () => {
    const { text } = await build({ header: { right: { type: 'text', value: '{title} · {author} · {subtitle}' } } });
    const header = await text('word/header1.xml');
    expect(header).toContain('Report &amp; co');
    expect(header).toContain('Ada &lt;Lovelace&gt;');
  });

  it('sectPr: A4, margini in twip, titlePg con skipFirstPage', async () => {
    const { text } = await build({ footer: { skipFirstPage: true } });
    const doc = await text('word/document.xml');
    expect(doc).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(doc).toContain('w:top="1417"');
    expect(doc).toContain('<w:titlePg/>');
    expect(doc).toContain('r:id="rIdMdpressFooter"');
    expect(doc).not.toContain('footnotePr');
  });

  it('con la copertina la prima pagina è senza testata e piè di pagina anche se skipFirstPage è false', async () => {
    const { text } = await build({ header: { right: { type: 'text', value: 'x' } } }, { cover: true });
    const doc = await text('word/document.xml');
    expect(doc).toContain('<w:titlePg/>');
    expect(doc).toContain('w:type="default"');
    expect(doc).not.toContain('w:type="first"');
  });

  it('orizzontale: scambia le dimensioni', async () => {
    const { text } = await build({ page: { orientation: 'landscape' } });
    expect(await text('word/document.xml')).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>');
  });

  it('logo in testata: media, relazioni, content type e dimensioni', async () => {
    const { docx, text } = await build(
      { header: { left: { type: 'logo' } } },
      { logo: { data: makePng(30, 10), ext: 'png' } },
    );
    expect((await JSZip.loadAsync(docx)).file('word/media/mdpress-logo.png')).not.toBeNull();
    expect(await text('word/_rels/header1.xml.rels')).toContain('media/mdpress-logo.png');
    expect(await text('[Content_Types].xml')).toContain('Extension="png"');
    const header = await text('word/header1.xml');
    expect(header).toContain('cy="432000"');
    expect(header).toContain('cx="1296000"');
  });

  it('con la copertina il titolo è distanziato e l’indice va a pagina nuova', async () => {
    const { text } = await build({}, { cover: true });
    const styles = await text('word/styles.xml');
    expect(styles).toMatch(/w:styleId="Title"[\s\S]*?w:before="2400"/);
    expect(styles).toMatch(/w:styleId="TOCHeading"[\s\S]*?<w:pageBreakBefore\/>/);
  });
});

describe('finalizeDocx', () => {
  it('aggiunge updateFields prima di w:compat, una sola volta', async () => {
    const once = await finalizeDocx(await minimalBase(), { updateFields: true });
    const twice = await finalizeDocx(once, { updateFields: true });
    const settings = (await unzipText(twice, 'word/settings.xml')) ?? '';
    expect(settings.match(/w:updateFields/g)).toHaveLength(1);
    expect(settings.indexOf('w:updateFields')).toBeLessThan(settings.indexOf('<w:compat'));
  });
  it('senza indice non cambia nulla', async () => {
    const base = await minimalBase();
    expect(await finalizeDocx(base, { updateFields: false })).toBe(base);
  });
});
