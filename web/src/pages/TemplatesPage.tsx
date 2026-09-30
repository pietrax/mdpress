import { useCallback, useEffect, useRef, useState } from 'react';
import { slugify, uniqueSlug } from '../../../src/core/slug.js';
import { api, type TemplateSummary } from '../api';
import { TemplateEditor } from './TemplateEditor';

export function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [editing, setEditing] = useState<TemplateSummary | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(() => String(Date.now()));
  const importRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      setTemplates(await api.listTemplates());
      setVersion(String(Date.now()));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const taken = templates.map((t) => t.slug);

  async function act(fn: () => Promise<void>) {
    try {
      setError(null);
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const create = () =>
    act(async () => {
      const name = newName.trim();
      if (!name) return;
      const created = await api.createTemplate(uniqueSlug(slugify(name), taken), name);
      setNewName('');
      await reload();
      setEditing(created);
    });

  const duplicate = (t: TemplateSummary) =>
    act(async () => {
      const name = window.prompt('Nome della copia', `${t.name} (copia)`);
      if (!name) return;
      const copy = await api.duplicateTemplate(t.id, uniqueSlug(slugify(name), taken), name);
      await reload();
      setEditing(copy);
    });

  const remove = (t: TemplateSummary) =>
    act(async () => {
      if (!window.confirm(`Eliminare il template "${t.name}"?`)) return;
      await api.deleteTemplate(t.id);
      await reload();
    });

  const importZip = (file: File) =>
    act(async () => {
      const imported = await api.importTemplate(file);
      await reload();
      setEditing(imported);
    });

  if (editing) {
    return (
      <>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <TemplateEditor
          key={editing.id}
          initial={editing}
          onClose={() => {
            setEditing(null);
            setError(null);
            void reload();
          }}
          onDuplicate={() => void duplicate(editing)}
        />
      </>
    );
  }

  return (
    <div className="catalog">
      <div className="catalog-bar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input placeholder="Nome del nuovo template" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="primary" type="submit" disabled={!newName.trim()}>
            Crea
          </button>
        </form>
        <button onClick={() => importRef.current?.click()}>Importa .zip</button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importZip(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="cards">
        {templates.map((t) => (
          <article key={t.id} className="card">
            <img src={api.thumbnailUrl(t.id, version)} alt="" loading="lazy" onClick={() => setEditing(t)} />
            <div className="card-body">
              <h3>
                {t.name} {t.builtin && <span className="badge">built-in</span>}
              </h3>
              <p className="hint">
                {t.slug} · {t.id}
              </p>
              {t.description && <p>{t.description}</p>}
              <div className="actions">
                <button onClick={() => setEditing(t)}>{t.builtin ? 'Apri' : 'Modifica'}</button>
                <button onClick={() => void duplicate(t)}>Duplica</button>
                <a className="button" href={api.exportUrl(t.id)} download>
                  Esporta
                </a>
                {!t.builtin && (
                  <button className="danger" onClick={() => void remove(t)}>
                    Elimina
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
