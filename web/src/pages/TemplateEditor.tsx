import { useEffect, useState } from 'react';
import { ApiError, api, type Issue, type Template, type TemplateSummary } from '../api';
import { LANGUAGES, type Language } from '../../../src/i18n/index.js';
import { BandEditor, ColorInput, Field, NumberInput, Toggle } from '../components/fields';
import { useI18n } from '../i18n';
import { useDebouncedEffect, useObjectUrl } from '../util';

const COVER_FIELDS = ['title', 'subtitle', 'author', 'date'] as const;
const MARGINS = ['top', 'bottom', 'left', 'right'] as const;
const COLORS = ['text', 'heading', 'accent', 'muted'] as const;
const FONTS = ['body', 'heading', 'mono'] as const;

function strip(s: TemplateSummary): Template {
  const { builtin: _builtin, hasLogo: _hasLogo, ...template } = s;
  return template;
}

function toMap(issues: Issue[]): Record<string, Issue> {
  return Object.fromEntries(issues.map((i) => [i.path, i]));
}

interface Props {
  initial: TemplateSummary;
  onClose(): void;
  onDuplicate(): void;
}

export function TemplateEditor({ initial, onClose, onDuplicate }: Props) {
  const { t: tr } = useI18n();
  const readOnly = initial.builtin;
  const [draft, setDraft] = useState<Template>(() => strip(initial));
  const [saved, setSaved] = useState<Template>(() => strip(initial));
  const [hasLogo, setHasLogo] = useState(initial.hasLogo);
  const [previewIssues, setPreviewIssues] = useState<Record<string, Issue>>({});
  const [saveIssues, setSaveIssues] = useState<Record<string, Issue>>({});
  const issues = { ...saveIssues, ...previewIssues };
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrl, setPreview] = useObjectUrl();
  const [fonts, setFonts] = useState<string[]>([]);
  const [logoVersion, setLogoVersion] = useState(() => String(Date.now()));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const err = (path: string) => {
    const issue = issues[path];
    return issue ? (issue.key ? tr(issue.key, issue.params) : issue.message) : undefined;
  };
  const errors: Record<string, string> = Object.fromEntries(Object.keys(issues).map((path) => [path, err(path) ?? '']));
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
      const stored = strip(res);
      setDraft((cur) => (JSON.stringify(cur) === JSON.stringify(sent) ? stored : cur));
      setSaved(stored);
      setHasLogo(res.hasLogo);
      setSaveIssues({});
      setMessage(tr('web.editor.saved'));
    } catch (e) {
      if (e instanceof ApiError && e.issues.length > 0) setSaveIssues(toMap(e.issues));
      setMessage((e as Error).message);
    }
  }

  async function uploadLogo(file: File) {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setMessage(tr('web.errors.logoType'));
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
    if (dirty && !window.confirm(tr('web.errors.unsavedChanges'))) return;
    onClose();
  }

  const tpl = draft;
  const logoAvailable = hasLogo && tpl.logo.file !== null;

  return (
    <div className="editor">
      <div className="editor-bar">
        <button onClick={close}>{tr('web.editor.back')}</button>
        <h2>{tpl.name}</h2>
        {readOnly ? (
          <>
            <span className="badge">{tr('web.editor.readonlyBadge')}</span>
            <button className="primary" onClick={onDuplicate}>
              {tr('web.editor.duplicateToEdit')}
            </button>
          </>
        ) : (
          <button className="primary" disabled={!dirty} onClick={() => void save()}>
            {tr('web.editor.save')}
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

          <h3>{tr('web.editor.general')}</h3>
          <Field label={tr('web.editor.name')} error={err('name')}>
            <input value={tpl.name} onChange={(e) => update((d) => { d.name = e.target.value; })} />
          </Field>
          <Field label={tr('web.editor.slug')} error={err('slug')} hint={tr('web.editor.slugHint', { slug: tpl.slug })}>
            <input value={tpl.slug} onChange={(e) => update((d) => { d.slug = e.target.value; })} />
          </Field>
          <Field label={tr('web.editor.description')} error={err('description')}>
            <input value={tpl.description} onChange={(e) => update((d) => { d.description = e.target.value; })} />
          </Field>
          <Field label={tr('web.editor.documentLanguage')} error={err('language')}>
            <select value={tpl.language} onChange={(e) => update((d) => { d.language = e.target.value as Language; })}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>{tr(`web.language.names.${l}`)}</option>
              ))}
            </select>
          </Field>

          <h3>{tr('web.editor.page')}</h3>
          <div className="row">
            <Field label={tr('web.editor.size')}>
              <select value={tpl.page.size} onChange={(e) => update((d) => { d.page.size = e.target.value as Template['page']['size']; })}>
                <option value="A4">A4</option>
                <option value="A5">A5</option>
                <option value="Letter">Letter</option>
              </select>
            </Field>
            <Field label={tr('web.editor.orientation')}>
              <select
                value={tpl.page.orientation}
                onChange={(e) => update((d) => { d.page.orientation = e.target.value as Template['page']['orientation']; })}
              >
                <option value="portrait">{tr('web.editor.portrait')}</option>
                <option value="landscape">{tr('web.editor.landscape')}</option>
              </select>
            </Field>
          </div>
          <div className="row">
            {MARGINS.map((side) => (
              <Field key={side} label={tr('web.editor.margin', { side: tr(`web.editor.sides.${side}`) })} error={err(`page.margins.${side}`)}>
                <NumberInput value={tpl.page.margins[side]} min={0} max={80} onChange={(v) => update((d) => { d.page.margins[side] = v; })} />
              </Field>
            ))}
          </div>

          <h3>{tr('web.editor.colors')}</h3>
          <div className="row">
            {COLORS.map((key) => (
              <Field key={key} label={tr(`web.editor.colorNames.${key}`)} error={err(`colors.${key}`)}>
                <ColorInput value={tpl.colors[key]} onChange={(v) => update((d) => { d.colors[key] = v; })} />
              </Field>
            ))}
          </div>

          <h3>{tr('web.editor.fonts')}</h3>
          <div className="row">
            {FONTS.map((key) => (
              <Field key={key} label={tr(`web.editor.fontNames.${key}`)} error={err(`fonts.${key}`)}>
                <input list="mdpress-fonts" value={tpl.fonts[key]} onChange={(e) => update((d) => { d.fonts[key] = e.target.value; })} />
              </Field>
            ))}
            <Field label={tr('web.editor.fontSize')} error={err('fonts.size')}>
              <NumberInput value={tpl.fonts.size} min={8} max={16} step={0.5} onChange={(v) => update((d) => { d.fonts.size = v; })} />
            </Field>
          </div>
          <Toggle label={tr('web.editor.numberedHeadings')} checked={tpl.headings.numbered} onChange={(v) => update((d) => { d.headings.numbered = v; })} />

          <h3>{tr('web.editor.logo')}</h3>
          <div className="logo-box">
            {logoAvailable ? <img src={api.logoUrl(tpl.id, logoVersion)} alt={tr('web.editor.logo')} /> : <span className="hint">{tr('web.editor.noLogo')}</span>}
            <label className="button">
              {tr('web.editor.uploadLogo')}
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
            {tpl.logo.file && <button
              onClick={() =>
                update((d) => {
                  d.logo.file = null;
                  for (const band of [d.header, d.footer])
                    for (const pos of ['left', 'center', 'right'] as const)
                      if (band[pos].type === 'logo') band[pos] = { type: 'empty' };
                })
              }
            >{tr('web.editor.removeLogo')}</button>}
          </div>
          <Field label={tr('web.editor.logoHeight')} error={err('logo.height')} hint={tr('web.editor.logoHeightHint')}>
            <NumberInput value={tpl.logo.height} min={4} max={60} onChange={(v) => update((d) => { d.logo.height = v; })} />
          </Field>

          <h3>{tr('web.editor.header')}</h3>
          <BandEditor value={tpl.header} hasLogo={logoAvailable} issues={errors} prefix="header" onChange={(v) => update((d) => { d.header = v; })} />
          <h3>{tr('web.editor.footer')}</h3>
          <BandEditor value={tpl.footer} hasLogo={logoAvailable} issues={errors} prefix="footer" onChange={(v) => update((d) => { d.footer = v; })} />
          <p className="hint">{tr('web.editor.placeholders', { list: '{title} {subtitle} {author} {date} {page} {pages}' })}</p>

          <h3>{tr('web.editor.cover')}</h3>
          <Toggle label={tr('web.editor.coverEnabled')} checked={tpl.cover.enabled} onChange={(v) => update((d) => { d.cover.enabled = v; })} />
          <Toggle label={tr('web.editor.coverLogo')} checked={tpl.cover.showLogo} onChange={(v) => update((d) => { d.cover.showLogo = v; })} />
          <div className="row">
            {COVER_FIELDS.map((key) => (
              <Toggle
                key={key}
                label={tr(`web.editor.coverFields.${key}`)}
                checked={tpl.cover.fields.includes(key)}
                onChange={(on) =>
                  update((d) => {
                    d.cover.fields = COVER_FIELDS.filter((f) => (f === key ? on : d.cover.fields.includes(f)));
                  })
                }
              />
            ))}
          </div>

          <h3>{tr('web.editor.blocks')}</h3>
          <Toggle label={tr('web.editor.stripedTables')} checked={tpl.blocks.tableStriped} onChange={(v) => update((d) => { d.blocks.tableStriped = v; })} />
          <Toggle label={tr('web.editor.quoteBar')} checked={tpl.blocks.quoteBar} onChange={(v) => update((d) => { d.blocks.quoteBar = v; })} />
          <Field label={tr('web.editor.codeBackground')} error={err('blocks.codeBackground')}>
            <ColorInput value={tpl.blocks.codeBackground} onChange={(v) => update((d) => { d.blocks.codeBackground = v; })} />
          </Field>
        </fieldset>

        <section className="preview">
          {previewUrl ? <iframe title={tr('web.editor.previewTitle')} src={previewUrl} /> : <p className="empty">{tr('web.editor.generatingPreview')}</p>}
          <p className="hint" style={{ padding: '0 12px' }}>
            {tr('web.editor.previewHint')}
          </p>
        </section>
      </div>
    </div>
  );
}
