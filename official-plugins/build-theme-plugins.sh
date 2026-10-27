#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
node "$root/scripts/sync-theme-assets.mjs"
python3 - "$root" <<'PY'
import json,pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])/'official-plugins'
for plugin in ['theme-inkwash-zen','theme-anime-twilight','theme-aurora-glass']:
 base=root/plugin;manifest=json.loads((base/'manifest.json').read_text())
 files=[base/'manifest.json']+[f for directory in ['web','themes','l10n'] for f in sorted((base/directory).rglob('*')) if f.is_file()]
 out=base/'dist';out.mkdir(exist_ok=True)
 target=out/f"{plugin}-{manifest['version']}.zip"
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
  for f in files:
   assert not f.is_symlink()
   info=zipfile.ZipInfo(str(f.relative_to(base)),(2026,10,27,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
   z.writestr(info,f.read_bytes())
 print(target)
PY
