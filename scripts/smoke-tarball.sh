#!/usr/bin/env bash
# Estrae il tarball in una cartella temporanea e prova doctor e render come farebbe Homebrew.
set -euo pipefail
TARBALL="$1"
WORK=$(mktemp -d)
tar -xzf "$TARBALL" -C "$WORK"
APP=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)
export MDPRESS_HOME="$WORK/home"
node "$APP/bin/mdpress.js" doctor
printf -- '---\ntitle: Prova\n---\n\n# Ciao\n\nTesto.\n' > "$WORK/prova.md"
node "$APP/bin/mdpress.js" render "$WORK/prova.md" -f pdf,docx -t report
test -s "$WORK/prova.pdf"
test -s "$WORK/prova.docx"
echo "smoke test ok"
