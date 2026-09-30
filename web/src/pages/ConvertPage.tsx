import { useEffect, useState } from 'react';
import { api, type RenderBody, type TemplateSummary } from '../api';
import { useI18n } from '../i18n';
import { saveBlob, useDebouncedEffect, useObjectUrl } from '../util';

type CoverMode = 'auto' | 'on' | 'off';

export function ConvertPage() {
  const { t: tr } = useI18n();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [filename, setFilename] = useState('document.md');
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
        <h2>{tr('web.convert.document')}</h2>
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
            {tr('web.convert.dropHint')}{' '}
            <label className="link">
              {tr('web.convert.choose')}
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
          <textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} placeholder={tr('web.convert.pastePlaceholder')} rows={10} />
          <p className="hint">{tr('web.convert.relativeImagesHint')}</p>
        </div>

        <h2>{tr('web.convert.template')}</h2>
        <div className="thumbs">
          {templates.map((t) => (
            <button key={t.id} className={`thumb${t.id === templateId ? ' selected' : ''}`} onClick={() => setTemplateId(t.id)}>
              <img src={api.thumbnailUrl(t.id, version)} alt="" loading="lazy" />
              <span>{t.name}</span>
            </button>
          ))}
        </div>

        <h2>{tr('web.convert.options')}</h2>
        <label className="check">
          <input type="checkbox" checked={toc} onChange={(e) => setToc(e.target.checked)} /> {tr('web.convert.includeToc')}
        </label>
        <label className="field">
          <span className="label">{tr('web.convert.cover')}</span>
          <select value={cover} onChange={(e) => setCover(e.target.value as CoverMode)}>
            <option value="auto">{tr('web.convert.coverAuto')}</option>
            <option value="on">{tr('web.convert.coverOn')}</option>
            <option value="off">{tr('web.convert.coverOff')}</option>
          </select>
        </label>

        <div className="actions">
          <button className="primary" disabled={!markdown.trim()} onClick={() => void download('pdf')}>
            {tr('web.convert.downloadPdf')}
          </button>
          <button className="primary" disabled={!markdown.trim()} onClick={() => void download('docx')}>
            {tr('web.convert.downloadDocx')}
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
        {busy && <div className="busy">{tr('web.convert.updatingPreview')}</div>}
        {previewUrl ? <iframe title={tr('web.convert.previewTitle')} src={previewUrl} /> : <p className="empty">{tr('web.convert.previewEmpty')}</p>}
      </section>
    </div>
  );
}
