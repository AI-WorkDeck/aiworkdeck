# zh-CN LOWA engine rebuild recipe (with tooltip-CJK fix) — issue #66

## r6 (2026-10-20) — ElyOffice Tier A kernel patches + `#587` native review gutter + 45.3% `soffice.data` slimming (`#1371`)

Built on Singapore ECS `ecs.c9i.16xlarge` (64 vCPU / 128 GiB RAM, Intel Xeon 6982P-C, Ubuntu 22.04) from `distro/allotropia/zeta-24-2` (`dced3bc71`) with:
- Full `#587` Writer external review gutter geometry (`AwdReviewGeometry`, `AwdReviewSidebarWidth`, native comment card suppression & hit-test clamping).
- Curated ElyOffice Tier A kernel fixes (`0002` LOK dispatch to document frame, `0005` `JSDialogNotifyIdle` disposed-window guard in `vcl/jsdialog/jsdialogbuilder.cxx`, `0008` dialog-less `.uno:InsertMultiIndex` / `.uno:InsertCaptionDialog` / `.uno:InsertObjectStarMath`, `0009`/`0010` `.uno:WordCount` & `.uno:Outline` / `.uno:Bookmarks` twips rect command values in `sw/source/uibase/uno/loktxdoc.cxx`, `0011`/`0048` semicolon font-list & search-name missing-font check, `0013` `author` option in `lo_setOption`).
- `soffice.data` font + `Lightproof.py` slimming (`fs-image-patch.py --slim-dicts --slim-fonts`): strips 114 unused bundled font/Lightproof slices (`LinLibertine*`, `DejaVu*`, non-core script fonts), cutting `soffice.data` raw MEMFS unpack size from **103,340,944 bytes (98.55 MiB)** down to **56,494,002 bytes (53.88 MiB, -45.3%)** and brotli transfer size from **16.5 MiB** down to **7.92 MiB (-52.0%)**.

### r6 artifact sha256 (raw uncompressed bytes)
- `soffice.js`: `4134a43116a96db449d682b7e812a39c861eb9350f9f71c555ce5df1c35db9c9` (858,359 B)
- `soffice.wasm`: `31711fe5fc7070d939e1ac58a6a0875e5fa851409089e7648fe2f6516f52c388` (161,688,910 B raw / 45,471,642 B `.br`)
- `soffice.data`: `57937f2e22be0d354c3a448e905ac971ffc582891316e56cb29892bf8e390ce3` (56,494,002 B raw / 8,310,668 B `.br`)
- `soffice.data.js.metadata`: `871e91a4ef63866b518b559f4e3fdbedb59dcca418c56b5d60fb74d0d2b62945` (207,339 B)

## r3 (2026-08-02) — margin-redline table anchor fix

Built on mainland VM 8.156.75.91 (8C/30GB + 48G swap, Ubuntu 22.04) with the SAME
recipe below plus **source patch 4** (sw/source/core/text/frmpaint.cxx — anchor
ShowChangesInMargin deleted text at the TABLE frame's left edge via FindTabFrame,
so in-table deletions render in the true page margin instead of over the
neighboring cell). soffice.js + metadata sha are byte-identical to r2 — the only
behavioral delta is the wasm.
Mainland network note: emsdk's storage.googleapis.com downloads crawl — pre-seed
`emsdk/downloads/` (node via npmmirror; wasm-binaries relayed from an unrestricted
network). git clones via GitHub mirror are fine. 8C timings: qt5 ~6 min,
LO make ~5.8 h (swap carried the final link on 30G RAM).

### r3 artifact sha256
- soffice.js   ea337a9f4d9d2c74a8b0df9c8bf0c4b9c64f5fda770cd09e631dedd770e882e1  (== r2)
- soffice.wasm 792b9cb03ddd3d0f0ee4191c7d2ad5401405d33256681346c307bb1879a837b1
- soffice.data c4841c254079c686cf22a943cc911d5672d0e3b7f2a6049e7cf659abb0d95ddf
- soffice.data.js.metadata 7c5d27a650d5f0a0b4f08b9c096fa03c51c3233ea6fe4d179d530efdbf383fa2  (== r2)

## r2 (2026-06-26)

Built 2026-06-26 on Singapore VM 47.84.13.121 (32C/123GB RAM, Ubuntu 22.04), from
scratch. Reproduces the engine with: native zh-CN UI (--with-lang) + ooLocale=zh-CN
default + **the QToolTip CJK fix** (this round's new change).

## Artifact sha256 (r2 build)
- soffice.js   ea337a9f4d9d2c74a8b0df9c8bf0c4b9c64f5fda770cd09e631dedd770e882e1
- soffice.wasm a186dd5082eb69ef58fb57d256294d07817c4acfb06e63fc5901e77d07612954
- soffice.data e85af877e964f75f14b21b97f0a7103d104aea308ec8c687519412ace48deeb5
- soffice.data.js.metadata 7c5d27a650d5f0a0b4f08b9c096fa03c51c3233ea6fe4d179d530efdbf383fa2
  (metadata sha == previous engine: same file list/offsets; data content differs by build)

## Toolchain (exact)
- LO core: github.com/LibreOffice/core branch distro/allotropia/zeta-24-2 (rev dced3bc71)
  NOTE: git.libreoffice.org + gerrit.libreoffice.org are UNREACHABLE from this region.
  Use the GitHub mirror. Set: git config --global url."https://github.com/LibreOffice/".insteadOf
  for both git.libreoffice.org/ and gerrit.libreoffice.org/ (use --add for each).
  translations submodule resolves via relative URL ../translations -> github mirror (works).
  External tarballs (dev-www.libreoffice.org/src) ARE reachable.
- emscripten: github.com/allotropia/emscripten branch fixed-3.1.65 (the FORK, NOT stock).
- qt5: github.com/allotropia/qt5 branch 5.15.2+wasm (qtbase module subset).

## Fork emscripten install (the tricky bit)
1. clone emscripten-core/emsdk; ./emsdk install 3.1.65 && ./emsdk activate 3.1.65
   (gets node22 + llvm + binaryen for 3.1.65 + stock frontend at upstream/emscripten).
2. clone allotropia/emscripten (fixed-3.1.65) as the fork.
3. cp -a emsdk/upstream/emscripten/node_modules -> fork/node_modules (superset; skips npm ci).
4. echo "3.1.65" > fork/emscripten-version.txt  (was 3.1.65-git; must match emsdk SDK).
5. bootstrap stamps: mkdir fork/out; create out/{npm_packages,create_entry_points,git_submodules}.stamp
   future-dated (touch -d 2030-01-01) so bootstrap.check() passes. Also ensure these dep paths
   exist (else getmtime throws): test/third_party/posixtestsuite/, tools/maint/run_python.{sh,bat,ps1}.
6. swap: mv emsdk/upstream/emscripten emscripten.stock; ln -s <fork> emsdk/upstream/emscripten.
7. **EM_CONFIG MUST be exported** — emsdk_env.sh does NOT export it here, so emcc can't find
   LLVM_ROOT. env.sh:  source emsdk/emsdk_env.sh; export EM_CONFIG=<emsdk>/.emscripten
8. emcc --clear-cache; sanity: emcc hello.c -o hello.js && node hello.js.

## Build-as-root bypass
LO Makefile check-if-root uses `systemd-detect-virt -c -q` (container-only; a KVM VM fails it).
Put a fake at /usr/local/bin/systemd-detect-virt (#!/bin/sh\nexit 0), and PATH=/usr/local/bin:$PATH.

## Source patches (see source-patches.diff; apply with apply-source-patches.py)
1. solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk — export FS/callMain/specialHTMLTargets
   UNCONDITIONALLY (remove the `$(if $(ENABLE_QT6),...)` gate). Without this, a QT5 build
   does not export them -> integration breaks (uno_main/FS undefined). THE stock-vs-fork fix.
2. vcl/qt5/QtInstance.cxx — *** THE TOOLTIP-CJK FIX ***. In QtInstance::AfterAppInit(),
   QFontDatabase::addApplicationFont("/instdir/share/fonts/truetype/AAA-CJK.ttc") (the font
   the editor injects at preRun), then append its family to QApplication::font() families AND
   the "QTipLabel" class font so native QToolTip (which bypasses VCL/fontconfig) renders CJK.
   Graceful no-op if the font is absent.
3. static/CustomTarget_emscripten_fs_image.mk — pack zh-CN into soffice.data: Langpack-zh-CN,
   cjk_zh-CN, res/fcfg_langpack_zh-CN, res/registry_zh-CN, ZZZ-aiworkdeck-locale-zh-CN, and
   $(wildcard $(INSTROOT)/program/resource/zh_CN/LC_MESSAGES/*.mo) (25 .mo). The fs_image list
   is hand-curated (en-US only by default); --with-lang BUILDS zh-CN but does not auto-PACK it.
4. sw/source/core/text/frmpaint.cxx (or layout/frmpaint.cxx) — anchor ShowChangesInMargin
   deleted text at the outer table frame (`FindTabFrame()`) so in-table deletions render in
   the page margin instead of overlapping adjacent table cells.
5. Curated ElyOffice Tier A WASM/LOK stability & dialog-less UNO patches (`#1371`, see
   `ELYOFFICE_PATCH_AUDIT.md` and `upstream/elyoffice/`):
   - `desktop/source/lib/init.cxx`: route `doc_iniUnoCommands` (`lok::Document::unoCommand`)
     to the document frame (`GetDispatcher()->GetFrame()`) instead of an active JSDialog frame.
   - `vcl/jsdialog/executor.cxx` (or `vcl/inc/jsdialog/jsdialogregister.hxx`): guard
     `JSDialogRegister` against null/disposed weld widgets.
   - `vcl/source/font/fontcache.cxx` (or `PhysicalFontCollection.cxx`): guard glyph/font
     fallback when the physical font family list is empty in WASM.
   - `sw/source/uibase/uiview/viewtab.cxx`, `sw/source/uibase/shells/textsh1.cxx`,
     `sw/source/uibase/uiview/view2.cxx`, `sw/source/uibase/shells/txtnum.cxx`:
     dialog-less UNO JSON/parameter support for `.uno:PageSize` (`Height`/`Width`/`Landscape`),
     `.uno:ChapterNumberingDialog`, `.uno:FootnoteDialog`, `.uno:LineNumberingDialog`,
     `.uno:OutlineBullet` state JSON, and live `.uno:WordCountDialog` state (`words,chars | selWords,selChars`).
6. Dictionary & `Lightproof.py` slimming (`apply-source-patches.py --slim-dictionaries` and
   `fs-image-patch.py --slim-dicts`):
   - Strips broken WASM Python grammar checker files (`Lightproof.py`, `Lightproof.components`,
     `dict-en/pythonpath/*`, `dict-en/dialog/*`) that fail without a Python runtime in WASM.
   - Filters out unused European/African/South Asian Hunspell `dict-*` extensions from
     `RepositoryModule_host.mk` and `soffice.data` while strictly preserving `dict-en` and all
     `zh-CN` UI langpack `.xcd` / `.mo` resources.

## Build steps
- autogen.input (see file): --with-distro=LibreOfficeWASM32, --with-package-format=emscripten,
  --with-lang=en-US zh-CN, QT5DIR=..., --enable-ccache.
- git submodule update --init --depth 1 translations   (needed for --with-lang=zh-CN)
- ./autogen.sh && make -j32   (~24 min on 32C with cold ccache; final wasm link is RAM-heavy)
- Phase 6 (zh-CN bake): cp ZZZ-aiworkdeck-locale-zh-CN.xcd -> instdir/share/registry/;
  apply patch #3; rm workdir/CustomTarget/static/emscripten_fs_image/soffice.data* +
  workdir/installation/.../emscripten/soffice.data*; make -j32 again (repack, ~12 min).
- Artifacts: workdir/installation/LibreOffice/emscripten/soffice.{js,wasm,data} + .data.js.metadata.
  Verify metadata contains Langpack-zh-CN, registry_zh-CN, ZZZ-aiworkdeck, resource/zh_CN x25.

## Integration / verify
- fetch-lowa-assets.js (PR #68): LOWA_BASE_URL=file:///.../lowa-zhcn-engine/ -> bakes into dist.
- Real Chrome (headless can't render canvas): editor.html?verify=1&lowa=http://localhost:8799/lowa/
  Check: native menus/toolbar/dialogs Chinese (was already OK) AND hover-button tooltip Chinese
  (this round's target — previously tofu/□).
