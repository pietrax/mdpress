import JSZip from 'jszip';
import { imageSize } from 'image-size';
import type { DocMeta } from './frontmatter.js';
import { PAGE_SIZES_MM, SCALE, lighten, parsePlaceholders, type Band, type Slot, type Template } from './theme.js';

export interface DocxContext {
  template: Template;
  meta: DocMeta & { title: string };
  cover: boolean;
  logo: { data: Buffer; ext: 'png' | 'jpg' } | null;
}

const PART_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const LOGO_REL_ID = 'rIdMdpressLogo';

export function xmlEscape(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const halfPt = (pt: number) => Math.round(pt * 2);
const twips = (mm: number) => Math.round((mm / 25.4) * 1440);
const emu = (mm: number) => Math.round(mm * 36000);
const hex = (color: string) => color.slice(1).toUpperCase();
const fonts = (name: string) => {
  const n = xmlEscape(name);
  return `<w:rFonts w:ascii="${n}" w:hAnsi="${n}" w:eastAsia="${n}" w:cs="${n}"/>`;
};
const color = (c: string) => `<w:color w:val="${hex(c)}"/>`;
const size = (pt: number) => `<w:sz w:val="${halfPt(pt)}"/><w:szCs w:val="${halfPt(pt)}"/>`;

interface StyleDef {
  type: 'paragraph' | 'character' | 'table';
  id: string;
  name: string;
  basedOn?: string;
  next?: string;
  custom?: boolean;
  isDefault?: boolean;
  pPr?: string;
  rPr?: string;
  extra?: string;
}

function styleXml(d: StyleDef): string {
  return (
    `<w:style w:type="${d.type}"${d.isDefault ? ' w:default="1"' : ''}${d.custom ? ' w:customStyle="1"' : ''} w:styleId="${d.id}">` +
    `<w:name w:val="${d.name}"/>` +
    (d.basedOn ? `<w:basedOn w:val="${d.basedOn}"/>` : '') +
    (d.next ? `<w:next w:val="${d.next}"/>` : '') +
    '<w:qFormat/>' +
    (d.pPr ? `<w:pPr>${d.pPr}</w:pPr>` : '') +
    (d.rPr ? `<w:rPr>${d.rPr}</w:rPr>` : '') +
    (d.extra ?? '') +
    '</w:style>'
  );
}

function tableStyle(t: Template): StyleDef {
  const border = hex(lighten(t.colors.muted, 0.5));
  const side = (s: string) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${border}"/>`;
  const band = t.blocks.tableStriped
    ? `<w:tblStylePr w:type="band2Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${hex(lighten(t.colors.accent, 0.9))}"/></w:tcPr></w:tblStylePr>`
    : '';
  return {
    type: 'table',
    id: 'Table',
    name: 'Table',
    isDefault: true,
    basedOn: 'TableNormal',
    extra:
      '<w:tblPr><w:tblStyleRowBandSize w:val="1"/>' +
      `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side).join('')}</w:tblBorders>` +
      '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="${hex(t.colors.accent)}"/></w:tcBorders></w:tcPr></w:tblStylePr>` +
      band,
  };
}

function buildStyles(ctx: DocxContext): StyleDef[] {
  const t = ctx.template;
  const s = t.fonts.size;
  const c = t.colors;
  const k = ctx.cover ? 1 : 0.75;
  const heading = (level: number, scale: number, before: number): StyleDef => ({
    type: 'paragraph',
    id: `Heading${level}`,
    name: `heading ${level}`,
    basedOn: 'Normal',
    next: 'BodyText',
    pPr: `<w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/>`,
    rPr: `${fonts(t.fonts.heading)}<w:b/><w:bCs/>${color(c.heading)}${size(s * scale)}`,
  });
  const quotePPr = t.blocks.quoteBar
    ? `<w:pBdr><w:left w:val="single" w:sz="16" w:space="8" w:color="${hex(c.accent)}"/></w:pBdr><w:spacing w:before="100" w:after="100"/><w:ind w:left="284"/>`
    : '<w:spacing w:before="100" w:after="100"/><w:ind w:left="480" w:right="480"/>';
  return [
    { type: 'paragraph', id: 'Normal', name: 'Normal', isDefault: true, rPr: `${fonts(t.fonts.body)}${color(c.text)}${size(s)}` },
    heading(1, SCALE.h1, 480),
    heading(2, SCALE.h2, 360),
    heading(3, SCALE.h3, 280),
    heading(4, 1, 240),
    heading(5, 1, 240),
    heading(6, 1, 240),
    {
      type: 'paragraph',
      id: 'Title',
      name: 'Title',
      basedOn: 'Normal',
      next: 'BodyText',
      pPr: `<w:spacing w:before="${ctx.cover ? 2400 : 0}" w:after="${ctx.cover ? 240 : 120}"/>`,
      rPr: `${fonts(t.fonts.heading)}<w:b/><w:bCs/>${color(c.heading)}${size(s * SCALE.title * k)}`,
    },
    {
      type: 'paragraph',
      id: 'Subtitle',
      name: 'Subtitle',
      basedOn: 'Normal',
      next: 'BodyText',
      pPr: `<w:spacing w:after="${ctx.cover ? 480 : 160}"/>`,
      rPr: `${fonts(t.fonts.heading)}${color(c.muted)}${size(s * SCALE.subtitle * k)}`,
    },
    { type: 'paragraph', id: 'Author', name: 'Author', custom: true, basedOn: 'Normal', next: 'BodyText', pPr: '<w:spacing w:after="40"/>', rPr: size(s * SCALE.meta) },
    { type: 'paragraph', id: 'Date', name: 'Date', custom: true, basedOn: 'Normal', next: 'BodyText', pPr: '<w:spacing w:after="240"/>', rPr: `${color(c.muted)}${size(s * SCALE.meta)}` },
    { type: 'paragraph', id: 'BlockText', name: 'Block Text', basedOn: 'BodyText', next: 'BodyText', pPr: quotePPr, rPr: t.blocks.quoteBar ? undefined : color(c.muted) },
    {
      type: 'paragraph',
      id: 'SourceCode',
      name: 'Source Code',
      custom: true,
      basedOn: 'Normal',
      pPr: `<w:shd w:val="clear" w:color="auto" w:fill="${hex(t.blocks.codeBackground)}"/><w:wordWrap w:val="off"/><w:spacing w:before="0" w:after="0"/>`,
      rPr: `${fonts(t.fonts.mono)}${size(s * 0.9)}`,
    },
    { type: 'character', id: 'VerbatimChar', name: 'Verbatim Char', custom: true, rPr: `${fonts(t.fonts.mono)}${size(s * 0.9)}` },
    { type: 'character', id: 'Hyperlink', name: 'Hyperlink', rPr: `${color(c.accent)}<w:u w:val="single"/>` },
    {
      type: 'paragraph',
      id: 'TOCHeading',
      name: 'TOC Heading',
      basedOn: 'Heading1',
      next: 'BodyText',
      pPr: `${ctx.cover ? '<w:pageBreakBefore/>' : ''}<w:outlineLvl w:val="9"/>`,
    },
    tableStyle(t),
  ];
}

function replaceStyles(xml: string, defs: StyleDef[], t: Template): string {
  let out = xml;
  for (const d of defs) {
    out = out.replace(new RegExp(`<w:style\\b[^>]*w:styleId="${d.id}"[^>]*>[\\s\\S]*?</w:style>`), '');
  }
  out = out.replace(
    /<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/,
    () => `<w:rPrDefault><w:rPr>${fonts(t.fonts.body)}${size(t.fonts.size)}<w:lang w:val="it-IT" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`,
  );
  return out.replace('</w:styles>', () => `${defs.map(styleXml).join('')}</w:styles>`);
}

function pageDims(t: Template): { w: number; h: number } {
  const [w, h] = PAGE_SIZES_MM[t.page.size];
  return t.page.orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

function isBlank(slot: Slot, ctx: DocxContext): boolean {
  return slot.type === 'empty' || (slot.type === 'logo' && !ctx.logo) || (slot.type === 'text' && slot.value.trim() === '');
}

function textRun(text: string, rPr: string): string {
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function slotRuns(value: string, ctx: DocxContext, rPr: string): string {
  return parsePlaceholders(value)
    .map((seg) => {
      if (seg.kind === 'text') return textRun(seg.value, rPr);
      if (seg.name === 'page' || seg.name === 'pages') {
        return `<w:fldSimple w:instr="${seg.name === 'page' ? 'PAGE' : 'NUMPAGES'}">${textRun('1', rPr)}</w:fldSimple>`;
      }
      const v = ctx.meta[seg.name];
      return v ? textRun(v, rPr) : '';
    })
    .join('');
}

function logoDrawing(logo: NonNullable<DocxContext['logo']>, heightMm: number, docPrId: number): string {
  const dims = imageSize(logo.data);
  const cy = emu(heightMm);
  const cx = Math.round((cy * (dims.width ?? 1)) / (dims.height ?? 1));
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="mdpress-logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="logo"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${LOGO_REL_ID}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

function bandXml(b: Band, kind: 'hdr' | 'ftr', ctx: DocxContext, docPrId: number): string | null {
  const t = ctx.template;
  const slots = [b.left, b.center, b.right];
  if (!b.rule && slots.every((s) => isBlank(s, ctx))) return null;
  const rPr = `<w:rPr>${color(t.colors.muted)}${size(t.fonts.size * SCALE.small)}</w:rPr>`;
  const { w } = pageDims(t);
  const col = Math.floor(twips(w - t.page.margins.left - t.page.margins.right) / 3);
  const jc = ['left', 'center', 'right'];
  const cells = slots
    .map((slot, i) => {
      const inner =
        slot.type === 'text'
          ? slotRuns(slot.value, ctx, rPr)
          : slot.type === 'logo' && ctx.logo
            ? logoDrawing(ctx.logo, t.logo.height, docPrId)
            : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${jc[i]}"/></w:pPr>${inner}</w:p></w:tc>`;
    })
    .join('');
  const nil = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="nil"/>`).join('');
  const table =
    `<w:tbl><w:tblPr><w:tblW w:w="${col * 3}" w:type="dxa"/><w:tblBorders>${nil}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
    '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${`<w:gridCol w:w="${col}"/>`.repeat(3)}</w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;
  const edge = kind === 'hdr' ? 'bottom' : 'top';
  const rule = `<w:p><w:pPr><w:pBdr><w:${edge} w:val="single" w:sz="4" w:space="1" w:color="${hex(t.colors.accent)}"/></w:pBdr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
  // Word vuole un paragrafo dopo una tabella: quello del filetto, o uno vuoto e basso.
  const spacer = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>';
  const body = kind === 'hdr' ? table + (b.rule ? rule : spacer) : (b.rule ? rule : '') + table + spacer;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind} ${PART_NS}>${body}</w:${kind}>`;
}

function sectPr(ctx: DocxContext, has: { header: boolean; footer: boolean }): string {
  const t = ctx.template;
  const { w, h } = pageDims(t);
  const m = t.page.margins;
  const titlePg = (has.header && t.header.skipFirstPage) || (has.footer && t.footer.skipFirstPage);
  const parts: string[] = [];
  const refs = (tag: 'headerReference' | 'footerReference', id: string, skip: boolean) => {
    parts.push(`<w:${tag} w:type="default" r:id="${id}"/>`);
    if (titlePg && !skip) parts.push(`<w:${tag} w:type="first" r:id="${id}"/>`);
  };
  if (has.header) refs('headerReference', 'rIdMdpressHeader', t.header.skipFirstPage);
  if (has.footer) refs('footerReference', 'rIdMdpressFooter', t.footer.skipFirstPage);
  parts.push(`<w:pgSz w:w="${twips(w)}" w:h="${twips(h)}"${t.page.orientation === 'landscape' ? ' w:orient="landscape"' : ''}/>`);
  parts.push(
    `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" ` +
      `w:header="${twips(Math.min(12.5, m.top / 2))}" w:footer="${twips(Math.min(12.5, m.bottom / 2))}" w:gutter="0"/>`,
  );
  if (titlePg) parts.push('<w:titlePg/>');
  return `<w:sectPr>${parts.join('')}</w:sectPr>`;
}

export async function buildReferenceDocx(base: Buffer, ctx: DocxContext): Promise<Buffer> {
  const zip = await JSZip.loadAsync(base);
  const read = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`reference.docx: manca ${path}`);
    return file.async('string');
  };

  zip.file('word/styles.xml', replaceStyles(await read('word/styles.xml'), buildStyles(ctx), ctx.template));

  const header = bandXml(ctx.template.header, 'hdr', ctx, 9001);
  const footer = bandXml(ctx.template.footer, 'ftr', ctx, 9002);
  let rels = await read('word/_rels/document.xml.rels');
  let types = await read('[Content_Types].xml');
  const ext = ctx.logo?.ext ?? 'png';
  const logoRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="${LOGO_REL_ID}" Type="${REL_TYPE}/image" Target="media/mdpress-logo.${ext}"/></Relationships>`;
  let logoUsed = false;

  const parts = [
    { name: 'header1', xml: header, relId: 'rIdMdpressHeader', kind: 'header' },
    { name: 'footer1', xml: footer, relId: 'rIdMdpressFooter', kind: 'footer' },
  ] as const;
  for (const part of parts) {
    if (!part.xml) continue;
    zip.file(`word/${part.name}.xml`, part.xml);
    rels = rels.replace(
      '</Relationships>',
      () => `<Relationship Id="${part.relId}" Type="${REL_TYPE}/${part.kind}" Target="${part.name}.xml"/></Relationships>`,
    );
    types = types.replace(
      '</Types>',
      () => `<Override PartName="/word/${part.name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${part.kind}+xml"/></Types>`,
    );
    if (part.xml.includes(LOGO_REL_ID)) {
      zip.file(`word/_rels/${part.name}.xml.rels`, logoRels);
      logoUsed = true;
    }
  }
  if (ctx.logo && logoUsed) {
    zip.file(`word/media/mdpress-logo.${ext}`, ctx.logo.data);
    if (!new RegExp(`Extension="${ext}"`, 'i').test(types)) {
      types = types.replace('</Types>', () => `<Default Extension="${ext}" ContentType="${ext === 'png' ? 'image/png' : 'image/jpeg'}"/></Types>`);
    }
  }
  zip.file('word/_rels/document.xml.rels', rels);
  zip.file('[Content_Types].xml', types);

  const doc = await read('word/document.xml');
  const section = sectPr(ctx, { header: Boolean(header), footer: Boolean(footer) });
  const SECT_RE = /<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/;
  zip.file('word/document.xml', SECT_RE.test(doc) ? doc.replace(SECT_RE, () => section) : doc.replace('</w:body>', () => `${section}</w:body>`));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Elementi di settings.xml che nello schema seguono updateFields. */
const AFTER_UPDATE_FIELDS =
  /<(?:w:hdrShapeDefaults|w:footnotePr|w:endnotePr|w:compat|w:docVars|w:rsids|m:mathPr|w:attachedSchema|w:themeFontLang|w:clrSchemeMapping|w:doNotIncludeSubdocsInStats|w:doNotAutoCompressPictures|w:forceUpgrade|w:captions|w:readModeInkLockDown|w:smartTagType|sl:schemaLibrary|w:shapeDefaults|w:doNotEmbedSmartTags|w:decimalSymbol|w:listSeparator)\b/;

export async function finalizeDocx(docx: Buffer, opts: { updateFields: boolean }): Promise<Buffer> {
  if (!opts.updateFields) return docx;
  const zip = await JSZip.loadAsync(docx);
  const file = zip.file('word/settings.xml');
  if (!file) return docx;
  const xml = await file.async('string');
  if (xml.includes('w:updateFields')) return docx;
  const tag = '<w:updateFields w:val="true"/>';
  const match = AFTER_UPDATE_FIELDS.exec(xml);
  const updated =
    match && match.index !== undefined
      ? xml.slice(0, match.index) + tag + xml.slice(match.index)
      : xml.replace('</w:settings>', () => `${tag}</w:settings>`);
  zip.file('word/settings.xml', updated);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
