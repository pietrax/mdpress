import { useEffect, useState } from 'react';
import { ApiError, api, type Issue, type Template, type TemplateSummary } from '../api';
import { BandEditor, ColorInput, Field, NumberInput, Toggle } from '../components/fields';
import { useDebouncedEffect, useObjectUrl } from '../util';

const COVER_FIELDS = [
  ['title', 'Titolo'],
  ['subtitle', 'Sottotitolo'],
  ['author', 'Autore'],
  ['date', 'Data'],
] as const;
const MARGINS = [
  ['top', 'superiore'],
  ['bottom', 'inferiore'],
  ['left', 'sinistro'],
  ['right', 'destro'],
] as const;
const COLORS = [
  ['text', 'Testo'],
  ['heading', 'Titoli'],
  ['accent', 'Accento'],
  ['muted', 'Secondario'],
] as const;
const FONTS = [
  ['body', 'Font del testo'],
  ['heading', 'Font dei titoli'],
  ['mono', 'Font del codice'],
] as const;

function strip(s: TemplateSummary): Template {
  const { builtin: _builtin, hasLogo: _hasLogo, ...template } = s;
  return template;
}

function toMap(issues: Issue[]): Record<string, string> {
  return Object.fromEntries(issues.map((i) => [i.path, i.message]));
}

interface Props {
  initial: TemplateSummary;
  onClose(): void;
  onDuplicate(): void;
}

export function TemplateEditor({ initial, onClose, onDuplicate }: Props) {
  const readOnly = initial.builtin;
  const [draft, setDraft] = useState<Template>(() => strip(initial));
  const [saved, setSaved] = useState<Template>(() => strip(initial));
  const [hasLogo, setHasLogo] = useState(initial.hasLogo);
  const [previewIssues, setPreviewIssues] = useState<Record<string, string>>({});
  const [saveIssues, setSaveIssues] = useState<Record<string, string>>({});
  const issues = { ...saveIssues, ...previewIssues };
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrl, setPreview] = useObjectUrl();
  const [fonts, setFonts] = useState<string[]>([]);
  const [logoVersion, setLogoVersion] = useState(() => String(Date.now()));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const err = (path: string) => issues[path];
  const update = (fn: (d: Template) => void) => {
    setMessage(null);
    setSaveIssues({});
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  };

  useEffect(() => {
    api.fonts().then(setFonts).catch(() => setFonts([]));
  }, []);

  useDebouncedEffect(
    () => {
      let cancelled = false;
      api
        .preview(draft, draft.id)
        .then((blob) => {
          if (cancelled) return;
          setPreview(blob);
          setPreviewIssues({});
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (e instanceof ApiError && e.issues.length > 0) setPreviewIssues(toMap(e.issues));
          else {
            setPreviewIssues({});
            setMessage((e as Error).message);
          }
        });
      return () => {
        cancelled = true;
      };
    },
    [draft, logoVersion],
    400,
  );

  async function save() {
    const sent = draft;
    try {
      const res = await api.updateTemplate(sent.id, sent);
      const t = strip(res);
      setDraft((cur) => (JSON.stringify(cur) === JSON.stringify(sent) ? t : cur));
      setSaved(t);
      setHasLogo(res.hasLogo);
      setSaveIssues({});
      setMessage('Template salvato');
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) setSaveIssues(toMap(e.issues));
      setMessage((e as Error).message);
    }
  }

  async function uploadLogo(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setMessage('Il logo deve essere PNG o JPG');
      return;
    }
    try {
      const res = await api.uploadLogo(draft.id, file);
      update((d) => {
        d.logo.file = res.logo.file;
      });
      setSaved((s) => ({ ...s, logo: res.logo }));
      setHasLogo(true);
      setLogoVersion(String(Date.now()));
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  function close() {
    if (dirty && !window.confirm('Ci sono modifiche non salvate. Uscire comunque?')) return;
    onClose();
  }

  const t = draft;
  const logoAvailable = hasLogo && t.logo.file !== null;

  return (
    <div className="editor">
      <div className="editor-bar">
        <button onClick={close}>← Catalogo</button>
        <h2>{t.name}</h2>
        {readOnly ? (
          <>
            <span className="badge">built-in, sola lettura</span>
            <button className="primary" onClick={onDuplicate}>
              Duplica per modificare
            </button>
          </>
        ) : (
          <button className="primary" disabled={!dirty} onClick={() => void save()}>
            Salva
          </button>
        )}
      </div>
      {message && (
        <p className="notice" onClick={() => setMessage(null)}>
          {message}
        </p>
      )}

      <div className="split">
        <fieldset className="panel form" disabled={readOnly}>
          <datalist id="mdpress-fonts">
            {fonts.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          <h3>Generale</h3>
          <Field label="Nome" error={err('name')}>
            <input value={t.name} onChange={(e) => update((d) => { d.name = e.target.value; })} />
          </Field>
          <Field label="Slug" error={err('slug')} hint={`Da CLI: mdpress render doc.md -t ${t.slug}`}>
            <input value={t.slug} onChange={(e) => update((d) => { d.slug = e.target.value; })} />
          </Field>
          <Field label="Descrizione" error={err('description')}>
            <input value={t.description} onChange={(e) => update((d) => { d.description = e.target.value; })} />
          </Field>

          <h3>Pagina</h3>
          <div className="row">
            <Field label="Formato">
              <select value={t.page.size} onChange={(e) => update((d) => { d.page.size = e.target.value as Template['page']['size']; })}>
                <option value="A4">A4</option>
                <option value="A5">A5</option>
                <option value="Letter">Letter</option>
              </select>
            </Field>
            <Field label="Orientamento">
              <select
                value={t.page.orientation}
                onChange={(e) => update((d) => { d.page.orientation = e.target.value as Template['page']['orientation']; })}
              >
                <option value="portrait">Verticale</option>
                <option value="landscape">Orizzontale</option>
              </select>
            </Field>
          </div>
          <div className="row">
            {MARGINS.map(([side, label]) => (
              <Field key={side} label={`Margine ${label} (mm)`} error={err(`page.margins.${side}`)}>
                <NumberInput value={t.page.margins[side]} min={0} max={80} onChange={(v) => update((d) => { d.page.margins[side] = v; })} />
              </Field>
            ))}
          </div>

          <h3>Colori</h3>
          <div className="row">
            {COLORS.map(([key, label]) => (
              <Field key={key} label={label} error={err(`colors.${key}`)}>
                <ColorInput value={t.colors[key]} onChange={(v) => update((d) => { d.colors[key] = v; })} />
              </Field>
            ))}
          </div>

          <h3>Font</h3>
          <div className="row">
            {FONTS.map(([key, label]) => (
              <Field key={key} label={label} error={err(`fonts.${key}`)}>
                <input list="mdpress-fonts" value={t.fonts[key]} onChange={(e) => update((d) => { d.fonts[key] = e.target.value; })} />
              </Field>
            ))}
            <Field label="Corpo (pt)" error={err('fonts.size')}>
              <NumberInput value={t.fonts.size} min={8} max={16} step={0.5} onChange={(v) => update((d) => { d.fonts.size = v; })} />
            </Field>
          </div>
          <Toggle label="Titoli numerati (1, 1.1, 1.1.1)" checked={t.headings.numbered} onChange={(v) => update((d) => { d.headings.numbered = v; })} />

          <h3>Logo</h3>
          <div className="logo-box">
            {logoAvailable ? <img src={api.logoUrl(t.id, logoVersion)} alt="Logo" /> : <span className="hint">Nessun logo</span>}
            <label className="button">
              Carica PNG/JPG
              <input
                type="file"
                accept="image/png,image/jpeg"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadLogo(file);
                  e.target.value = '';
                }}
              />
            </label>
            {t.logo.file && <button
              onClick={() =>
                update((d) => {
                  d.logo.file = null;
                  for (const band of [d.header, d.footer])
                    for (const pos of ['left', 'center', 'right'] as const)
                      if (band[pos].type === 'logo') band[pos] = { type: 'empty' };
                })
              }
            >Rimuovi</button>}
          </div>
          <Field label="Altezza del logo in testata (mm)" error={err('logo.height')} hint="In copertina il logo è alto il doppio">
            <NumberInput value={t.logo.height} min={4} max={60} onChange={(v) => update((d) => { d.logo.height = v; })} />
          </Field>

          <h3>Testata</h3>
          <BandEditor value={t.header} hasLogo={logoAvailable} issues={issues} prefix="header" onChange={(v) => update((d) => { d.header = v; })} />
          <h3>Piè di pagina</h3>
          <BandEditor value={t.footer} hasLogo={logoAvailable} issues={issues} prefix="footer" onChange={(v) => update((d) => { d.footer = v; })} />
          <p className="hint">Segnaposto disponibili: {'{title} {subtitle} {author} {date} {page} {pages}'}</p>

          <h3>Copertina</h3>
          <Toggle label="Copertina attiva di default" checked={t.cover.enabled} onChange={(v) => update((d) => { d.cover.enabled = v; })} />
          <Toggle label="Logo in copertina" checked={t.cover.showLogo} onChange={(v) => update((d) => { d.cover.showLogo = v; })} />
          <div className="row">
            {COVER_FIELDS.map(([key, label]) => (
              <Toggle
                key={key}
                label={label}
                checked={t.cover.fields.includes(key)}
                onChange={(on) =>
                  update((d) => {
                    d.cover.fields = COVER_FIELDS.map(([f]) => f).filter((f) => (f === key ? on : d.cover.fields.includes(f)));
                  })
                }
              />
            ))}
          </div>

          <h3>Blocchi</h3>
          <Toggle label="Tabelle a righe alternate" checked={t.blocks.tableStriped} onChange={(v) => update((d) => { d.blocks.tableStriped = v; })} />
          <Toggle label="Barra colorata sulle citazioni" checked={t.blocks.quoteBar} onChange={(v) => update((d) => { d.blocks.quoteBar = v; })} />
          <Field label="Sfondo dei blocchi di codice" error={err('blocks.codeBackground')}>
            <ColorInput value={t.blocks.codeBackground} onChange={(v) => update((d) => { d.blocks.codeBackground = v; })} />
          </Field>
        </fieldset>

        <section className="preview">
          {previewUrl ? <iframe title="Anteprima" src={previewUrl} /> : <p className="empty">Genero l’anteprima…</p>}
          <p className="hint" style={{ padding: '0 12px' }}>
            Anteprima del PDF. Il DOCX usa gli stessi colori e font come stili di Word.
          </p>
        </section>
      </div>
    </div>
  );
}
