<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Workflow editor acceptance

From `frontend`:

```sh
node tests/workflow-editor-ui/run.mjs /tmp/awd-workflow-editor-ui
node tests/workflow-editor-ui/menu.mjs /tmp/awd-workflow-menu-ui
```

`run.mjs` reuses the existing TTS test's temporary Uni H5 scaffolding, replaces its page and API fixtures, and compiles the production `BuiltinWorkflowEditor` and `useBuiltinWorkflows` again. It does not build business plugins or the complete app. All requests and records are synthetic; no credentials, production backend, editor engine or customer files are used. Its temporary build tree is removed on exit.

Coverage: 320/600/1000px in light/dark themes, horizontal overflow and field separation, native immediate input/save, draft retention under `v-show`, and project changes while an old read is pending. The fixture translates the production Chinese strings; it does not test the full application language integration. Outputs include screenshots, geometry, API payloads and results.

`menu.mjs` uses the existing plain-Vue ChatInterface fixture, actual mouse right-clicks at the right edge of a 320px panel, and checks the teleported menu fits both a 320px and 1000px viewport. It records Escape dismissal and visibility when the owner is hidden. Because this fixture is plain Vue, it does not claim Uni `tap` selection coverage. Full workbench wiring, installed Electron, native document overlay stacking, persistence on restart and real backend permissions remain separate acceptance steps.

Negative controls are confined to Vite transforms in the temporary build or dev server, never product files. They must exit nonzero:

```sh
WORKFLOW_EDITOR_NEGATIVE=layout node tests/workflow-editor-ui/run.mjs /tmp/awd-workflow-editor-negative
WORKFLOW_MENU_NEGATIVE=visibility node tests/workflow-editor-ui/menu.mjs /tmp/awd-workflow-menu-negative
```

The first disables the narrow-container layout, reproducing the original form overflow; the second removes the owner's visibility watcher, reproducing the stranded teleported menu.
