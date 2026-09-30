# mdpress — Design

Data: 2026-09-30
Stato: approvato in brainstorming, in attesa di revisione della spec

## 1. Obiettivo

Tool locale (CLI + interfaccia web) che prende un file Markdown e lo impagina secondo un
**template** scelto da un catalogo, producendo **PDF** e/o **DOCX**. Creare un template
deve essere alla portata di chiunque: dall'interfaccia web, tramite form con anteprima
live, senza scrivere CSS, Typst o XML.

### Vincoli e decisioni

- Uso **solo locale**: nessun server remoto, nessun utente/permesso. Il catalogo è una
  cartella su disco condivisa da CLI e web.
- Pubblicato su **GitHub personale** (`pietrax/mdpress`), installabile via
  **Homebrew** da un tap personale (`brew install pietrax/tap/mdpress`).
- Il **DOCX è un documento Word da continuare a modificare**: stili nominati veri
  (Normal, Heading 1…), header/footer nativi, logo in intestazione. Pulizia ed
  editabilità prevalgono sulla fedeltà pixel-perfect al PDF.
- I template sono **temi parametrici**, non template programmabili: nessun layout
  strutturale (colonne, sidebar, ecc.) nella v1.
- Stack: **Node.js + TypeScript**; motore PDF **pandoc → Typst**; DOCX via **pandoc +
  reference.docx generato**.

### Criteri di successo

1. `mdpress render doc.md` produce un PDF impaginato col template di default.
2. Lo stesso comando con `-f docx` produce un DOCX con stili Word nominati, header/footer
   e logo, modificabile normalmente in Word.
3. Un utente non tecnico crea un nuovo template dalla UI web (colori, font, testata,
   piè di pagina, logo, copertina), lo vede in anteprima e lo ritrova nel catalogo, usabile
   anche da CLI.
4. `brew install pietrax/tap/mdpress` installa il tool con le sue dipendenze
   (`node`, `pandoc`, `typst`) e `mdpress doctor` passa.

## 2. Architettura

```
mdpress/
├── src/
│   ├── core/            libreria pura (niente HTTP)
│   │   ├── theme.ts        schema template (zod), default, merge
│   │   ├── catalog.ts      elenca/legge/salva/duplica/elimina/importa/esporta template
│   │   ├── typst.ts        theme + metadati → template pandoc per Typst (preambolo)
│   │   ├── docx.ts         theme + metadati → reference.docx
│   │   ├── frontmatter.ts  parsing del front-matter YAML
│   │   ├── deps.ts         rilevamento pandoc/typst e versioni
│   │   └── render.ts       md + template + opzioni → PDF | DOCX
│   ├── cli/             comandi (commander)
│   └── server/          Fastify: API REST sopra core + static della UI
├── web/                 UI React + Vite, buildata in dist/web
├── templates/           template built-in (sola lettura)
├── assets/              filtro Lua copertina DOCX, md di esempio per le anteprime
└── docs/
```

- `core` contiene tutta la logica; CLI e server sono involucri sottili, quindi il
  comportamento è identico nei due canali.
- Dipendenze di sistema: `pandoc` (≥ 3.1.2) e `typst` (≥ 0.12). Verificate a runtime da
  `deps.ts`.

## 3. Catalogo

- **Built-in**: `templates/` nel pacchetto, sola lettura.
- **Utente**: `~/.config/mdpress/templates/<slug>/` contenente `template.json` ed
  eventuale file logo. Directory sovrascrivibile con la variabile `MDPRESS_HOME`
  (utile per i test).
- Config globale: `~/.config/mdpress/config.json` → `{ "defaultTemplate": "<id|slug>" }`;
  se assente, il default è il built-in `standard`.
- **Identificazione**: ogni template ha un `id` stabile generato (nanoid di 8 caratteri,
  alfabeto `[a-z0-9]`) e uno `slug` leggibile e modificabile (`[a-z0-9-]`, 1–64
  caratteri), che è anche il nome della cartella. Ovunque (CLI, API, config) si può
  indicare l'uno o l'altro; la risoluzione cerca prima per `id`, poi per `slug`.
  I built-in hanno id fissi.
- Per modificare un built-in lo si duplica (`templates new <slug> --from <id|slug>`).
- Rinominare lo slug rinomina la cartella; l'`id` non cambia.
- **Import/export**: `.zip` contenente `template.json` + logo. All'import, se l'`id`
  esiste già viene rigenerato; se lo `slug` esiste già viene aggiunto un suffisso
  (`-2`, `-3`…).

## 4. Schema del template (`template.json`)

```jsonc
{
  "schemaVersion": 1,
  "id": "k3f9x2ab",
  "slug": "aziendale-blu",
  "name": "Aziendale Blu",
  "description": "Report con testata e logo",

  "page": {
    "size": "A4",                  // A4 | A5 | Letter
    "orientation": "portrait",     // portrait | landscape
    "margins": { "top": 25, "bottom": 25, "left": 20, "right": 20 }   // mm
  },
  "colors": {
    "text": "#1f2328",
    "heading": "#0b3d91",
    "accent": "#0b3d91",           // filetti, link, bordi tabelle, copertina
    "muted": "#6e7781"             // header/footer, didascalie
  },
  "fonts": {
    "body": "Inter",
    "heading": "Inter",
    "mono": "JetBrains Mono",
    "size": 11                     // pt, corpo; i titoli scalano da qui
  },
  "headings": { "numbered": false },
  "header": {
    "left":   { "type": "logo" },
    "center": { "type": "empty" },
    "right":  { "type": "text", "value": "{title}" },
    "rule": true,
    "skipFirstPage": true
  },
  "footer": {
    "left":   { "type": "text", "value": "{author}" },
    "center": { "type": "empty" },
    "right":  { "type": "text", "value": "{page} / {pages}" },
    "rule": false,
    "skipFirstPage": true
  },
  "logo": { "file": "logo.png", "height": 12 },     // mm; png | jpg (null = nessun logo)
  "cover": {
    "enabled": true,
    "showLogo": true,
    "fields": ["title", "subtitle", "author", "date"]
  },
  "blocks": {
    "tableStriped": true,
    "codeBackground": "#f6f8fa",
    "quoteBar": true
  }
}
```

### Regole

- Validazione con **zod**. Tutti i campi tranne `id`, `slug`, `name` hanno default
  (quelli del built-in `standard`); un template parziale viene completato con i default
  in lettura. Al salvataggio si scrive il template completo.
- Colori: esadecimali `#rrggbb`. Margini 0–80 mm. `fonts.size` 8–16 pt.
  `logo.height` 4–60 mm.
- Slot di header/footer: `{ "type": "empty" }`, `{ "type": "logo" }`,
  `{ "type": "text", "value": string }`. Uno slot `logo` senza `logo.file` è trattato
  come vuoto.
- **Segnaposto** nei testi degli slot: `{title}`, `{subtitle}`, `{author}`, `{date}`
  (dal front-matter; vuoti se assenti), `{page}`, `{pages}`.
- `skipFirstPage`: header/footer non mostrati sulla prima pagina (in pratica sulla
  copertina, se presente). `{page}`/`{pages}` contano le pagine fisiche, copertina inclusa.
- `cover.fields`: quali metadati compaiono in copertina e, senza copertina, nel blocco
  titolo compatto in testa alla prima pagina (mostrato solo se il front-matter ha `title`).
- Logo: solo PNG o JPG (SVG escluso in v1: Word lo gestisce male negli header).
- Lingua del documento fissa a italiano in v1 (sillabazione, titolo "Indice").
- Font non installato: warning, non errore (Typst usa un fallback; nel DOCX il nome resta
  negli stili e Word lo sostituisce se assente).
- `schemaVersion` permette migrazioni future; v1 rifiuta versioni sconosciute con
  errore chiaro.

### Numerazione e dimensioni titoli

- `headings.numbered: true` → numerazione `1.`, `1.1.`, `1.1.1.` fino al livello 3.
- Scala fissa rispetto a `fonts.size`: H1 ×2.0, H2 ×1.5, H3 ×1.25, H4–H6 ×1.0 grassetto.

## 5. Opzioni di rendering e precedenza

Opzioni: `format` (`pdf`, `docx`, o entrambi), `toc` (default **false**), `cover`
(default: `template.cover.enabled`), `output`.

Precedenza, dalla più alta: **CLI/UI → front-matter → template → default**.
Il front-matter può contenere `toc: true|false`, `cover: true|false`, oltre ai
metadati `title`, `subtitle`, `author`, `date`.
Se `title` manca nel front-matter si usa il nome del file senza estensione per i
segnaposto `{title}` e per la copertina (il blocco titolo compatto invece non compare).

## 6. Flusso di rendering (`core/render.ts`)

1. Legge l'md, estrae il front-matter, risolve il template, calcola le opzioni effettive.
2. Crea una cartella temporanea di lavoro e vi scrive l'md. I parametri per i filtri Lua
   (cartella dell'md, flag copertina/indice, logo…) passano come variabili d'ambiente
   `MDPRESS_*`, così percorsi con caratteri speciali non vengono reinterpretati.
3. **PDF**:
   - `typst.ts` genera un template pandoc per Typst: impostazioni pagina, font, colori,
     header/footer (con `counter(page)` per `{page}`/`{pages}` e logo), copertina
     opzionale, indice opzionale (`outline()`), numerazione titoli, stili di tabelle,
     codice e citazioni. I metadati sono passati come variabili pandoc, correttamente
     escapati per Typst (e `$` raddoppiato per il template pandoc).
   - `pandoc input.md -t typst --template <generato> --lua-filter images.lua -o doc.typ`;
     il filtro `images.lua` rende assoluti i percorsi delle immagini relative (rispetto alla
     cartella dell'md), scarica quelle remote nella cartella di lavoro e sostituisce con il
     testo alternativo (più un warning) le immagini mancanti o irraggiungibili.
   - `typst compile --root / doc.typ out.pdf`.
4. **DOCX**:
   - `docx.ts` parte dal reference.docx di default di pandoc
     (`pandoc --print-default-data-file reference.docx`, in cache in memoria per processo)
     e lo modifica con **JSZip**:
     - `styles.xml`: font, dimensioni, colori per Normal, Heading 1–6, Title, Subtitle,
       Block Text (citazioni), Source Code / Verbatim Char, Table.
     - header/footer: tabella a tre colonne senza bordi (sinistra/centro/destra) con
       testi dei segnaposto già sostituiti coi metadati del documento, campi `PAGE` e
       `NUMPAGES` per i numeri, logo come immagine inline; filetto come bordo di paragrafo.
     - `sectPr`: `titlePg` se `skipFirstPage`; dimensioni, orientamento e margini pagina.
     - stili Title/Subtitle/Author/Date più grandi e distanziati quando c'è la copertina;
       `TOC Heading` con interruzione di pagina prima, se c'è la copertina.
   - `pandoc input.md --reference-doc ref.docx --resource-path <cartella md>
     [--number-sections] [--toc --toc-depth=3] --lua-filter docx.lua -o out.docx`.
     La copertina è il blocco titolo nativo di pandoc (Title, Subtitle, Author, Date)
     con il logo inserito in testa al titolo dal filtro; il filtro rimuove i campi non
     selezionati, esclude dalla numerazione i titoli oltre il livello 3 e inserisce
     un'interruzione di pagina prima del corpo quando c'è copertina o indice.
   - Post-processing: con l'indice si aggiunge `updateFields` a `settings.xml` così Word
     aggiorna l'indice all'apertura (pandoc lo scarta dal reference.docx).
   - Il reference.docx è generato a ogni rendering perché contiene i metadati del
     documento.
5. Scrive l'output (o restituisce i byte al server) e rimuove la cartella temporanea
   (conservata con `--debug`, il cui percorso viene stampato).

### Differenze note PDF ↔ DOCX

- Righe alternate delle tabelle: nel DOCX tramite stile tabella con banding, può
  differire leggermente.
- Sfondo dei blocchi di codice: nel DOCX tramite shading del paragrafo Source Code.

## 7. CLI

```
mdpress render <file.md> [-t <id|slug>] [-f pdf|docx|pdf,docx] [-o <path>]
                         [--toc|--no-toc] [--cover|--no-cover] [--debug]
mdpress templates list
mdpress templates show <id|slug>
mdpress templates new <slug> [--from <id|slug>]
mdpress templates import <file.zip>
mdpress templates export <id|slug> [-o <file.zip>]
mdpress templates delete <id|slug>
mdpress templates default [<id|slug>]      # mostra/imposta il default
mdpress serve [--port 4321] [--no-open]
mdpress doctor
```

- `-o` senza estensione: base del nome, si aggiunge `.pdf`/`.docx`. Senza `-o`: accanto
  all'md, stesso nome.
- Non si possono eliminare i built-in.
- Codici di uscita: 0 ok, 1 errore d'uso/template/rendering, 2 dipendenze mancanti.

## 8. Server e UI web

### Server (Fastify, solo `127.0.0.1`)

- `GET /api/templates` · `GET /api/templates/:ref` · `POST /api/templates` ·
  `PUT /api/templates/:ref` · `DELETE /api/templates/:ref`
- `PUT /api/templates/:ref/logo` (body binario `image/png` o `image/jpeg`, max 2 MB) ·
  `GET /api/templates/:ref/logo`
- `GET /api/templates/:ref/thumbnail.png`
- `POST /api/templates/import` (zip, max 5 MB) · `GET /api/templates/:ref/export`
- `POST /api/preview` → PDF dell'md di esempio con un template non ancora salvato (body JSON)
- `POST /api/render` → JSON `{ markdown, filename, template, format, toc, cover }` → file
  (le immagini con percorso relativo non sono disponibili da web: vengono sostituite dal
  testo alternativo)
- `GET /api/fonts` → elenco font da `typst fonts`
- `GET /api/doctor`
- `ref` non è mai usato come percorso: si risolve solo tra i template del catalogo.
  Errori zod restituiti come `{ error, code, errors: [{ path, message }] }` con 400.
- Protezione da siti terzi che chiamano `localhost`: le richieste `/api/*` devono avere
  Host `127.0.0.1` o `localhost`, e quelle non-GET l'header `x-mdpress: 1` (un sito
  esterno non può impostarlo senza preflight CORS, che il server non concede).

### UI (React + Vite)

- **Converti**: drop o incolla md → griglia miniature template → toggle indice/copertina
  → anteprima PDF (iframe su blob) → "Scarica PDF" / "Scarica DOCX".
- **Template**: catalogo con miniature (PNG della prima pagina di un md d'esempio,
  rigenerata al salvataggio con `typst compile --format png`), azioni Nuovo, Duplica,
  Elimina (non per i built-in), Importa, Esporta.
- **Editor**: form a sezioni (Pagina, Colori, Font, Testata, Piè di pagina, Logo,
  Copertina, Blocchi) a sinistra, anteprima PDF a destra aggiornata con debounce di
  400 ms; tendina font da `/api/fonts`; drag&drop logo; errori di validazione accanto
  ai campi; editing dello slug con verifica di unicità.
- L'anteprima esiste solo per il PDF; per il DOCX una nota spiega che segue gli stessi
  colori e font.

## 9. Template built-in

| slug       | caratteristiche |
|------------|-----------------|
| `standard` | sobrio, senza copertina, numero pagina in basso a destra |
| `report`   | copertina, logo in testata, titoli numerati |
| `lettera`  | margini ampi, footer con recapiti, senza copertina |
| `tecnico`  | enfasi su codice monospace e tabelle a righe alternate |

I built-in con logo usano un logo segnaposto generico incluso nel pacchetto.

## 10. Gestione errori

- pandoc/typst mancanti o troppo vecchi → messaggio con `brew install pandoc typst`,
  exit 2; nella UI un banner da `/api/doctor`.
- Template non valido → elenco `path: messaggio` (CLI) / errori per campo (UI).
- Riferimento template sconosciuto → errore con suggerimento `mdpress templates list`.
- Font mancante → warning con il nome del font.
- Errori di compilazione pandoc/Typst → stderr ripulito; `--debug` conserva la cartella
  di lavoro.

## 11. Test

- **Unità (vitest)**: schema e default; risoluzione id/slug; precedenza opzioni;
  generazione del template Typst (snapshot) ed escaping dei metadati; modifica del
  reference.docx (asserzioni sull'XML di styles/header/footer); catalogo su cartella
  temporanea (`MDPRESS_HOME`); import/export zip e gestione collisioni.
- **Integrazione** (saltati se pandoc/typst assenti): render di un md d'esempio con tutti
  i built-in in PDF e DOCX; PDF valido col numero di pagine atteso; DOCX con stili
  Heading e header contenente il titolo.
- **Server**: smoke test delle API principali con `fastify.inject`.
- Nessun test E2E della UI in v1.

## 12. Distribuzione

- Repo `pietrax/mdpress`: GitHub Actions su macOS esegue build e test a ogni
  push; su tag `vX.Y.Z` crea una release con tarball precompilato (`dist/` + `templates/`
  + `assets/` + `node_modules` di produzione).
- Repo `pietrax/homebrew-tap`: `Formula/mdpress.rb` con
  `depends_on "node"`, `"pandoc"`, `"typst"`; installa il tarball in `libexec` e crea
  il wrapper `bin/mdpress`; `test do` esegue `mdpress doctor`.
- Il workflow di release apre una PR sul tap aggiornando url e sha256.
- Prima della pubblicazione: verificare che il nome `mdpress` non collida con formule
  Homebrew esistenti; in caso contrario scegliere un altro nome.
- Niente pubblicazione npm in v1.

## 13. Fuori scope (v1)

Layout strutturali; anteprima DOCX; editor Markdown nella UI; catalogo remoto o
condiviso; font inclusi nei template; template multipli per singolo documento;
localizzazione della UI oltre l'italiano.
