#!/usr/bin/env bash
# install-local.sh — build gruntcode from current source and install over the
# brew Cellar binary, so a fresh `gruntcode` invocation uses today's changes
# without waiting for CI to publish a tagged release.
#
# Usage:
#   bash scripts/install-local.sh [version-label]
#
# version-label defaults to "$(git describe --always --dirty)-local" so it's
# obvious from `gruntcode --version` that this is a local-build, not a release.
#
# Pairs with the standard release flow: tag a release for distribution, but
# install locally immediately so Nik isn't blocked on CI for his own bin.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_LABEL="${1:-$(git -C "$ROOT" describe --always --dirty)-local}"

echo "→ Building gruntcode from source (version=$VERSION_LABEL)..."
cd "$ROOT/packages/opencode"
OPENCODE_VERSION="$VERSION_LABEL" \
OPENCODE_RELEASE=1 \
OPENCODE_CHANNEL=latest \
  bun script/build.ts --single --skip-embed-web-ui 2>&1 | tail -5 || true

SRC_BIN=$(find dist -type f -name opencode | head -1)
if [ -z "$SRC_BIN" ] || [ ! -x "$SRC_BIN" ]; then
  echo "ERROR: build did not produce a binary at dist/*/bin/opencode" >&2
  find dist -type f | head -20 >&2
  exit 1
fi

# Find the current brew Cellar gruntcode dir
CELLAR_BIN=$(find /opt/homebrew/Cellar/gruntcode -name gruntcode -type f 2>/dev/null | sort -r | head -1)
if [ -z "$CELLAR_BIN" ]; then
  echo "ERROR: no brew-installed gruntcode found. Run 'brew install grunt-it/tap/gruntcode' first." >&2
  exit 1
fi

echo "→ Installing $SRC_BIN → $CELLAR_BIN"
chmod u+w "$CELLAR_BIN"
cp "$SRC_BIN" "$CELLAR_BIN"
chmod 555 "$CELLAR_BIN"

echo "→ Re-signing (macOS requires re-codesign after binary replacement)..."
codesign -s - -f "$CELLAR_BIN" 2>&1 | tail -2

echo "→ Verify:"
echo "   $(gruntcode --version)"
echo
echo "Done. Restart any running gruntcode tabs to pick up the change."
