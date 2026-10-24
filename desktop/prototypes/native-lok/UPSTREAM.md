<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Native LOK prototype provenance

The four files under `vendor/LibreOfficeKit/` are unmodified public C API headers
from LibreOffice core tag `libreoffice-26.2.2.2`:
https://github.com/LibreOffice/core/tree/libreoffice-26.2.2.2/include/LibreOfficeKit

- `LibreOfficeKit.h`
- `LibreOfficeKitInit.h`
- `LibreOfficeKitTypes.h`
- `LibreOfficeKitEnums.h`

The original MPL-2.0 license notices remain intact. The license text is in
`vendor/MPL-2.0.txt`. These headers do not include LibreOffice binaries.

## Runtime tested locally on 2026-10-24

The stock macOS arm64 LibreOffice 26.2.2.2 runtime could load and save the synthetic
document, but its `paintTile` left every sentinel byte unchanged. The same-tag
[official source](https://github.com/LibreOffice/core/blob/libreoffice-26.2.2.2/desktop/source/lib/init.cxx)
excludes `MACOSX` from the painting branch. This is not evidence that a patched
macOS LOK engine cannot work.

The successful test used LibreOffice 26.2.6.3 from the upstream ElyDoc 0.1.9 arm64
release, downloaded only into an isolated artifact directory:

- [Release](https://github.com/ELY-Open-Source/ElyOffice/releases/tag/v0.1.9)
- [Asset](https://github.com/ELY-Open-Source/ElyOffice/releases/download/v0.1.9/ElyDoc-0.1.9-arm64.dmg)
- DMG bytes: `232764765`; SHA256:
  `48aae7117434da649d2f0be89bcc7364efa2ae69eb1d5a9dfb502d482795ed00`.
  This matched the GitHub release asset digest.
- Engine BuildId: `8221e31b3ac356a1623c672912a3d2b492f7e3d1`.
- `libmergedlo.dylib` SHA256:
  `112fe466cfd74332afd6aeec38a1ba3d7b54d61893d4165494aba190206cd14d`.
  The extracted SSD copy matched the read-only mounted source.
- The unmodified app passed `codesign --verify --deep --strict`; its Developer ID
  signature identifies Yang Zhang, team `9PDD8M2SMS`. This verifies that downloaded
  artifact's signature, not AI WorkDeck production compatibility.

The vendored headers are **26.2.2.2**, while the successful engine is **26.2.6.3**;
they are not a matching source/runtime build. The worker uses the C API table
prefix, checks the table size for `runLoop` and the required document prefix,
and checks optional `startURP` availability. The exercised operations passed on
this runtime. This is not a guarantee for every unstable API, other LibreOffice
versions, or the minimum supported macOS version.

ElyOffice 0.1.9's own code is
[MIT licensed](https://github.com/ELY-Open-Source/ElyOffice/blob/v0.1.9/LICENSE),
copyright 2026 Yang Zhang. The bundled LibreOffice runtime is separately covered
by its MPL-2.0 notice and the component-specific notices under
`Contents/Resources/Licenses/LibreOffice/{LICENSE,NOTICE}`; the Ely MIT license
does not replace these engine, library, font, or other component licenses.
No Ely code or binary is copied into this prototype directory. Upstream's
[macOS tile patch](https://github.com/ELY-Open-Source/ElyOffice/blob/v0.1.9/patches/libreoffice/0001-lok-macos-tile-painting.patch)
and worker implementation informed the main-thread/unipoll integration. The
worker here is independently written against the public C API.

No downloaded application was installed, re-signed, or used to open a user
document. An early optional UNO client regenerated twelve sealed Python
bytecode files in
a separate installed framework. Exactly those twelve were restored from the
same official TDF version and matched the installed nested resource seal; older
unrelated signature differences were left untouched. The final probe requires
explicit runtime paths, disables bytecode writes and uses an artifact cache prefix.
No application was re-signed or upgraded. Binaries, downloaded reference source,
profiles, synthetic DOCX and logs remain outside the repository. The optional UNO test client uses a separate
isolated stock LibreOffice 26.2.2.2 copy's Python 3.12/pyuno libraries through the
small `python_host.c`; it does not start that application's `soffice` process.

`worker.mm` is AI WorkDeck code. Its 8-byte little-endian JSON/binary framing
matches `desktop/main/lok-sidecar.js`, but this deliberately limited diagnostic
protocol is not an implementation of all product EDITOR_ACTIONS.

Primary API references:
[LibreOfficeKit](https://docs.libreoffice.org/libreofficekit.html),
[C API header](https://github.com/LibreOffice/core/blob/libreoffice-26.2.2.2/include/LibreOfficeKit/LibreOfficeKit.h),
[function-based URP implementation](https://github.com/LibreOffice/core/blob/libreoffice-26.2.2.2/desktop/source/lib/init.cxx).
