import { useEffect, useState } from 'react';
import { api, type DepStatus } from './api';
import { ConvertPage } from './pages/ConvertPage';
import { TemplatesPage } from './pages/TemplatesPage';

type Tab = 'convert' | 'templates';

export function App() {
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
            Converti
          </button>
          <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>
            Template
          </button>
        </nav>
      </header>
      {missing.length > 0 && (
        <div className="banner">
          Dipendenze mancanti: {missing.map((d) => d.name).join(', ')}. Installa con <code>brew install pandoc typst</code>.
        </div>
      )}
      <main>{tab === 'convert' ? <ConvertPage /> : <TemplatesPage />}</main>
    </div>
  );
}
