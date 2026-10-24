<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Native LibreOfficeKit component prototype

This macOS prototype loads a separately supplied native LibreOfficeKit runtime,
opens a synthetic DOCX, returns actual document tiles, edits and exports it, and
optionally exercises deep UNO calls. It does not change AI WorkDeck's default
engine, entry point, existing helper, frontend, Windows support, or release path.
It is a component capability test, not a complete editor or a performance result.

Read [UPSTREAM.md](UPSTREAM.md) before supplying a runtime. A stock macOS package
can expose `paintTile` while doing no painting; the locally verified runtime has
the Ely macOS patches. Keep all output and profiles in a dedicated scratch folder,
and use synthetic documents only. The worker refuses document paths outside its
supplied artifact root, but it is not a production isolation boundary.

## Build and run

Run from the repository root. Set `PROBE_OUT` to an existing scratch directory,
`LO_FRAMEWORKS` to an extracted supported app's `Contents/Frameworks`, and
`FIXTURE` to the agreed synthetic DOCX. The functional run directory must not
already exist. Do not run component probes during someone else's performance
measurement window.

```sh
xcrun clang++ -std=c++17 -fobjc-arc -framework Foundation \
  desktop/prototypes/native-lok/worker.mm -o "$PROBE_OUT/lok-probe"
xcrun clang desktop/prototypes/native-lok/python_host.c \
  -o "$PROBE_OUT/python-host"
python3 desktop/prototypes/native-lok/probe.py \
  --worker "$PROBE_OUT/lok-probe" --runtime "$LO_FRAMEWORKS" \
  --fixture "$FIXTURE" --out "$PROBE_OUT/function-run" \
  --uno-host "$PROBE_OUT/python-host" --uno-runtime "$LO_PYTHON_CONTENTS"
```

`LO_PYTHON_CONTENTS` is an explicit isolated compatible LibreOffice copy's `Contents`
directory with Python 3.12 and pyuno. The verified Ely runtime omits Python.
Omit the two UNO arguments to exercise only the C API. `python_host.c` loads the
Python framework library and calls its public `Py_BytesMain` entry point. The
installed Python launcher exited with signal 9 on the test machine; this small
host invokes its public runtime entry without changing native binaries,
signatures, or OS security settings.
An early run regenerated twelve sealed Python bytecode files in an installed
framework. The task restored exactly those twelve from the same official version,
checking each against the nested signature seal, and retained unrelated older
signature differences. The final driver requires explicit runtime paths, disables
bytecode writes, and points its cache prefix into the artifact directory. Use an
isolated extracted copy or a read-only mounted official runtime for the client.
It does not call `officehelper.bootstrap`.

The driver creates its own HOME, TMPDIR and profile, launches one worker, and
terminates only that owned process on failure. `result.json` records each actual
result, exit and cleanup. A successful process exit alone is not an acceptance
verdict: inspect all saved-content and UNO assertions. Preserve failed runs.
No real system IME is exercised by this driver.

## Protocol and lifecycle

Worker argv are `LO-Frameworks isolated-profile-file-URL artifact-root`.
Set `SAL_LOK_OPTIONS=unipoll`; call initialization and the native event loop on
the main thread. This worker reads stdin on a background thread and dispatches
all document operations onto the main queue. `runLoop` receives a non-null opaque
context. The ready event is emitted only when that queue can drain.

Each frame is exactly `[uint32 headerLength LE][uint32 binaryLength LE]`, then
UTF-8 JSON and optional raw binary. The total input payload is capped at 64 MiB.
Native stdout diagnostics are redirected to stderr. Requests carry `reqId` and
`action`; replies carry `type:result`, the same `reqId`, and `success`.
Callbacks and phase events can arrive between replies. This framing matches the
existing sidecar, but the action schema deliberately does not implement its full
product relay contract.

| Action | Inputs and meaning |
| --- | --- |
| `open` | Absolute `path` inside artifact root; one model per worker. Returns model size in twips. |
| `paint` | Pixel `width,height` and `xTwips,yTwips,widthTwips,heightTwips`; returns tightly packed four-byte pixels with `tileMode` and `changedBytes`. Verified mode 1 is BGRA. `pixelsChanged` means a sentinel was overwritten, not that the user saw text. |
| `values` | `command`, for example `.uno:AcceptTrackedChanges`; fails if the native API returns null. |
| `command` | `command` and JSON string `arguments`; `acceptedForDispatch` is not completion. Inspect the notified command callback and real state. |
| `key` | LOK `eventType,charCode,keyCode`; no OS key or IME adapter. |
| `paste` | UTF-8 text in binary frame; returns the native paste result. |
| `selected_text` | Reads the current text selection. |
| `save` | Absolute DOCX `path` inside artifact root; returns native export success. |
| `start_urp` | Optional test-only single-client loopback port; opens the public function-based URP bridge after accept. No authentication: never expose this beyond an isolated local experiment. |
| `shutdown` | Closes owned sockets, destroys the document and exits the isolated unipoll process. It does not test in-process kit teardown or restart recovery. |

A parent must independently paint the received tile into a visible view and
verify paper plus ink. Record process-ready, model-loaded, tile-completed, visible
body and interactive input as separate stages. Never substitute conversion or
load time for visible editor startup. Extract the runtime to SSD before comparing
against another SSD runtime; a mounted DMG is a different I/O condition.

## Locally verified scope and remaining gaps

The 2026-10-24 arm64/macOS 27 test used one exact 60-paragraph, 600-revision DOCX.
The successful engine produced real Chinese text and insertion/deletion marks,
returned 600 redlines, accepted native key input and Chinese text paste, and
exported a valid DOCX. XML validation concatenated text runs and compared every
original revision's type, author, date and text; original/final projections and
the 600 original clause order were retained. LibreOffice splits revision XML
nodes, so unchanged node counts or raw XML equality are incorrect criteria.

The optional UNO test bound the model by URL, read paragraphs and revision data,
verified a range's text before replacing it, exercised undo/redo, and restored
the user's revision display state. Use a typed `RedlineDisplayType` property:
writing `ShowChanges=false` alone silently failed. Final text then retained all
300 inserted clauses and excluded all 300 deleted clauses. This is a small set
of engine primitives, not the complete AI command, anchor or file-ID bridge.

`AwdReviewGeometry` and `AwdReviewSidebarWidth` were absent from this runtime.
The product's review geometry patches and complete command semantics still need
porting. Also unverified: actual macOS IME candidates/composition, keyboard and
mouse mapping, rich clipboard, fonts/layout equivalence, all document structures,
multi-document state, save failures/races, checkpoint/Git integration, retry and
crash recovery, all 607 existing engine assertions, minimum supported OS, and
complete product startup performance. A faster component does not waive these
requirements or authorize switching the default engine.
