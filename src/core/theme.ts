import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import { LANGUAGES } from '../i18n/index.js';
import { MdpressError, type Issue } from './errors.js';

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const ID_RE = /^[a-z0-9]{8}$/;
export const LOGO_FILE_RE = /^logo\.(png|jpg)$/;
export const newId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const range = (min: number, max: number) =>
  z.number().min(min).max(max);
const fontName = z.string().min(1).max(100);

const SlotSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('empty') }),
  z.object({ type: z.literal('logo') }),
  z.object({ type: z.literal('text'), value: z.string().max(200) }),
]);

const BandSchema = z.object({
  left: SlotSchema,
  center: SlotSchema,
  right: SlotSchema,
  rule: z.boolean(),
  skipFirstPage: z.boolean(),
});

const CoverFieldSchema = z.enum(['title', 'subtitle', 'author', 'date']);

export const TemplateSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(ID_RE),
  slug: z.string().regex(SLUG_RE),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  language: z.enum(LANGUAGES),
  page: z.object({
    size: z.enum(['A4', 'A5', 'Letter']),
    orientation: z.enum(['portrait', 'landscape']),
    margins: z.object({ top: range(0, 80), bottom: range(0, 80), left: range(0, 80), right: range(0, 80) }),
  }),
  colors: z.object({ text: hex, heading: hex, accent: hex, muted: hex }),
  fonts: z.object({ body: fontName, heading: fontName, mono: fontName, size: range(8, 16) }),
  headings: z.object({ numbered: z.boolean() }),
  header: BandSchema,
  footer: BandSchema,
  logo: z.object({
    file: z.string().regex(LOGO_FILE_RE).nullable(),
    height: range(4, 60),
  }),
  cover: z.object({ enabled: z.boolean(), showLogo: z.boolean(), fields: z.array(CoverFieldSchema) }),
  blocks: z.object({ tableStriped: z.boolean(), codeBackground: hex, quoteBar: z.boolean() }),
});

export type Template = z.infer<typeof TemplateSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export type Band = Template['header'];
export type CoverFieldName = z.infer<typeof CoverFieldSchema>;

export const DEFAULTS: Omit<Template, 'id' | 'slug' | 'name'> = {
  schemaVersion: 1,
  description: '',
  language: 'en',
  page: { size: 'A4', orientation: 'portrait', margins: { top: 25, bottom: 25, left: 20, right: 20 } },
  colors: { text: '#1f2328', heading: '#1f2328', accent: '#0969da', muted: '#6e7781' },
  fonts: { body: 'Helvetica Neue', heading: 'Helvetica Neue', mono: 'Menlo', size: 11 },
  headings: { numbered: false },
  header: { left: { type: 'empty' }, center: { type: 'empty' }, right: { type: 'empty' }, rule: false, skipFirstPage: false },
  footer: {
    left: { type: 'empty' },
    center: { type: 'empty' },
    right: { type: 'text', value: '{page} / {pages}' },
    rule: false,
    skipFirstPage: false,
  },
  logo: { file: null, height: 12 },
  cover: { enabled: false, showLogo: true, fields: ['title', 'subtitle', 'author', 'date'] },
  blocks: { tableStriped: false, codeBackground: '#f6f8fa', quoteBar: true },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursive merge: objects are merged; arrays and plain values from `over` replace. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return structuredClone(base);
  if (isPlainObject(base) && isPlainObject(over)) {
    const out: Record<string, unknown> = structuredClone(base);
    for (const [key, value] of Object.entries(over)) out[key] = deepMerge(base[key], value);
    return out;
  }
  return structuredClone(over);
}

type ZodIssue = z.core.$ZodIssue;

function formatKey(path: string): string {
  if (path === 'slug') return 'validation.slug';
  if (path === 'id') return 'validation.id';
  if (path === 'logo.file') return 'validation.logoFile';
  if (path.startsWith('colors.') || path === 'blocks.codeBackground') return 'validation.color';
  return 'validation.invalid';
}

function toIssue(issue: ZodIssue): Issue {
  const path = issue.path.join('.');
  switch (issue.code) {
    case 'too_big':
      return {
        path,
        key: issue.origin === 'number' ? 'validation.tooBig' : 'validation.tooLong',
        params: { max: Number(issue.maximum) },
      };
    case 'too_small':
      return issue.origin === 'number'
        ? { path, key: 'validation.tooSmall', params: { min: Number(issue.minimum) } }
        : { path, key: 'validation.required', params: {} };
    case 'invalid_type':
      if (issue.expected === 'number') return { path, key: 'validation.number', params: {} };
      if (issue.expected === 'boolean') return { path, key: 'validation.boolean', params: {} };
      return { path, key: 'validation.invalidType', params: { expected: String(issue.expected) } };
    case 'invalid_format':
      return { path, key: formatKey(path), params: {} };
    case 'invalid_value':
      return { path, key: 'validation.oneOf', params: { values: issue.values.map(String).join(', ') } };
    case 'invalid_union': {
      const options = (issue as { options?: unknown[] }).options;
      return Array.isArray(options)
        ? { path, key: 'validation.oneOf', params: { values: options.map(String).join(', ') } }
        : { path, key: 'validation.invalid', params: {} };
    }
    default:
      return { path, key: 'validation.invalid', params: {} };
  }
}

export function parseTemplate(input: unknown): Template {
  if (!isPlainObject(input)) {
    throw new MdpressError('errors.templateInvalid', 'TEMPLATE_INVALID', {}, [
      { path: '', key: 'validation.notObject', params: {} },
    ]);
  }
  const result = TemplateSchema.safeParse(deepMerge(DEFAULTS, input));
  if (!result.success) {
    throw new MdpressError('errors.templateInvalid', 'TEMPLATE_INVALID', {}, result.error.issues.map(toIssue));
  }
  return result.data;
}

export type FieldName = 'title' | 'subtitle' | 'author' | 'date' | 'page' | 'pages';
export type Segment = { kind: 'text'; value: string } | { kind: 'field'; name: FieldName };

const PLACEHOLDER_RE = /\{(title|subtitle|author|date|page|pages)\}/g;

export function parsePlaceholders(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ kind: 'text', value: text.slice(last, index) });
    out.push({ kind: 'field', name: m[1] as FieldName });
    last = index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** Multipliers relative to fonts.size, shared by PDF and DOCX. */
export const SCALE = { h1: 2, h2: 1.5, h3: 1.25, title: 2.7, subtitle: 1.45, meta: 1.1, small: 0.82 } as const;

export const PAGE_SIZES_MM: Record<Template['page']['size'], [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
};

export function lighten(color: string, amount: number): string {
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const mixed = channels.map((c) => Math.round(c + (255 - c) * amount));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
