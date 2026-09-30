import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LANGUAGES, isLanguage, normalizeLanguage, t, type Language, type Params } from '../../src/i18n/index.js';
import { api, setApiLanguage } from './api';

const STORAGE_KEY = 'mdpress.language';

function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

interface I18n {
  lang: Language;
  setLang(lang: Language): void;
  t(key: string, params?: Params): string;
}

const I18nContext = createContext<I18n>({ lang: 'en', setLang: () => {}, t: (key, params) => t(key, params, 'en') });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(
    () => storedLanguage() ?? normalizeLanguage(navigator.language) ?? 'en',
  );

  // Set synchronously so the first requests made by child effects already carry the header.
  setApiLanguage(lang);

  useEffect(() => {
    if (storedLanguage()) return;
    api
      .settings()
      .then((s) => {
        if (!storedLanguage() && isLanguage(s.language)) setLangState(s.language);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: keep the choice for this session only */
    }
    api.saveSettings({ language: next }).catch(() => {});
  }, []);

  const value = useMemo<I18n>(() => ({ lang, setLang, t: (key, params) => t(key, params, lang) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

export function LanguageSelector() {
  const { lang, setLang, t: tr } = useI18n();
  return (
    <select aria-label={tr('web.language.label')} value={lang} onChange={(e) => setLang(e.target.value as Language)}>
      {LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
