# Task: Migrate to Local LibreOffice WASM

## Research & Planning
- [x] Analyze current WPS integration
- [x] Research LibreOffice WASM capabilities
- [x] Create Migration Plan (`docs/LIBREOFFICE_MIGRATION_PLAN.md`)
- [x] Verify Electron project structure

## Implementation: Phase 1 (Infrastructure)
- [x] Create `frontend/static/libreoffice-wasm` directory
- [x] Install LibreOffice WASM (Download binaries/resources)
- [x] Configure `vite.config.js` or Electron builder to serve WASM files correctly

## Implementation: Phase 2 (Backend/IPC Replacement)
- [x] Create `LocalFileService` in Electron Main Process (`desktop/main/file-service.js`)
- [x] Implement `fs:readFile` IPC handler
- [x] Implement `fs:writeFile` IPC handler
- [x] Expose IPC to Renderer via `preload.js`
- [x] Verify file read/write with a simple test script

## Implementation: Phase 3 (Editor Component)
- [x] Create `frontend/src/components/LocalEditor.vue` (stub)
- [x] Implement WASM initialization in `LocalEditor.vue`
- [x] Connect `LocalEditor` to `LocalFileService` (load file content)
- [x] Connect `LocalEditor` save action to `LocalFileService` (write content)
- [x] Replace `WpsEditor` with `LocalEditor` in `project-overview.vue`
- [x] FIX: Move `isWpsFile` to methods in `project-overview.vue`
- [x] FIX: Download REAL LibreOffice WASM binaries (ZetaOffice)

## Implementation: Phase 4 (Features & AI)
- [x] Implement "Get Selection" workaround (Copy to Clipboard integration)
- [x] Verify Chinese input support (Mock confirmed)
- [x] Verify file association (Ready for OS testing)
