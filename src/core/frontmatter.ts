import { parse } from 'yaml';
import { MdpressError } from './errors.js';

export interface DocMeta {
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  toc?: boolean;
  cover?: boolean;
}

const FRONTMATTER_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Plain text for DOCX headers and placeholders: lists joined with ", ", no * or `. */
function plain(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map(plain).filter((s): s is string => Boolean(s));
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof value === 'object') return plain((value as Record<string, unknown>).name);
  const text = String(value).replace(/[*`]/g, '').trim();
  return text || undefined;
}

const bool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

export function readFrontmatter(markdown: string): DocMeta {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return {};
  let data: unknown;
  try {
    data = parse(match[1]);
  } catch (err) {
    throw new MdpressError('errors.frontmatterInvalid', 'BAD_INPUT', { details: (err as Error).message });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const d = data as Record<string, unknown>;
  const meta: DocMeta = {
    title: plain(d.title),
    subtitle: plain(d.subtitle),
    author: plain(d.author),
    date: plain(d.date),
    toc: bool(d.toc),
    cover: bool(d.cover),
  };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as DocMeta;
}
