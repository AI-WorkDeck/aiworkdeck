<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Upstream Provenance

This root `UPSTREAM.md` tracks the upstream projects, branches, commits, licenses, and local adaptation paths integrated into AI WorkDeck, complementing subsystem-specific provenance docs ([`frontend/src/zetaoffice/public/UPSTREAM.md`](frontend/src/zetaoffice/public/UPSTREAM.md) and [`litviz/UPSTREAM.md`](litviz/UPSTREAM.md)) as well as [`REUSE.toml`](REUSE.toml) and [`legal/THIRD-PARTY-COMPONENTS.md`](legal/THIRD-PARTY-COMPONENTS.md).

## 1. LibreOffice WASM (LOWA) & ZetaJS

| Field | Value |
|---|---|
| Upstream Project | LibreOffice (`core`) / Allotropia ZetaOffice |
| Upstream Repository | `https://github.com/LibreOffice/core` (`distro/allotropia/zeta-24-2`, rev `dced3bc711d18407a2cc2400eb46e8261b663d95`) |
| Companion Toolchains | `https://github.com/allotropia/emscripten` (`fixed-3.1.65`), `https://github.com/allotropia/qt5` (`5.15.2+wasm`), `https://github.com/allotropia/zetajs` |
| Upstream License | `MPL-2.0` (LibreOffice core / LOWA binary assets), `MIT` (`zeta.js` wrapper) |
| Local Paths | `desktop/lowa-build/`, `frontend/src/zetaoffice/public/` |
| Subsystem Provenance | [`frontend/src/zetaoffice/public/UPSTREAM.md`](frontend/src/zetaoffice/public/UPSTREAM.md) |

The Calc header adaptation in `desktop/lowa-build/patches/apply-source-patches.py` targets
`sc/source/ui/view/hdrcont.cxx` at the LibreOffice commit above; its original
MPL-2.0 notice remains unchanged. The Qt WASM input-clock adaptation in
`desktop/lowa-build/patches/apply-qt-patches.py` targets allotropia
`qt5@3d440b7787f9b5ba15e5f8bcd7aef39b388f94fa`, whose `qtbase` submodule is
`a320678c85ec8029d5394bcd673d4c208af1de3a`. The target
`src/plugins/platforms/wasm/qwasmeventtranslator.cpp` retains its Copyright
(C) 2018 The Qt Company Ltd. notice and GPL version 3 or later license header.
The adaptation uses the existing Qt elapsed-time mouse/wheel overloads; it
does not copy another editor's implementation. Build source revisions are
pinned in `desktop/lowa-build/mega-build.sh`.

The tooltip input adaptation (#1515) in the same patchers targets
`vcl/qt5/QtFrame.cxx` (LibreOffice revision above, original MPL-2.0 header retained)
and `src/plugins/platforms/wasm/qwasmcompositor.cpp` (qtbase revision above,
original Qt Company 2018 GPL-3.0-or-later header retained). On WASM, real VCL
tooltip frames receive `WindowTransparentForInput`, and compositor hit testing
honors that flag. Interactive combo popups also use the `ToolTip` window type;
their branch remains unchanged. Painting, stacking and mouse clocks are unchanged.

### Local Modifications (`desktop/lowa-build/`)

- **`patches/apply-source-patches.py` & `patches/source-patches.diff`**:
  - Unconditional export of `FS`, `callMain`, and `specialHTMLTargets` in `solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk` for QT5 WASM builds.
  - Native `QToolTip` CJK font registration (`AAA-CJK.ttc`) in `vcl/qt5/QtInstance.cxx`.
  - Track-changes `ShowChangesInMargin` table cell anchor fix (`FindTabFrame()`) in `sw/source/core/text/frmpaint.cxx`.
  - Native Writer review gutter & geometry property interface (`AwdReviewGeometry`, `AwdReviewSidebarWidth`) archived in `desktop/lowa-build/upstream/0003-native-review-geometry-and-gutter.patch`.
- **`patches/fs-image-patch.py` & `patches/ZZZ-aiworkdeck-locale-zh-CN.xcd`**:
  - Packs `zh-CN` UI message catalogs (`.mo`) and registry `.xcd` files into `soffice.data` and sets `ooLocale=zh-CN`.
  - Strips broken WASM Python grammar checker files (`Lightproof.py`, `Lightproof.components`, `dict-en/pythonpath/*`, `dict-en/dialog/*`) and unused non-`zh`/`en` Hunspell dictionary extensions (`dict-*`).

---

## 2. ElyOffice (Curated LibreOffice Kernel Patches & Build Slimming)

| Field | Value |
|---|---|
| Upstream Project | ElyOffice |
| Upstream Repository | `https://git.zacharyzhang.com/ZacharyZhang-NY/ElyOffice` |
| Upstream Version / Commit | `0.1.8` / `0d991e1c715859abd1282981fd46989e7e2319c7` (2026-04-06) |
| Upstream Copyright | Copyright (C) Zachary Zhang and ElyOffice contributors |
| Upstream License | `AGPL-3.0-or-later` (outbound-compatible with AI WorkDeck `AGPL-3.0-or-later`; LibreOffice C++ kernel modifications remain `MPL-2.0` / `AGPL-3.0-or-later` outbound compatible) |
| Local Paths | `desktop/lowa-build/upstream/elyoffice/`, `desktop/lowa-build/ELYOFFICE_PATCH_AUDIT.md`, `desktop/lowa-build/patches/apply-source-patches.py`, `desktop/lowa-build/patches/fs-image-patch.py` |

### Curated Patches & Adaptations

Full 51-patch audit and Tier A / Tier B classification are documented in [`desktop/lowa-build/ELYOFFICE_PATCH_AUDIT.md`](desktop/lowa-build/ELYOFFICE_PATCH_AUDIT.md).

1. **Curated Upstream Patch Archive (`desktop/lowa-build/upstream/elyoffice/`)**:
   - `0002-fix-lok-route-dispatchCommand-to-doc-frame-when-JSDi.patch` — Route `lok::Document::unoCommand` to the document frame instead of an active JSDialog frame.
   - `0005-fix-jsdialog-skip-disposed-weld-widgets-in-remember_.patch` — Guard `JSDialogRegister` against null/disposed weld widgets.
   - `0006-fix-vcl-guard-EmptyFontFallback-against-empty-font-l.patch` — Guard `EmptyFontFallback` / `GetGlyphFallbackFont` when the WASM font list is empty.
   - `0008-feat-lok-intercept-PageDialog-on-WASM-with-async-JSD.patch` — Intercept synchronous `.uno:PageDialog` on WASM (`#ifdef EMSCRIPTEN`).
   - `0009-feat-lok-intercept-FontDialog-ParagraphDialog-Outline.patch` — Intercept `FontDialog`, `ParagraphDialog`, and `OutlineBullet` on WASM.
   - `0010-feat-lok-extend-AttrChanged-payload-with-margins-gut.patch` — Extend LOK `STATE_CHANGED` / `AttrChanged` JSON payload with margins, gutter, orientation, columns, and line numbering.
   - `0011-feat-lok-add-ApplyPageSetup-ApplyColumns-direct-SfxI.patch` — Direct `SfxItemSet` UNO commands (`ApplyPageSetup`, `ApplyColumns`, `ApplyFontDialog`, `ApplyParagraphDialog`) for WASM.
   - `0013-feat-lok-direct-line-numbering-and-drop-caps-apply-v.patch` — Direct `SfxItemSet` application for Line Numbering and Drop Caps on WASM.
   - `0043-fix-sw-support-PageSize-height-width-params-and-Page.patch` — Parse `Height`/`Width`/`Landscape` parameters in `.uno:PageSize` (`SID_ATTR_PAGE_SIZE`).
   - `0045-feat-sw-expose-live-word-and-character-counts-via-.u.patch` — Expose live Writer word/character counts (`SwDocStat`) in `.uno:WordCountDialog` state queries.
   - `0048-feat-lok-expose-current-outline-numbering-config-via.patch` — Expose current chapter/outline numbering configuration as JSON via `.uno:OutlineBullet` state queries.
   - `0049-feat-sw-support-JSON-payload-in-.uno-ChapterNumberin.patch` — Accept JSON payloads in `.uno:ChapterNumberingDialog` to update `SwNumRule` directly without modal dialogs.
   - `0050-feat-sw-support-JSON-payload-in-.uno-FootnoteDialog-.patch` — Expose and accept JSON payloads in `.uno:FootnoteDialog` (`GetFootnoteInfo` / `SetFootnoteInfo`).
   - `0051-feat-sw-support-JSON-payload-in-.uno-LineNumberingDi.patch` — Expose and accept JSON payloads in `.uno:LineNumberingDialog` (`GetLineNumberInfo` / `SetLineNumberInfo`).
2. **Build & Image Slimming (`apply-source-patches.py`, `fs-image-patch.py`)**:
   - Adapted from ElyOffice `scripts/build-libreoffice.sh` (`Step 2b` and `Step 5b`): strips unused non-`zh`/`en` Hunspell dictionaries (`dict-*`) from `RepositoryModule_host.mk` / `CustomTarget_emscripten_fs_image.mk` / `soffice.data` and strips broken `Lightproof.py` grammar checker files while preserving `dict-en` and `zh-CN` UI localization resources.

---

## 3. LitViz (`@ checks/litviz`)

See [`litviz/UPSTREAM.md`](litviz/UPSTREAM.md) for upstream provenance of the LitViz visualization workspace.
