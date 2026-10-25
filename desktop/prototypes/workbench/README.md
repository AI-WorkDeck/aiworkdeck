<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Visible native-component experiment

This small Electron host connects the isolated Swift/SQLite prototype to the native LibreOfficeKit worker. It lists real persisted projects/files, loads the selected document, displays actual native BGRA/RGBA pixels on a canvas, and submits a native DOCX export through the data service's generation-checked save. The production application never imports this folder.

This remains a research surface, not an alternative production editor. It now has a scrolling native canvas with real caret/selection callbacks, a caret-positioned Chromium input, composition cancellation/commit, undo/redo and a revision list. Optional URL-bound pyuno reads complete revision text and typed all/final display modes; without it the list explicitly labels engine descriptions as summaries. Revision operations use native IDs and fresh snapshots, not enumeration positions. `input_text` uses native extended text input, not paste.

An optional Java authority adapter reconnects synthetic existing H2 projects to their original IDs, files and Git versions. The Java process is the sole file writer. SQLite stores an observed project directory and unresolved-operation guards; it does not migrate H2. Version creation drains input and saving. Restore closes the native model, calls the original Java revert API, downloads the restored bytes and acknowledges a newly opened model. Clearing the directory snapshot preserves unresolved write guards.

Missing production capabilities include full AI command routing, the three-state patched page gutter, complete toolbar/writing suggestions, rich clipboard, multiple simultaneous documents and split view. Synthetic composition tests do not establish OS candidate-window behavior. The entire folder is excluded from the normal product entry point. A fast experimental window cannot satisfy the unchanged-experience merge gate.

## Reproduce

1. Build `../local-data` and `../native-lok` according to their READMEs. Use a verified unpacked runtime; reading a compressed disk image is a different performance condition.
2. Create a fresh artifact directory and a prototype profile inside it. Populate it through the local data service's real `projects.create`/`files.create` protocol using synthetic documents, then close stdin and wait for that service to exit. Do not use real work profiles.
3. Write a JSON configuration with these absolute paths:

```json
{
  "run": "/absolute/fresh-artifact-directory",
  "profile": "/absolute/fresh-artifact-directory/data-profile",
  "dataBinary": "/absolute/awd-local-data",
  "worker": "/absolute/lok-probe",
  "runtime": "/absolute/verified-runtime.app/Contents/Frameworks"
}
```

4. Launch the repository's Electron binary with `AWD_PROTOTYPE_CONFIG=/absolute/config.json` and `desktop/prototypes/workbench/main.cjs` as the entry point. Supply an isolated `HOME` and `TMPDIR` to the Electron parent too. The host gives both children their own task paths, closes them on quit, and records lifecycle events. It must never attach to a user's existing LibreOffice or data service.
5. Click the synthetic document; inspect actual text on white paper. Click within the actual document, enter a marker and save. Use the review list to locate, accept/reject and undo. Independently read the resulting DOCX, verify the marker and original content/revision projection, restart the service and read the saved file again. Close the window, or create the `quit` sentinel under `run`, for normal cleanup.

A `paint` reply saying `pixelsChanged` is only a buffer sanity check. It is not evidence that readable document content appeared. Timing must externally observe the real window/canvas and retain screenshot intervals containing paper and ink. `projects-visible` and `body-visible` are diagnostic events after two animation frames, not replacements for those screenshot checks.

## Measurement limits

Keep the input DOCX byte-identical, reset processes/profiles, record fonts, viewport/DPR, source/binary hashes and background load, and alternate baseline/prototype runs. OS caches are not purged by this host. A tiny host with fewer capabilities cannot establish the complete product's speed or satisfy the user's unchanged-experience merge gate. Report component and experimental-window timings separately. Do not compare runs from different machine-load conditions or describe composition/paste as an OS IME acceptance test.

## Optional existing-project compatibility

`authority` configuration replaces `dataBinary/profile`; see `../local-data/compatibility/README.md`. The host starts only the explicitly configured owned Java child and verifies its build/profile identity. All HOME/temp/H2/storage paths must belong to a new synthetic artifact directory. Do not point this experiment at a production profile.

Full revision text requires `unoHost` (the small public-Python-ABI test host) and `unoRuntime` (the **Contents** folder of an explicitly isolated or read-only LibreOffice runtime). Never use Python from an installed application: even imports can modify sealed bytecode resources. The host sets `PYTHONDONTWRITEBYTECODE` and a task-local cache prefix. The helper connects only to this worker's random loopback URP port and binds every request to exactly one Writer model URL.

Functional checks:

```sh
node --test desktop/prototypes/workbench/tests/*.test.js
COMPAT_TEST_OUTPUT=/absolute/fresh-test-output node --test desktop/prototypes/local-data/compatibility/*.test.cjs
```

Keep all real-runtime functional and timing artifacts outside the repository. Record failures as well as successful runs, inspect saved DOCX contents and check every owned process has exited. No timing claim is valid merely because a callback says the document loaded.
