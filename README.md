# mdpress

Lay out a Markdown file with a template and export it to **PDF** and **DOCX**.
Templates (colors, fonts, header, footer, logo, cover page) are created from a
web interface, without writing code.

## Installation

```sh
brew install pietrax/tap/mdpress
mdpress doctor
```

Homebrew also installs `pandoc` and `typst`. Requirements: Node ≥ 22.12, `pandoc` ≥ 3.1.2, `typst` ≥ 0.12.

## Command line

```sh
mdpress render report.md                      # PDF with the default template
mdpress render report.md -t report -f pdf,docx --toc
mdpress render report.md -o out/              # writes out/report.pdf
mdpress templates list
mdpress templates default report
```

The front-matter can set the title, subtitle, author and date, and force the table
of contents or the cover page:

```yaml
---
title: Quarterly report
subtitle: Q3 2026
author: Jane Doe
date: September 30, 2026
toc: true
cover: true
---
```

Command-line options (`--toc`, `--no-cover`…) take precedence over the front-matter.

## Web interface

```sh
mdpress serve
```

Opens the browser at `http://127.0.0.1:4321`:

- **Convert**: drop a `.md` file, pick a template, download PDF or DOCX;
- **Templates**: create, duplicate, edit with a live preview, import and export (`.zip`).

Templates are stored in `~/.config/mdpress/templates/` and can be used right away from
the command line with `-t <slug>`.

## Languages

The interface is available in English and Italian:

- command line: `--lang it`, or `"language": "it"` in `~/.config/mdpress/config.json`,
  or an Italian system locale (`LANG=it_IT.UTF-8`);
- web interface: the selector in the top bar (the choice is saved for the command line too).

The language of the documents (hyphenation, table-of-contents title, Word proofing
language) is a template setting: *Document language* in the editor, `"language"` in
`template.json`.

## Sharing a template

```sh
mdpress templates export corporate -o corporate.zip
mdpress templates import corporate.zip
```

## Development

```sh
npm install
npm test
npm run check:lang                         # no Italian outside src/i18n/locales/it.json
npm run dev -- render assets/sample.md     # CLI without a build
npm run build && ./bin/mdpress.js serve    # built UI
```

Translations live in `src/i18n/locales/` (`en.json` is the reference).

To release: bump `version` in `package.json`, then `git tag vX.Y.Z && git push --tags`.
The workflow creates the release and opens a PR on the tap (it needs the `TAP_GITHUB_TOKEN` secret).
