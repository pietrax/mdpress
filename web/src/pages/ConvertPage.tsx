import { useEffect, useState } from 'react';
import { api, type RenderBody, type TemplateSummary } from '../api';
import { saveBlob, useDebouncedEffect, useObjectUrl } from '../util';

type CoverMode = 'auto' | 'on' | 'off';

export function ConvertPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [filename, setFilename] = useState('documento.md');
  const [toc, setToc] = useState(false);
  const [cover, setCover] = useState<CoverMode>('auto');
  const [previewUrl, setPreview] = useObjectUrl();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [version] = useState(() => String(Date.now()));

  useEffect(() => {
    api
      .listTemplates()
      .then((list) => {
        setTemplates(list);
        setTemplateId((cur) => cur ?? list.find((t) => t.slug === 'standard')?.id ?? list[0]?.id ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const body = (format: 'pdf' | 'docx'): RenderBody => ({
    markdown,
    filename,
    template: templateId ?? undefined,
    format,
    toc,
    cover: cover === 'auto' ? undefined : cover === 'on',
  });

  useDebouncedEffect(
    () => {
      if (!markdown.trim() || !templateId) {
        setBusy(false);
        return;
      }
      let cancelled = false;
      setBusy(true);
      api
        .render(body('pdf'))
        .then((r) => {
          if (cancelled) return;
          setPreview(r.blob);
          setWarnings(r.warnings);
          setError(null);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
      return () => {
        cancelled = true;
      };
    },
    [markdown, templateId, toc, cover],
    600,
  );

  async function loadFile(file: File) {
    setFilename(file.name);
    setMarkdown(await file.text());
  }

  async function download(format: 'pdf' | 'docx') {
    try {
      const r = await api.render(body(format));
      saveBlob(r.blob, r.filename);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="split">
      <section className="panel">
        <h2>1. Documento</h2>
        <div
          className={`dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void loadFile(file);
          }}
        >
          <p>
            Trascina qui un file <code>.md</code> oppure{' '}
            <label className="link">
              sceglilo
              <input
                type="file"
                accept=".md,.markdown,text/markdown"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file);
                }}
              />
            </label>
          </p>
          <textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} placeholder="…o incolla qui il Markdown" rows={10} />
          <p className="hint">Le immagini con percorso relativo non sono disponibili da qui: usa la CLI.</p>
        </div>

        <h2>2. Template</h2>
        <div className="thumbs">
          {templates.map((t) => (
            <button key={t.id} className={`thumb${t.id === templateId ? ' selected' : ''}`} onClick={() => setTemplateId(t.id)}>
              <img src={api.thumbnailUrl(t.id, version)} alt="" loading="lazy" />
              <span>{t.name}</span>
            </button>
          ))}
        </div>

        <h2>3. Opzioni</h2>
        <label className="check">
          <input type="checkbox" checked={toc} onChange={(e) => setToc(e.target.checked)} /> Includi indice
        </label>
        <label className="field">
          <span className="label">Copertina</span>
          <select value={cover} onChange={(e) => setCover(e.target.value as CoverMode)}>
            <option value="auto">Come da template</option>
            <option value="on">Sì</option>
            <option value="off">No</option>
          </select>
        </label>

        <div className="actions">
          <button className="primary" disabled={!markdown.trim()} onClick={() => void download('pdf')}>
            Scarica PDF
          </button>
          <button className="primary" disabled={!markdown.trim()} onClick={() => void download('docx')}>
            Scarica DOCX
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {warnings.map((w) => (
          <p key={w} className="warning">
            ⚠ {w}
          </p>
        ))}
      </section>

      <section className="preview">
        {busy && <div className="busy">Aggiorno l’anteprima…</div>}
        {previewUrl ? <iframe title="Anteprima PDF" src={previewUrl} /> : <p className="empty">L’anteprima del PDF comparirà qui.</p>}
      </section>
    </div>
  );
}
