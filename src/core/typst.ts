import { SCALE, lighten, parsePlaceholders, type Band, type CoverFieldName, type Slot, type Template } from './theme.js';

export interface TypstContext {
  template: Template;
  logoPath: string | null;
  cover: boolean;
  toc: boolean;
  fallbackTitle: string;
  /** Font families Typst can see (from `typst fonts`); used to resolve names like "DM Sans" → "DM Sans 9pt". */
  fonts?: readonly string[];
}

/**
 * Typst names variable fonts after their default instance (e.g. "DM Sans 9pt"), while Word and the
 * system call the family "DM Sans". Returns the name Typst knows, or the input unchanged.
 */
export function resolveTypstFont(name: string, available: readonly string[]): string {
  const wanted = name.trim().toLowerCase();
  const exact = available.find((f) => f.toLowerCase() === wanted);
  if (exact) return exact;
  const variant = available.find((f) => f.toLowerCase().startsWith(`${wanted} `));
  return variant ?? name;
}

function fontList(name: string, ctx: TypstContext): string {
  return `(${typstString(ctx.fonts ? resolveTypstFont(name, ctx.fonts) : name)},)`;
}

const PAPER: Record<Template['page']['size'], string> = { A4: 'a4', A5: 'a5', Letter: 'us-letter' };

const FIELD_EXPR = {
  title: 'meta-title',
  subtitle: 'meta-subtitle',
  author: 'meta-author',
  date: 'meta-date',
  page: 'counter(page).display()',
  pages: 'str(counter(page).final().first())',
} as const;

/** Quoted Typst string, also safe inside a pandoc template ($ → $$). */
export function typstString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
  return `"${escaped}"`.replace(/\$/g, '$$$$');
}

/** Slot text with placeholders → Typst content block. */
export function textContent(text: string): string {
  const parts = parsePlaceholders(text).map((s) =>
    s.kind === 'text' ? `#${typstString(s.value)}` : `#${FIELD_EXPR[s.name]}`,
  );
  return `[${parts.join('')}]`;
}

const pt = (n: number) => `${Math.round(n * 100) / 100}pt`;

function isBlank(slot: Slot, ctx: TypstContext): boolean {
  return (
    slot.type === 'empty' ||
    (slot.type === 'logo' && !ctx.logoPath) ||
    (slot.type === 'text' && slot.value.trim() === '')
  );
}

function slotContent(slot: Slot, ctx: TypstContext): string {
  if (slot.type === 'text') return textContent(slot.value);
  if (slot.type === 'logo' && ctx.logoPath) {
    // Shrink the logo to the column width instead of letting it overflow and get clipped.
    const path = typstString(ctx.logoPath);
    return (
      `layout(size => { let img = image(${path}, height: ${ctx.template.logo.height}mm); ` +
      `if measure(img).width > size.width { image(${path}, width: size.width) } else { img } })`
    );
  }
  return '[]';
}

function band(b: Band, ctx: TypstContext, kind: 'header' | 'footer'): string {
  const slots = [b.left, b.center, b.right];
  if (!b.rule && slots.every((s) => isBlank(s, ctx))) return 'none';
  // Only the center slot in use: give it the whole width (one line, logo not squeezed into a third).
  const centerOnly = isBlank(b.left, ctx) && isBlank(b.right, ctx);
  const grid = centerOnly
    ? `grid(columns: (1fr,), align: (center + horizon,), ${slotContent(b.center, ctx)})`
    : 'grid(columns: (1fr, 1fr, 1fr), align: (left + horizon, center + horizon, right + horizon), ' +
      `${slots.map((s) => slotContent(s, ctx)).join(', ')})`;
  const rule = 'line(length: 100%, stroke: 0.5pt + c-accent)';
  const items = b.rule ? (kind === 'header' ? [grid, rule] : [rule, grid]) : [grid];
  const condition = b.skipFirstPage ? 'here().page() > 1' : 'true';
  const size = pt(b.textSize ?? ctx.template.fonts.size * SCALE.small);
  const weight = b.bold ? 'bold' : 'regular';
  return `context { if ${condition} { set text(size: ${size}, weight: "${weight}", fill: c-muted); stack(spacing: 4pt, ${items.join(', ')}) } }`;
}

function fieldLine(field: CoverFieldName, size: number, mode: 'cover' | 'block'): string {
  const k = mode === 'cover' ? 1 : 0.75;
  switch (field) {
    case 'title':
      return `  #block(below: 4mm, text(size: ${pt(size * SCALE.title * k)}, weight: "bold", fill: c-heading, meta-title))`;
    case 'subtitle':
      return `$if(subtitle)$\n  #block(below: 6mm, text(size: ${pt(size * SCALE.subtitle * k)}, fill: c-muted, meta-subtitle))\n$endif$`;
    case 'author':
      return `$if(author)$\n  #block(below: 2mm, text(size: ${pt(size * SCALE.meta)}, meta-author))\n$endif$`;
    case 'date':
      return `$if(date)$\n  #block(below: 2mm, text(size: ${pt(size * SCALE.meta)}, fill: c-muted, meta-date))\n$endif$`;
  }
}

function coverPage(ctx: TypstContext): string {
  const t = ctx.template;
  const lines = ['#page(header: none, footer: none)['];
  if (t.cover.showLogo && ctx.logoPath) {
    lines.push(`  #image(${typstString(ctx.logoPath)}, height: ${t.logo.height * 2}mm)`);
  }
  lines.push('  #v(1fr)');
  for (const field of t.cover.fields) lines.push(fieldLine(field, t.fonts.size, 'cover'));
  lines.push('  #v(2fr)', ']');
  return lines.join('\n');
}

/** Without a cover: compact title block, only if the front-matter has a title. */
function titleBlock(ctx: TypstContext): string {
  const t = ctx.template;
  const lines = ['$if(title)$', '#block(below: 10mm)['];
  for (const field of t.cover.fields) lines.push(fieldLine(field, t.fonts.size, 'block'));
  lines.push(']', '$endif$');
  return lines.join('\n');
}

export function buildTypstTemplate(ctx: TypstContext): string {
  const t = ctx.template;
  const s = t.fonts.size;
  const m = t.page.margins;
  const c = t.colors;
  const quote = t.blocks.quoteBar
    ? '#show quote.where(block: true): it => block(stroke: (left: 2pt + c-accent), inset: (left: 10pt, y: 4pt), it.body)'
    : '#show quote.where(block: true): it => block(inset: (left: 14pt, y: 4pt), text(fill: c-muted, it.body))';
  const striped = t.blocks.tableStriped
    ? `, fill: (_, y) => if y > 0 and calc.even(y) { rgb("${lighten(c.accent, 0.9)}") }`
    : '';

  const lines = [
    '// Generated by mdpress: do not edit by hand.',
    '#let horizontalRule = line(start: (25%, 0%), end: (75%, 0%))',
    '#let divider = if "divider" in std { divider } else { horizontalRule }',
    '$if(highlighting-definitions)$',
    '$highlighting-definitions$',
    '$endif$',
    `#let meta-title = [$if(title)$$title$$else$#${typstString(ctx.fallbackTitle)}$endif$]`,
    '#let meta-subtitle = [$if(subtitle)$$subtitle$$endif$]',
    '#let meta-author = [$for(author)$$author$$sep$, $endfor$]',
    '#let meta-date = [$if(date)$$date$$endif$]',
    `#let c-text = rgb("${c.text}")`,
    `#let c-heading = rgb("${c.heading}")`,
    `#let c-accent = rgb("${c.accent}")`,
    `#let c-muted = rgb("${c.muted}")`,
    '#set document(title: meta-title)',
    `#set page(paper: "${PAPER[t.page.size]}", flipped: ${t.page.orientation === 'landscape'}, ` +
      `margin: (top: ${m.top}mm, bottom: ${m.bottom}mm, left: ${m.left}mm, right: ${m.right}mm), ` +
      `header: ${band(t.header, ctx, 'header')}, footer: ${band(t.footer, ctx, 'footer')})`,
    `#set text(font: ${fontList(t.fonts.body, ctx)}, size: ${pt(s)}, fill: c-text, lang: "${t.language}")`,
    '#set par(leading: 0.7em, spacing: 1.2em)',
    `#show raw: set text(font: ${fontList(t.fonts.mono, ctx)})`,
    `#show heading: set text(font: ${fontList(t.fonts.heading, ctx)}, fill: c-heading)`,
    '#show heading: set block(above: 1.6em, below: 0.9em)',
    `#show heading.where(level: 1): set text(size: ${pt(s * SCALE.h1)})`,
    `#show heading.where(level: 2): set text(size: ${pt(s * SCALE.h2)})`,
    `#show heading.where(level: 3): set text(size: ${pt(s * SCALE.h3)})`,
    `#show heading.where(level: 4): set text(size: ${pt(s)})`,
    `#show heading.where(level: 5): set text(size: ${pt(s)})`,
    `#show heading.where(level: 6): set text(size: ${pt(s)})`,
    t.headings.numbered ? '#set heading(numbering: (..n) => if n.pos().len() <= 3 { numbering("1.1.1.", ..n) })' : '',
    '#show link: set text(fill: c-accent)',
    `#show raw.where(block: true): it => block(fill: rgb("${t.blocks.codeBackground}"), inset: 8pt, radius: 3pt, width: 100%, it)`,
    quote,
    `#set table(inset: 6pt, stroke: 0.5pt + rgb("${lighten(c.muted, 0.5)}")${striped})`,
    '#show figure.where(kind: table): set figure.caption(position: top)',
    ctx.cover ? coverPage(ctx) : titleBlock(ctx),
    ctx.toc ? '#outline(depth: 3)\n#pagebreak(weak: true)' : '',
    '$body$',
  ];
  return lines.filter((line) => line !== '').join('\n') + '\n';
}
