#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail
PLUGIN_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/../.." && pwd)"
if [ "$(uname -s)" = Darwin ]; then export JAVA_HOME="$(/usr/libexec/java_home -v 21)"; fi
mvn -q -f "$REPO_ROOT/backend/plugin-api/pom.xml" install
mvn -q -f "$PLUGIN_ROOT/backend/pom.xml" verify
npm ci --prefix "$PLUGIN_ROOT"
npm test --prefix "$PLUGIN_ROOT"
node --test "$PLUGIN_ROOT/tests/adapter.test.mjs"
python3 - "$PLUGIN_ROOT" <<'PY'
from pathlib import Path
import sys, json, zipfile
root = Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_text())
jar = root / 'backend/target' / manifest['backendJars'][0]
if not jar.is_file(): raise SystemExit('Missing plugin JAR')
out = root / 'dist'
out.mkdir(exist_ok=True)
files = [(jar, jar.name)]
for name in ('manifest.json', 'README.md', 'UPSTREAM.md', 'package.json', 'package-lock.json', 'build-web.mjs', 'build.sh'):
    files.append((root / name, name))
for folder in ('runtime', 'web', 'web-src', 'skill', 'tests', 'backend/src', 'l10n'):
    for path in sorted((root / folder).rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
            files.append((path, str(path.relative_to(root))))
files.append((root / 'backend/pom.xml', 'backend/pom.xml'))
with zipfile.ZipFile(out / f"{manifest['id']}-{manifest['version']}.zip", 'w', zipfile.ZIP_DEFLATED) as archive:
    for path, name in files:
        info = zipfile.ZipInfo(name, (2026, 10, 18, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
print(out / f"{manifest['id']}-{manifest['version']}.zip")
PY
