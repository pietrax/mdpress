#!/usr/bin/env bash
# Opens a PR on pietrax/homebrew-tap with the updated formula. Requires GH_TOKEN with access to the tap.
set -euo pipefail
VERSION="$1"
TARBALL="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA=$(shasum -a 256 "$TARBALL" | cut -d' ' -f1)
WORK=$(mktemp -d)

gh auth setup-git
gh repo clone pietrax/homebrew-tap "$WORK/tap"
cd "$WORK/tap"
git checkout -b "mdpress-$VERSION"
mkdir -p Formula
sed -e "s/__VERSION__/$VERSION/g" -e "s/__SHA256__/$SHA/g" "$ROOT/packaging/homebrew/mdpress.rb.template" > Formula/mdpress.rb
git add Formula/mdpress.rb
git -c user.name="mdpress release" -c user.email="noreply@github.com" commit -m "mdpress $VERSION"
git push -u origin "mdpress-$VERSION"
gh pr create --title "mdpress $VERSION" --body "Automatic formula update to version $VERSION."
