#!/usr/bin/env bash
# Creates release/mdpress-<version>.tar.gz with the build, templates, assets and production dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
STAGE_ROOT=$(mktemp -d)
STAGE="$STAGE_ROOT/mdpress-$VERSION"
mkdir -p "$STAGE"

npm ci
npm run build
cp -R bin dist templates assets package.json package-lock.json README.md LICENSE "$STAGE/"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts)

mkdir -p release
tar -czf "release/mdpress-$VERSION.tar.gz" -C "$STAGE_ROOT" "mdpress-$VERSION"
shasum -a 256 "release/mdpress-$VERSION.tar.gz"
