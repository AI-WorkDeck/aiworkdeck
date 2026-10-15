#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/../.." && pwd)"
node --test "$PLUGIN_ROOT"/tests/*.mjs
python3 - "$PLUGIN_ROOT" "$REPO_ROOT" <<'PY'
from pathlib import Path
import sys,json,zipfile
root,repo=map(Path,sys.argv[1:]);manifest=json.loads((root/'manifest.json').read_text())
files=[(root/'manifest.json','manifest.json'),(root/'README.md','README.md')]
files.extend((f,str(f.relative_to(root))) for f in sorted((root/'web').glob('*')) if f.is_file() and f.name!='awd-plugin-sdk.js')
files.append((repo/'sdk/plugin-sdk/awd-plugin-sdk.js','web/awd-plugin-sdk.js'))
out=root/'dist';out.mkdir(exist_ok=True)
with zipfile.ZipFile(out/f"{manifest['id']}-{manifest['version']}.zip",'w',zipfile.ZIP_DEFLATED) as z:
 for source,name in files:
  info=zipfile.ZipInfo(name,(2026,10,15,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  z.writestr(info,source.read_bytes())
print(out/f"{manifest['id']}-{manifest['version']}.zip")
PY
