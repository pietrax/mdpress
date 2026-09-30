import { MdpressError } from './errors.js';
import type { DocMeta } from './frontmatter.js';
import type { Template } from './theme.js';

export type Format = 'pdf' | 'docx';

export interface RenderOverrides {
  toc?: boolean;
  cover?: boolean;
}

export interface EffectiveOptions {
  toc: boolean;
  cover: boolean;
}

export function resolveOptions(template: Template, meta: DocMeta, overrides: RenderOverrides): EffectiveOptions {
  return {
    toc: overrides.toc ?? meta.toc ?? false,
    cover: overrides.cover ?? meta.cover ?? template.cover.enabled,
  };
}

export function parseFormats(value: string): Format[] {
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new MdpressError('Indica almeno un formato: pdf o docx', 'BAD_INPUT');
  const formats: Format[] = [];
  for (const part of parts) {
    if (part !== 'pdf' && part !== 'docx') {
      throw new MdpressError(`Formato non supportato: ${part} (usa pdf, docx o pdf,docx)`, 'BAD_INPUT');
    }
    if (!formats.includes(part)) formats.push(part);
  }
  return formats;
}
