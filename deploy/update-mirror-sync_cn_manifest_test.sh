#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 0.91.2: the Release carries manifest.json (GitHub URLs first, read by intl clients) and manifest-cn.json
# (mirror URLs first). The cn mirror must serve the cn one as its manifest.json; an older release with only
# manifest.json is mirrored as before. Runs the real script against a local fake release (no GitHub, no OSS).
# Usage: bash deploy/update-mirror-sync_cn_manifest_test.sh   (exit 0 = pass)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0
ok()  { printf '\033[32m  PASS\033[0m %s\n' "$*"; }
bad() { printf '\033[31m  FAIL\033[0m %s\n' "$*"; FAIL=1; }
ROOT="$(mktemp -d)"; PORT=$(( 20000 + RANDOM % 20000 ))
SHIM="$ROOT/shim"; mkdir -p "$SHIM"
if ! command -v flock >/dev/null 2>&1; then printf '#!/usr/bin/env bash\nexit 0\n' > "$SHIM/flock"; chmod +x "$SHIM/flock"; fi
cleanup() { [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; rm -rf "$ROOT"; }
trap cleanup EXIT

make_release() { # $1 = with cn manifest (1/0)
  rm -rf "$ROOT/srv" "$ROOT/web"; mkdir -p "$ROOT/srv" "$ROOT/web/assets" "$ROOT/web/installers"
  printf 'patch' > "$ROOT/srv/patch-frontend-h5-0.91.2.tar.gz"
  printf '{"order":"github-first"}' > "$ROOT/srv/manifest.json"; printf 'sig-gh\n' > "$ROOT/srv/manifest.json.sig"
  [ "$1" = 1 ] && { printf '{"order":"mirror-first"}' > "$ROOT/srv/manifest-cn.json"; printf 'sig-cn\n' > "$ROOT/srv/manifest-cn.json.sig"; }
  python3 - "$ROOT/srv" "$PORT" > "$ROOT/srv/releases.json" <<'PY'
import json, os, sys
d, port = sys.argv[1], sys.argv[2]
assets = [{"name": n, "size": os.path.getsize(os.path.join(d, n)), "browser_download_url": f"http://127.0.0.1:{port}/{n}"}
          for n in sorted(os.listdir(d)) if n != "releases.json"]
json.dump([{"id": 1, "tag_name": "v0.91.2", "draft": False, "prerelease": False, "assets": assets}], sys.stdout)
PY
}
(cd "$ROOT" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT/srv" >/dev/null 2>&1) & SRV=$!
sleep 1

run() {
  PUSH_MARKER="$ROOT/no-marker" WEB_ROOT="$ROOT/web" LOCK_FILE="$ROOT/lock" FORCE=1 \
  API="http://127.0.0.1:$PORT/releases.json" PATH="$SHIM:$PATH" perl -e "alarm 60; exec @ARGV" bash "$HERE/update-mirror-sync.sh" >"$ROOT/out.log" 2>&1
}

make_release 1; run
if grep -q '"mirror-first"' "$ROOT/web/manifest.json" 2>/dev/null && grep -q 'sig-cn' "$ROOT/web/manifest.json.sig" 2>/dev/null; then
  ok "release with manifest-cn.json: the mirror serves the cn manifest and its signature as manifest.json"
else bad "cn manifest not installed; web/manifest.json=$(cat "$ROOT/web/manifest.json" 2>/dev/null); log: $(tail -5 "$ROOT/out.log")"; fi
[ ! -e "$ROOT/web/manifest-cn.json" ] && ok "no stray manifest-cn.json on the mirror" || bad "manifest-cn.json left on the mirror"

make_release 0; run
if grep -q '"github-first"' "$ROOT/web/manifest.json" 2>/dev/null && grep -q 'sig-gh' "$ROOT/web/manifest.json.sig" 2>/dev/null; then
  ok "older release (manifest.json only): mirrored as before"
else bad "old-style release not mirrored; log: $(tail -5 "$ROOT/out.log")"; fi

[ "$FAIL" = 0 ] && printf '\033[32m[cn-manifest] 全部通过\033[0m\n'
exit "$FAIL"
