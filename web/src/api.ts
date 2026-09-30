import type { Template } from '../../src/core/theme.js';

export type { Template };
export type TemplateSummary = Template & { builtin: boolean; hasLogo: boolean };

export interface Issue {
  path: string;
  message: string;
}

export interface DepStatus {
  name: string;
  found: boolean;
  version: string | null;
  min: string;
  ok: boolean;
}

export interface RenderBody {
  markdown: string;
  filename: string;
  template?: string;
  format: 'pdf' | 'docx';
  toc: boolean;
  cover?: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-mdpress', '1');
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let body: { error?: string; errors?: Issue[] } = {};
    try {
      body = await res.json();
    } catch {
      /* risposta non JSON */
    }
    throw new ApiError(body.error ?? `Errore ${res.status}`, res.status, body.errors ?? []);
  }
  return res;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

function filenameFrom(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(header);
  return m ? decodeURIComponent(m[1]) : fallback;
}

function warningsFrom(res: Response): string[] {
  const header = res.headers.get('x-mdpress-warnings');
  if (!header) return [];
  try {
    return JSON.parse(decodeURIComponent(header)) as string[];
  } catch {
    return [];
  }
}

export const api = {
  listTemplates: () => json<TemplateSummary[]>('/api/templates'),
  createTemplate: (slug: string, name: string) =>
    json<TemplateSummary>('/api/templates', { method: 'POST', body: JSON.stringify({ slug, name }) }),
  duplicateTemplate: (from: string, slug: string, name: string) =>
    json<TemplateSummary>('/api/templates', { method: 'POST', body: JSON.stringify({ from, slug, name }) }),
  updateTemplate: (ref: string, template: Template) =>
    json<TemplateSummary>(`/api/templates/${ref}`, { method: 'PUT', body: JSON.stringify(template) }),
  deleteTemplate: async (ref: string) => {
    await request(`/api/templates/${ref}`, { method: 'DELETE' });
  },
  uploadLogo: (ref: string, file: File) =>
    json<TemplateSummary>(`/api/templates/${ref}/logo`, { method: 'PUT', body: file, headers: { 'content-type': file.type } }),
  importTemplate: (file: File) =>
    json<TemplateSummary>('/api/templates/import', { method: 'POST', body: file, headers: { 'content-type': 'application/zip' } }),
  exportUrl: (ref: string) => `/api/templates/${ref}/export`,
  logoUrl: (ref: string, v: string) => `/api/templates/${ref}/logo?v=${encodeURIComponent(v)}`,
  thumbnailUrl: (ref: string, v: string) => `/api/templates/${ref}/thumbnail.png?v=${encodeURIComponent(v)}`,
  preview: async (template: Template, ref: string) =>
    (await request('/api/preview', { method: 'POST', body: JSON.stringify({ template, ref }) })).blob(),
  render: async (body: RenderBody) => {
    const res = await request('/api/render', { method: 'POST', body: JSON.stringify(body) });
    const fallback = `${body.filename.replace(/\.(md|markdown)$/i, '')}.${body.format}`;
    return { blob: await res.blob(), filename: filenameFrom(res, fallback), warnings: warningsFrom(res) };
  },
  fonts: () => json<string[]>('/api/fonts'),
  doctor: () => json<DepStatus[]>('/api/doctor'),
};
