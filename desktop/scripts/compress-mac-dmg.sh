#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

# electron-builder 24 does not accept ULMO in dmg.format. Recompress its finished
# volume instead, preserving the app signature, notarization ticket and layout.
# ULMO requires macOS 10.15; this product only ships Apple Silicon (macOS 11+).
if [[ $# -ne 1 || ! -f "$1" || "$1" != *.dmg ]]; then
  echo "Usage: $0 <unsigned-container.dmg>" >&2
  exit 1
fi
dmg="$1"
# Converting an outer signed/stapled container would discard its identity.
# The current pipeline notarizes/staples the inner app, not the DMG container.
if codesign -d "$dmg" >/dev/null 2>&1 || xcrun stapler validate "$dmg" >/dev/null 2>&1; then
  echo "Refusing to recompress a signed or stapled DMG; compress before signing it." >&2
  exit 1
fi
work=$(mktemp -d "$(dirname "$dmg")/.dmg-compress.XXXXXX")
trap 'rm -rf "$work"' EXIT
hdiutil convert "$dmg" -format ULMO -o "$work/compressed.dmg"
hdiutil verify "$work/compressed.dmg"
before=$(stat -f %z "$dmg")
after=$(stat -f %z "$work/compressed.dmg")
if (( after >= before )); then
  echo "DMG compression kept original: $before bytes (candidate $after bytes)."
  exit 0
fi
chmod "$(stat -f %Lp "$dmg")" "$work/compressed.dmg"
mv -f "$work/compressed.dmg" "$dmg"
echo "DMG compression: $before -> $after bytes (ULMO)."
