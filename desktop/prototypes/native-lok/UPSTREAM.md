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

## Native source build and lifetime regression, 2026-10-25

The source experiment starts at the exact LibreOffice core commit
`8221e31b3ac356a1623c672912a3d2b492f7e3d1` above, applies all 53 LibreOffice patches
from the pinned ElyOffice `v0.1.9` source archive in filename order, then applies
the two AI WorkDeck patches in `patches/` in filename order. Downloaded Ely
patches and source remain in the isolated build artifact directory; their
upstream license notices apply unchanged.

- `0001-awd-review-geometry-gutter-native-port.patch` ports this repository's
  existing LOWA page-gutter and table-margin changes to that native source.
  It queries layout through Writer's controller and does not cap geometry at
  500 revisions/comments. The completed native build returned all 600 revision
  anchors in the synthetic fixture, including entry 599 and nonzero page gutters.
  Margin-view export and two resolutions followed by repeated undo/redo preserved
  the all/original/final text and all original revision groups on DOCX readback.
  This does not establish the full overlay/comment UI or arbitrary DOCX parity.
- `0002-redline-release-solar-mutex.patch` serializes `SwXRedline` destruction
  with Writer's SolarMutex. An actual URP crash occurred in `SvtBroadcaster`
  while `SwXRedlines::getByIndex` obtained temporary redline objects. The source
  has listener destruction outside the mutex; other Writer UNO classes already
  take the mutex in `release()`. Two separate patched processes completed 20
  rounds each of 600 temporary redline reads with identical identity/text hashes
  and normal UNO/worker exits. Reversing only this patch in the same source build
  reproduced SIGSEGV in the first round, with the same
  `SvtBroadcaster::Broadcast` → `SwXRedlines::getByIndex` stack. The shared
  `libmergedlo` hash was identical; only the rebuilt Writer library differed.
  This is a reproduced/fixed lifetime race, not proof that all native hangs or
  crashes are eliminated. Failure reports and the controlled-build hashes remain
  in the `2026-10-25-startup-data-migration` artifact directory.

The isolated build follows Ely's `scripts/build-libreoffice.sh` configuration,
including `--enable-mergelibs`, `--enable-release-build`, `--without-java` and
`--disable-python`. Its UNO test client continues to use the explicit read-only
26.2.2.2 Python runtime described above. No build result is installed, signed or
distributed by this prototype. The original downloaded engine remains the
baseline; its measurements must not be attributed to the new source build.

The verified patched runtime is frozen separately from the source build's
`instdir` before the negative-control rebuild. Use the frozen `runtime-patched`
bundle for subsequent measurements; an `instdir` left by the negative control
must not be mistaken for the patched engine. No runtime binary is committed.

## Match the existing resource packaging contract

A fresh source build leaves 65 dictionary extensions in `Resources/extensions`.
The first new profile registered all of them before the main queue became ready;
an owned-process sample placed every main-thread sample in
`SynchronizeExtensionRepositories`. The original Ely build script explicitly
keeps only `dict-en` and strips Python-only Lightproof assets. AI WorkDeck already
has the same en/zh selection in
`desktop/lowa-build/patches/apply-source-patches.py::slim_dictionaries`.

The performance candidate is a **separate copy** of the patched runtime under
`runtime-product/instdir/LibreOffice.app`, processed by that existing helper.
The 33 retained English resource files match the original Ely package by relative
path and SHA-256, including Hunspell, hyphenation and thesaurus data. All 3,457
unchanged files were hash-checked; all 718 differences are confined to extensions.
The engine libraries and fonts are unchanged. The frozen full-product WASM
metadata actually contains no dictionary extension files and retains its Chinese
resources; this is not a newly removed product spellcheck feature.

Keep the unprocessed runtime and failed/loaded timing observations. Measure fresh
profiles after packaging; do not seed an already-registered user profile and call
it first launch. The ready event still waits for the native main queue. Static
resource equality and an observed shorter registration phase do not by themselves
establish normal-load speed or full-product parity.
