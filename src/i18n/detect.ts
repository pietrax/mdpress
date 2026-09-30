import { LANGUAGES, isLanguage, normalizeLanguage, type Language } from './index.js';

export class UnsupportedLanguageError extends Error {
  constructor(readonly value: string) {
    super(`Unsupported language: ${value} (supported: ${LANGUAGES.join(', ')})`);
    this.name = 'UnsupportedLanguageError';
  }
}

export interface LanguageSources {
  flag?: string;
  config?: unknown;
  env?: Record<string, string | undefined>;
}

/** App language: --lang flag, then config.json, then LC_ALL / LC_MESSAGES / LANG, then English. */
export function detectLanguage({ flag, config, env = {} }: LanguageSources): Language {
  if (flag !== undefined) {
    if (!isLanguage(flag)) throw new UnsupportedLanguageError(flag);
    return flag;
  }
  if (isLanguage(config)) return config;
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name];
    if (value) {
      const lang = normalizeLanguage(value);
      if (lang) return lang;
      // A set but unsupported variable (e.g. LANG=C) stops the search, like POSIX locale precedence.
      return 'en';
    }
  }
  return 'en';
}
