# mdpress

Impagina un file Markdown con un template e lo esporta in **PDF** e **DOCX**.
I template (colori, font, testata, piè di pagina, logo, copertina) si creano da
un'interfaccia web, senza scrivere codice.

## Installazione

```sh
brew install pietrax/tap/mdpress
mdpress doctor
```

Homebrew installa anche `pandoc` e `typst`. Requisiti: Node ≥ 22.12, `pandoc` ≥ 3.1.2, `typst` ≥ 0.12.

## Uso da terminale

```sh
mdpress render relazione.md                     # PDF col template di default
mdpress render relazione.md -t report -f pdf,docx --toc
mdpress render relazione.md -o out/             # scrive in out/relazione.pdf
mdpress templates list
mdpress templates default report
```

Nel front-matter puoi indicare titolo, sottotitolo, autore e data, e forzare
indice o copertina:

```yaml
---
title: Relazione trimestrale
subtitle: Q3 2026
author: Mario Rossi
date: 30 settembre 2026
toc: true
cover: true
---
```

Le opzioni da riga di comando (`--toc`, `--no-cover`…) prevalgono sul front-matter.

## Interfaccia web

```sh
mdpress serve
```

Si apre il browser su `http://127.0.0.1:4321`:

- **Converti**: trascina un `.md`, scegli il template, scarica PDF o DOCX;
- **Template**: crea, duplica, modifica con anteprima live, importa ed esporta (`.zip`).

I template creati finiscono in `~/.config/mdpress/templates/` e sono subito
usabili anche da terminale con `-t <slug>`.

## Condividere un template

```sh
mdpress templates export aziendale-blu -o aziendale-blu.zip
mdpress templates import aziendale-blu.zip
```

## Sviluppo

```sh
npm install
npm test
npm run dev -- render assets/sample.md      # CLI senza build
npm run build && ./bin/mdpress.js serve     # UI buildata
```

Per rilasciare: aggiorna `version` in `package.json`, poi `git tag vX.Y.Z && git push --tags`.
Il workflow crea la release e apre una PR sul tap (serve il secret `TAP_GITHUB_TOKEN`).
