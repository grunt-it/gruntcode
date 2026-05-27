#!/usr/bin/env bash
# install-local.sh — build gruntcode from current source and install over the
# brew Cellar binary, so a fresh `gruntcode` invocation uses today's changes
# without waiting for CI to publish a tagged release.
#
# Usage:
#   bash scripts/install-local.sh [version-label]
#
# Version label
# -------------
# By default, the script stamps the binary with the SAME base version CI would
# stamp if you pushed the latest reachable `v*-grunt.*` tag — e.g.
# `1.15.10-grunt.7+local.5573d8375`. The part before `+` matches a real
# release; the part after `+` is semver build-metadata (ignored for ordering),
# so brew + version-comparisons + peers see the same release this binary is
# "based on", while `gruntcode --version` still flags it as a local build.
#
# Why this matters
# ----------------
# Stamping local builds with `git describe --dirty` (the previous default) made
# them look version-ahead of any released gruntcode. If the worktree contained
# new drizzle migrations that the released brew binary doesn't have, the local
# build would apply them to ~/.local/share/opencode/opencode.db — and then the
# brew binary would crash on startup trying to re-apply migrations whose
# columns already exist. Today's incident: see today's activity log.
#
# Ahead-of-tag detection
# ----------------------
# If HEAD is ahead of the latest grunt tag, the script prints a loud warning
# listing the new commits + any new migration files. It proceeds anyway (per
# Nik's policy choice) but the warning makes it impossible to miss the
# "you're building something CI hasn't released, the DB is now ahead of brew"
# trap. Pass `--ahead-ok` to suppress the warning when intentional.
#
# Pairs with the standard release flow: tag a release for distribution, but
# install locally immediately so Nik isn't blocked on CI for his own bin.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- parse args --------------------------------------------------------------
AHEAD_OK=0
EXPLICIT_LABEL=""
for arg in "$@"; do
  case "$arg" in
    --ahead-ok) AHEAD_OK=1 ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) EXPLICIT_LABEL="$arg" ;;
  esac
done

# --- compute version label ---------------------------------------------------
if [ -n "$EXPLICIT_LABEL" ]; then
  VERSION_LABEL="$EXPLICIT_LABEL"
else
  # Latest grunt-* tag reachable from HEAD. Strip leading `v` to match CI's
  # `${TAG#v}` (see .github/workflows/grunt-release.yml).
  LATEST_TAG=$(git -C "$ROOT" describe --tags --abbrev=0 --match 'v*-grunt.*' 2>/dev/null || echo "")
  if [ -z "$LATEST_TAG" ]; then
    echo "ERROR: no reachable v*-grunt.* tag from HEAD; can't derive a CI-equivalent version." >&2
    echo "       Pass an explicit version label as the first arg, or tag a release first." >&2
    exit 1
  fi
  BASE_VERSION="${LATEST_TAG#v}"

  SHORT_SHA=$(git -C "$ROOT" rev-parse --short HEAD)
  # Semver build metadata can only contain [0-9A-Za-z-] segments separated by '.'.
  # We use `local.<sha>` (+ optional `.dirty`) to stay strictly valid.
  BUILD_META="local.${SHORT_SHA}"
  if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    BUILD_META="${BUILD_META}.dirty"
  fi
  VERSION_LABEL="${BASE_VERSION}+${BUILD_META}"
fi

# --- ahead-of-tag warning ----------------------------------------------------
if [ -z "$EXPLICIT_LABEL" ] && [ "$AHEAD_OK" -eq 0 ]; then
  AHEAD_COUNT=$(git -C "$ROOT" rev-list --count "${LATEST_TAG}..HEAD" 2>/dev/null || echo 0)
  if [ "$AHEAD_COUNT" -gt 0 ]; then
    # New migration files since the tag = the migration-desync trap.
    NEW_MIGRATIONS=$(git -C "$ROOT" diff --name-only --diff-filter=A "${LATEST_TAG}..HEAD" \
      -- 'packages/opencode/migration/**/migration.sql' 2>/dev/null || true)

    {
      echo
      echo "⚠️  HEAD is ${AHEAD_COUNT} commit(s) ahead of ${LATEST_TAG}."
      echo "    This local build contains code that CI has NOT released."
      if [ -n "$NEW_MIGRATIONS" ]; then
        echo
        echo "    NEW MIGRATIONS in this build (vs ${LATEST_TAG}):"
        # shellcheck disable=SC2001  # sed is fine here; bash subst can't easily prefix every line
        echo "$NEW_MIGRATIONS" | sed 's|^|      • |'
        echo
        echo "    After installing this binary, the brew-released gruntcode (${LATEST_TAG})"
        echo "    will likely CRASH on startup against your DB until you also tag+release"
        echo "    these migrations, or downgrade your DB. You've been warned."
      else
        echo "    No new migrations detected — binary swap is schema-safe."
      fi
      echo
      echo "    Pass --ahead-ok to suppress this warning when intentional."
      echo
    } >&2
  fi
fi

# --- build -------------------------------------------------------------------
# Note: we deliberately do NOT set OPENCODE_RELEASE=1 here. That flag enables
# the post-build `gh release upload` step in packages/opencode/script/build.ts,
# which is for CI only. Setting it locally caused the build to fail with
# `bun: no matches found: ./dist/*.tar.gz` after the binary was produced — the
# binary still got copied to brew because the upload step ran last, but the
# error was noise we don't want.
echo "→ Building gruntcode from source (version=${VERSION_LABEL})..."
cd "$ROOT/packages/opencode"
OPENCODE_VERSION="$VERSION_LABEL" \
OPENCODE_CHANNEL=latest \
  bun script/build.ts --single --skip-embed-web-ui 2>&1 | tail -5 || true

SRC_BIN=$(find dist -type f -name opencode | head -1)
if [ -z "$SRC_BIN" ] || [ ! -x "$SRC_BIN" ]; then
  echo "ERROR: build did not produce a binary at dist/*/bin/opencode" >&2
  find dist -type f | head -20 >&2
  exit 1
fi

# --- install -----------------------------------------------------------------
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
