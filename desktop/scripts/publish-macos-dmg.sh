# After a Mac CI build (or local `npm run dist:mac` on a Mac), copy the DMG
# into the main Sociva web repo for Vercel.
#
# Usage (from sociva-desktop on a Mac):
#   ./scripts/publish-macos-dmg.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="$(cd "$ROOT/../sociva-v1-main/sociva-v1-main" && pwd)"
DOWNLOADS="$WEB_ROOT/public/downloads"
VER="$(node -p "require('$ROOT/package.json').version")"

mkdir -p "$DOWNLOADS"
DMG="$(ls -t "$ROOT"/dist/Sociva-*-mac.dmg 2>/dev/null | head -1 || true)"
if [[ -z "${DMG}" || ! -f "${DMG}" ]]; then
  echo "No DMG found in $ROOT/dist — run: npm run dist:mac"
  exit 1
fi

cp -f "$DMG" "$DOWNLOADS/sociva-macos.dmg"
cp -f "$DMG" "$DOWNLOADS/sociva-macos-v${VER}.dmg"
echo "Copied:"
ls -la "$DOWNLOADS/sociva-macos.dmg" "$DOWNLOADS/sociva-macos-v${VER}.dmg"
echo "Next: in the web repo, git add -f public/downloads/sociva-macos*.dmg && commit && push"
