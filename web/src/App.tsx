import { useEffect, useState } from 'react';
import { api, type DepStatus } from './api';
import { LanguageSelector, useI18n } from './i18n';
import { ConvertPage } from './pages/ConvertPage';
import { TemplatesPage } from './pages/TemplatesPage';

type Tab = 'convert' | 'templates';

export function App() {
  const { t: tr } = useI18n();
  const [tab, setTab] = useState<Tab>('convert');
  const [deps, setDeps] = useState<DepStatus[]>([]);

  useEffect(() => {
    api.doctor().then(setDeps).catch(() => setDeps([]));
  }, []);

  const missing = deps.filter((d) => !d.ok);

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">mdpress</strong>
        <nav>
          <button className={tab === 'convert' ? 'active' : ''} onClick={() => setTab('convert')}>
            {tr('web.nav.convert')}
          </button>
          <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>
            {tr('web.nav.templates')}
          </button>
        </nav>
        <LanguageSelector />
      </header>
      {missing.length > 0 && (
        <div className="banner">
          {tr('web.deps.missing', { names: missing.map((d) => d.name).join(', ') })} {tr('web.deps.install')} <code>brew install pandoc typst</code>.
        </div>
      )}
      <main>{tab === 'convert' ? <ConvertPage /> : <TemplatesPage />}</main>
    </div>
  );
}
