# mdpress — Internationalization design

Date: 2026-09-30
Status: approved in brainstorming, pending spec review
Builds on: `docs/superpowers/specs/2026-09-30-mdpress-design.md`

## 1. Goal

Make the software English-only at the source level and translatable at the user level.

- **No Italian anywhere in the software**: source code, comments, identifiers, keys,
  test names and assertions, Lua filters, scripts, workflows, the Homebrew formula,
  built-in templates, the sample document and the README.
- **User-facing text is translated**: English is the reference language and the
  default; Italian is provided as a translation. Italian text lives **only** in
  `src/i18n/locales/it.json`.
- **The document language is a property of the template**: a template knows which
  language its documents are written in (hyphenation, table-of-contents title,
  Word proofing language).

Out of scope: the internal design documents under `docs/superpowers/` and the
articles/guides under `docs/` (they are not software and stay as written).

### Success criteria

1. `scripts/check-no-italian.mjs` passes in CI: no Italian words outside
   `src/i18n/locales/it.json`.
2. With no configuration and an English system locale, every CLI message and every
   web UI label is English.
3. `mdpress --lang it …`, `"language": "it"` in `config.json`, or an Italian system
   locale (`LANG=it_IT.UTF-8`) switch CLI messages to Italian; the web UI has a
   language selector.
4. A template with `"language": "it"` produces documents with Italian hyphenation,
   an "Indice" table of contents in both PDF and DOCX, and `it-IT` Word proofing
   language; with `"en"` (the default) they get "Contents" and `en-US`.
5. All existing behaviour and tests keep working (translated), plus new tests for
   the i18n layer.

## 2. Languages

- Supported app languages: `en` (default), `it`.
- Supported document languages: `en` (default), `it`.
- Both lists come from one constant, `LANGUAGES = ['en', 'it'] as const`, so adding
  a language means adding a locale file and extending the constant.

## 3. Translation layer — `src/i18n/`

```
src/i18n/
├── index.ts          t(), Language, LANGUAGES, isLanguage(), normalizeLanguage()
├── detect.ts         Node-only: detectLanguage({ flag, config, env })
└── locales/
    ├── en.json       reference catalogue (all keys)
    └── it.json       Italian translation (same keys)
```

### 3.1 Catalogue format

Nested JSON objects, dot-separated keys, `{name}` interpolation:

```json
{
  "errors": {
    "templateNotFound": "Template \"{ref}\" not found. Run \"mdpress templates list\" to see the available ones."
  },
  "validation": { "tooBig": "must be at most {max}" }
}
```

Top-level groups: `errors`, `validation`, `cli`, `web`, `document`, `warnings`.

### 3.2 API

```ts
export const LANGUAGES = ['en', 'it'] as const;
export type Language = (typeof LANGUAGES)[number];
export function isLanguage(v: unknown): v is Language;
/** 'it_IT.UTF-8', 'it-IT', 'IT' → 'it'; unknown → null */
export function normalizeLanguage(v: string | undefined | null): Language | null;
/** Looks up key in lang, falls back to en, then to the key itself. Replaces {name} with params. */
export function t(key: string, params?: Record<string, string | number>, lang?: Language): string;
```

- `index.ts` has no Node dependencies (imports the JSON catalogues statically), so the
  web bundle uses the same module and the same catalogues.
- A missing key in `it.json` falls back to English at runtime; a test makes sure it
  never happens in practice.

### 3.3 Language detection (CLI and server)

`detectLanguage({ flag, config, env })` returns the first valid value of:

1. the `--lang` flag (global CLI option);
2. `language` in `~/.config/mdpress/config.json`;
3. `LC_ALL`, then `LC_MESSAGES`, then `LANG` from the environment;
4. `en`.

An unsupported `--lang` value is a usage error (`errors.unsupportedLanguage`), not a
silent fallback. Unsupported environment or config values are ignored.

`mdpress config language <en|it>` is **not** added: the config key is set by hand or by
the web selector (see 3.5). YAGNI.

### 3.4 Errors carry keys, not text

`MdpressError` changes from `(message, code, issues)` to:

```ts
class MdpressError extends Error {
  constructor(
    readonly key: string,                         // e.g. 'errors.templateNotFound'
    readonly code: ErrorCode,
    readonly params: Record<string, string | number> = {},
    readonly issues: Issue[] = [],
  );
  /** English message, so logs and stack traces stay readable */
  message: string;                                // = t(key, params, 'en')
  localize(lang: Language): string;               // = t(key, params, lang)
}

interface Issue {
  path: string;
  key: string;                                    // e.g. 'validation.tooBig'
  params: Record<string, string | number>;
}
```

- The CLI prints `err.localize(lang)` and each issue as `path: t(issue.key, issue.params, lang)`.
- `RENDER_FAILED` keeps the tool's raw stderr as a parameter (`{details}`): tool output is
  not translated.

### 3.5 Template validation messages

The zod schema carries **no** human messages. `parseTemplate` maps each zod issue to a
translation key from its issue code and parameters:

| zod issue | key | params |
|---|---|---|
| `too_big` | `validation.tooBig` | `max` |
| `too_small` (number) | `validation.tooSmall` | `min` |
| `too_small` (string, min 1) | `validation.required` | — |
| `invalid_type` expecting number | `validation.number` | — |
| `invalid_type` (other) | `validation.invalidType` | `expected` |
| `invalid_format` / regex on colors | `validation.color` | — |
| regex on `slug` | `validation.slug` | — |
| regex on `id` | `validation.id` | — |
| regex on `logo.file` | `validation.logoFile` | — |
| `invalid_value` (enum/literal) | `validation.oneOf` | `values` |
| root not an object | `validation.notObject` | — |
| anything else | `validation.invalid` | — |

The regex cases are told apart by the issue path (`colors.*`, `blocks.codeBackground`,
`slug`, `id`, `logo.file`).

### 3.6 Server

- Each request's language: header `x-mdpress-lang` if valid, else the server's detected
  language (3.3).
- Error bodies become `{ error, code, key, params, errors: [{ path, key, params, message }] }`
  where `error` and each `message` are already localized in the request language.
- New endpoint `GET /api/settings` → `{ language }` (the server's detected language), used by
  the web UI as its initial language.
- New endpoint `PUT /api/settings` with `{ language }` writes `language` to `config.json`
  (validated with `isLanguage`), so the web selector persists the choice for CLI and web alike.
- The `x-mdpress-warnings` header carries localized warnings.

### 3.7 Warnings

`collectWarnings` returns `{ key, params }` objects instead of strings:

- `warnings.fontMissing` `{font}`
- `warnings.imageNotFound` `{src}` and `warnings.imageUnreachable` `{src}` — the Lua filter
  emits machine-readable lines `mdpress:image-not-found:<src>` / `mdpress:image-unreachable:<src>`
  on stderr, parsed by `collectWarnings`.
- pandoc's own `[WARNING]` lines are passed through verbatim as `warnings.tool` `{details}`.

`renderFile` returns warnings as `{ key, params }`; the CLI and server localize them.

### 3.8 Web UI

- Every label, button, hint, placeholder, confirm/prompt text and error fallback uses `t()`.
- A `LanguageProvider` React context holds the current language:
  initial value from `localStorage` (`mdpress.language`), else `GET /api/settings`,
  else the browser (`navigator.language` via `normalizeLanguage`), else `en`.
- A language selector (`EN` / `IT`) in the top bar changes the context, stores it in
  `localStorage` and calls `PUT /api/settings`.
- The API client sends `x-mdpress-lang` on every request so server errors come back in the
  current language.
- `<html lang>` follows the current language.

## 4. Document language

### 4.1 Template field

`template.language: 'en' | 'it'`, default `'en'`. The field is added to the schema and to
`DEFAULTS`; `schemaVersion` stays `1` because the change is additive — existing user
templates without the field read as English.

The web editor gets a "Document language" select in the *General* section.

### 4.2 Where it applies

| Output | Setting |
|---|---|
| Typst | `#set text(lang: "<language>")` — hyphenation, localized `outline()` title, figure supplements |
| DOCX styles | `w:lang w:val="en-US" | "it-IT"` in `rPrDefault` |
| DOCX table of contents | `-M toc-title=<t('document.tocTitle', {}, language)>` |

`document.tocTitle` is `"Contents"` in `en.json` and `"Indice"` in `it.json`. It is looked up
with the **template** language, not the app language.

The front-matter does not override the template language (explicit product decision:
the template already is in the right language).

## 5. English conversion of existing content

| Item | Change |
|---|---|
| Code comments, identifiers, test names, assertions | English |
| CLI option descriptions and output | `t()` keys |
| Lua filters (`images.lua`, `docx.lua`) | English comments; machine-readable stderr codes (3.7) |
| `assets/sample.md` | English sample document |
| Built-in templates | `standard`, `report`, `letter` (was `lettera`), `technical` (was `tecnico`); English names and descriptions; `"language": "en"`; ids unchanged (`mdpstd01`, `mdprep01`, `mdplet01`, `mdptec01`) |
| `lettera` footer placeholder text | English placeholder ("Your Name · 1 Example Street, City · you@example.com") |
| Scripts, workflows, formula template | English comments and messages |
| `README.md` | English |
| Commit messages from now on | English |

Renaming built-in slugs: references by id keep working; references by the old slug
(`-t lettera`) stop working. Acceptable before the first public release.

## 6. Guard against regressions

`scripts/check-no-italian.mjs`:

- scans `src/`, `web/src/`, `web/index.html`, `tests/`, `assets/`, `scripts/`, `templates/`,
  `packaging/`, `.github/`, `README.md`, `package.json`;
- excludes `src/i18n/locales/it.json`;
- flags whole-word, case-insensitive matches from a list of common Italian words that are not
  English words (e.g. `il`, `della`, `non`, `per`, `con`, `sono`, `questo`, `errore`, `pagina`,
  `copertina`, `indice`, `carica`, `scarica`, `salva`, `nessun`, `trovato`, `mancante`,
  `inserisci`, `deve`, `già`, `può`, `più`, `perché`) and any word containing `à è é ì ò ù`;
- prints `file:line: word` for each hit and exits 1 if any.

It runs as `npm run check:lang`, in CI, and inside the vitest suite (one test that spawns it).

Tests that need Italian strings read them from the locale file (`t(key, params, 'it')`)
instead of hard-coding them.

## 7. Testing

- **i18n unit tests**: `t()` interpolation, fallback to English, fallback to key;
  `normalizeLanguage` cases; `detectLanguage` precedence; **key parity**: every key in
  `en.json` exists in `it.json` and vice versa, with the same `{param}` names.
- **Validation**: issue → key mapping for each row of the 3.5 table.
- **CLI**: English by default with `LANG=C`; Italian with `--lang it`; Italian from
  `config.json`; unsupported `--lang` is a usage error.
- **Server**: `x-mdpress-lang: it` localizes error bodies and issue messages;
  `GET/PUT /api/settings`.
- **Document language**: Italian template → Typst source contains `lang: "it"`, DOCX
  `styles.xml` contains `it-IT`, DOCX with TOC contains "Indice"; English → "Contents", `en-US`.
- **No-Italian check**: the guard script passes on the repo and fails on a fixture with an
  Italian word (fixture written to a temp dir, not committed).

## 8. Out of scope

Right-to-left languages, pluralization rules beyond simple strings, translating tool
(pandoc/typst) output, translating `docs/`, a translation-management workflow.
