# zh-CN LOWA engine rebuild recipe (with tooltip-CJK fix) — issue #66


## r7b candidate (2026-10-26) — real tooltip input transparency (#1515)

This follow-up retains the r7 header palette/font and input-clock fixes below,
and fixes the bare-canvas resize failure found during that validation. In WASM,
LibreOffice's real `SalFrameStyleFlags::TOOLTIP` frames now carry
`Qt::WindowTransparentForInput`; Qt's compositor skips those windows during hit
testing. Interactive ComboBox popups also use `Qt::ToolTip`, so filtering by the
window type would be incorrect. Painting, popup input and production wrapper
compensation remain intact. This is an **unpublished local candidate**; default
engine URLs and the installed client remain r6.

### Build and raw SHA-256

Exact core/Qt/toolchain pins are unchanged from r7. Build ran
12:33:12–13:07:25 UTC (34m13s); all four downloaded hashes match the build output.
Metadata is byte-identical to r7/r6, preserving all 1821 resources. The temporary
VM was confirmed absent at 13:09:35 UTC; its key pair, security group, vSwitch,
VPC and private transfer object were also deleted. Approximately 39 minutes at
the quoted rate is CNY12.33; both builds total about CNY26.26 compute, **an estimate
rather than the settled bill**, excluding traffic and billing adjustments.

| File | Bytes | SHA-256 |
|---|---:|---|
| soffice.js | 858359 | `5a8b4cc2218c40dfe1d41b9f26df85496b9e1ad7e862b32d8daa9c9212f8dd06` |
| soffice.wasm | 161689746 | `da328b5190fe02c7ce28023df663521a682da7004224214ebc0ce65243b29260` |
| soffice.data | 56494002 | `1671cf6dbb1bd0fb78add49a28f793dc39a1493ed4e070a4be511a9eeb13f2e0` |
| soffice.data.js.metadata | 207339 | `871e91a4ef63866b518b559f4e3fdbedb59dcca418c56b5d60fb74d0d2b62945` |

### Actual validation and limits

- Main task reran the final bare-canvas test against old r7: 47 style/selection
  assertions pass, then the column drag fails to converge. With r7b, isolated
  DPR1 and DPR2 each pass 57 assertions: **114 passed, zero skips**. Actual mouse
  gestures grow/shrink columns and rows, Undo restores dimensions, genuine
  double-click autofits, wheel scrolls, and strict XLSX export/reopen preserves
  content, formulas, formats and dimensions. Main task inspected both DPRs'
  mid-drag screenshots: the tooltip remains visible, and mouse release completes
  the resize. No hidden tooltip or native-toolbar spacing workaround is used.
- `native-font-popup.mjs` passes at both DPRs: real mouse opens the native font
  popup, selects Caladea, closes it, preserves cell value, and Undo restores
  Arial. UITest is used only to read native geometry, never `executeAction`.
  Its `getState()` may alter widget buffering; this is input coverage, **not**
  pixel/performance evidence. Header pixel tests use a separate geometry probe.
- Main task passes input-clock checks (slow clicks, true double-click, unchanged
  text) and selected-text drag/Undo with both production compensation and the
  test-only build without it. Multi-page drag/wheel also passes with background
  review enabled, reversal, release and ordinary scrolling. Source patch tests
  pass 20/20.
- The audit subagent reran the full engine suite: **607 passed, zero failed**,
  covering Word, Excel and PPT editing/export/reopen; all 15 font families and
  embedded PDF subsets pass. Main task read the original logs. PDF native
  browser/Electron routing/export/recovery contracts pass 13/13 separately;
  PDF preview does not use Qt WASM.
- The first r7b Calc run hit the five-minute test deadline before functional
  assertions. Its exact initialization stage and cause were not captured;
  simultaneous full-suite execution is only correlation. Separate fresh-browser
  DPR runs passed without product/startup changes. The interrupted evidence is
  retained, and the test now logs browser/request and initialization stages;
  its failure handler also tolerates an already-closed target. This does **not**
  establish a product startup fix or claim every first attempt passed. The final
  diagnostic version was also rerun by the main task at DPR1: 57/57 passed,
  with complete initialization and request logs.
- A second Codex agent reviewed the LO/Qt fix; the Qt patch author also performed
  self-review, not an independent approval. No Windows runtime, high-contrast,
  installed PDF interaction, full desktop autosave or client-upgrade acceptance
  is claimed. No release or deployment occurred.

Local evidence and raw candidate:
`/Users/zewei/.codex/artifacts/2026-10-26-calc-tooltip-1515/`.
The r7 observations below are historical; r7b supersedes its tooltip limitation.

## r7 candidate (2026-10-26) — Calc header chrome and Qt input clock (#1509 / #1511)

Built successfully from the exact source revisions pinned in `mega-build.sh` and
`patches/apply-qt-patches.py`, with Writer / Calc / Impress enabled. This is a
**local candidate, not a published engine**: default download URLs remain r6.
Scope and deferred kernel limitations: [REBUILD-2026-10-26.md](REBUILD-2026-10-26.md).

- Calc headers use bundled Liberation Sans 9pt and a local product-token palette.
  Document font, cell formatting, and global Qt colors are unchanged.
- Qt WASM mouse/wheel events use the existing elapsed-time overloads. Production
  wrapper compensation remains for older engines.
- Build ran 10:44:39–11:18:57 UTC. Four downloaded raw hashes match the VM output.
  Metadata is byte-identical to r6: all 1821 resource entries retained, including
  Writer/Calc/Impress and Chinese resources. Equal data length does not imply
  identical data bytes; build-generated content differs.
- The temporary VM was confirmed absent at 11:27:06 UTC; its key pair, security
  group, vSwitch, VPC and private transfer object were deleted. About 44 minutes
  at the quoted hourly rate is CNY13.93, excluding final billing adjustments.

### r7 candidate SHA-256 (raw bytes)

| File | Bytes | SHA-256 |
|---|---:|---|
| soffice.js | 858359 | `5a8b4cc2218c40dfe1d41b9f26df85496b9e1ad7e862b32d8daa9c9212f8dd06` |
| soffice.wasm | 161689617 | `d5c4547de758504d3ee23e66cbc173cccf982260add31f5f69a8157d8f4b6778` |
| soffice.data | 56494002 | `cc16ee337749e2e1035499519de06c479682e0ae8aeb362c1830550d62e7713c` |
| soffice.data.js.metadata | 207339 | `871e91a4ef63866b518b559f4e3fdbedb59dcca418c56b5d60fb74d0d2b62945` |

### Actual validation

Main Codex task used isolated Chrome and synthetic documents, with the same
wrapper for r6 and r7. Patch tests: 13/13. `calc-header-chrome.mjs`:
r6 has 72 expected palette/compact-font failures, 26 passes and 2 explicit resize
skips; r7 has 98 passes and the same 2 skips. DPR1/2, light/dark, 50/100/150% zoom,
whole-row/column clicks, wheel scroll and strict XLSX export/reopen preserve values,
formulas, fonts, formats and dimensions. Actual label ink changes from 12 CSSpx
to about 9 / 8.5 CSSpx. With `CALC_HEADER_RESIZE=1`, the audit agent additionally
passed 53 assertions each at DPR1/2 with native chrome visible: real column/row
dragging, two actual clicks for autofit, scrolling and strict export/reopen. r6
passes the same native resizing operations (36 expected style failures remain).
The main task then repeated the entire native-chrome matrix: 106/106 passed in
fresh browsers per DPI. One earlier same-browser second-engine startup exceeded
the 5-minute test deadline; the individual DPR2 rerun passed, and each DPI now
gets a fresh browser/worker lifetime. This isolates test cases, not a claimed
product startup fix; the interrupted run remains in local evidence.

This is **not** a pass for the hidden-chrome resize path: when headers touch the
canvas top, both engines can place the size tooltip beside the pointer, where
Qt's padded window hit-testing intercepts later mouse events. The existing
limitation was recorded in dev-board#1515 and is fixed by the r7b follow-up above.
The r7 tests preserved the tooltip and distinguished the two layouts; those
results alone did not establish a fix for this path.

`mouse-clock.mjs`: r6 fails same-point clicks 1.3 seconds apart; r7 passes it.
Both pass genuine fast double-click and content preservation. r7 additionally
passes selected-text dragging and Undo with production compensation and a
test-only build without compensation. The rapid pair is isolated from preceding
clicks by a distant click and a 1.3-second pause; otherwise the test itself can
create a legitimate triple-click. No raw `mnTime` instrumentation is claimed.

The Codex audit subagent ran the complete existing engine suite (607 passed,
0 failed), covering Word, Excel and PPT editing/export/reopen, and the multilingual
font suite (15 font families registered and PDF subsets embedded). The main task
read both original logs and separately passed the multi-page drag/wheel suite
on r6 and r7. These are engine/wrapper checks, not full desktop save timing.

PDF routing is a browser/Electron native preview in `FilePreview.vue`, not Qt
WASM. Its routing/export/recovery tests pass 13/13; this does not claim installed
PDF viewer interaction or annotation testing. Full desktop automatic saving,
Windows, accessibility high-contrast mode and packaged-client upgrade remain
outside this isolated-engine validation. No release or client upgrade occurred.

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
