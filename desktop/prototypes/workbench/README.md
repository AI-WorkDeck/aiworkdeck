<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Visible native-component experiment

This small Electron host connects the isolated Swift/SQLite prototype to the native LibreOfficeKit worker. It lists real persisted projects/files, loads the selected document, displays actual native BGRA/RGBA pixels on a canvas, and submits a native DOCX export through the data service's generation-checked save. The production application never imports this folder.

This is a research surface, not an alternative production editor. Its canvas has no editing caret, mouse selection, pagination/scrolling, native IME candidate positioning, undo UI, toolbar, AI tool routing, version history or project switching. The separate text area tests HTML composition followed by native paste; it does not establish native document input parity. Only one document opens per process. Restart after an error; a failed or timed-out save must not be retried with a guessed generation.

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
5. Click the synthetic document; inspect actual text on white paper. Enter a marker in the separate text box and save. Independently read the resulting DOCX, verify the marker and original content/revision projection, restart the service and read the saved file again. Close the window, or create the `quit` sentinel under `run`, for normal cleanup.

A `paint` reply saying `pixelsChanged` is only a buffer sanity check. It is not evidence that readable document content appeared. Timing must externally observe the real window/canvas and retain screenshot intervals containing paper and ink. `projects-visible` and `body-visible` are diagnostic events after two animation frames, not replacements for those screenshot checks.

## Measurement limits

Keep the input DOCX byte-identical, reset processes/profiles, record fonts, viewport/DPR, source/binary hashes and background load, and alternate baseline/prototype runs. OS caches are not purged by this host. A tiny host with fewer capabilities cannot establish the complete product's speed or satisfy the user's unchanged-experience merge gate. Report component and experimental-window timings separately. Do not compare runs from different machine-load conditions or describe composition/paste as an OS IME acceptance test.
