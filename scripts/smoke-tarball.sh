#!/usr/bin/env bash
# Extracts the tarball into a temporary directory and runs doctor and render the way Homebrew would.
set -euo pipefail
TARBALL="$1"
WORK=$(mktemp -d)
tar -xzf "$TARBALL" -C "$WORK"
APP=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)
export MDPRESS_HOME="$WORK/home"
node "$APP/bin/mdpress.js" doctor
printf -- '---\ntitle: Sample\n---\n\n# Hello\n\nText.\n' > "$WORK/sample.md"
node "$APP/bin/mdpress.js" render "$WORK/sample.md" -f pdf,docx -t report
test -s "$WORK/sample.pdf"
test -s "$WORK/sample.docx"
echo "smoke test ok"
