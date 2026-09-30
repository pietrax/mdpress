import en from './locales/en.json' with { type: 'json' };
import it from './locales/it.json' with { type: 'json' };

export const LANGUAGES = ['en', 'it'] as const;
export type Language = (typeof LANGUAGES)[number];
export type Params = Record<string, string | number>;

type Tree = { [key: string]: string | Tree };
const CATALOGUES: Record<Language, Tree> = { en, it };

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** 'it_IT.UTF-8', 'it-IT', 'IT' → 'it'; anything unsupported → null. */
export function normalizeLanguage(value: string | undefined | null): Language | null {
  if (!value) return null;
  const code = value.trim().toLowerCase().split(/[_.@-]/)[0];
  return isLanguage(code) ? code : null;
}

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Translated text for `key`, falling back to English and then to the key itself. */
export function t(key: string, params: Params = {}, lang: Language = 'en'): string {
  const template = lookup(CATALOGUES[lang], key) ?? lookup(CATALOGUES.en, key) ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
