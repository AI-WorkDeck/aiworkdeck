# Implementation Plan: Local LibreOffice WASM (Electron)

## Goal Description
Migrate from online WPS Web Office to a fully local, offline-capable LibreOffice WASM integration within the existing Electron desktop application. This will enable users to edit local documents without uploading them to a server.

## User Review Required
> [!IMPORTANT]
> **Performance Warning**: LibreOffice WASM binaries are large (hundreds of MB). First load might be slow.
> **Feature Gap**: "Chat with Selection" AI feature will require users to manually copy text or use a context-menu workaround, as WASM doesn't easily expose selection text to JS.

## Proposed Changes

### 1. Infrastructure (Static Resources)
#### [NEW] `frontend/static/libreoffice-wasm/`
-   Create directory to hold WASM binaries and resources.
-   **Action**: Download/Copy LibreOffice WASM build artifacts (e.g., from ZetaOffice or custom build) into this folder.
-   *Note*: We will use a placeholder or download script for the actual binaries in this plan.

### 2. Electron Main Process (Backend Replacement)
#### [NEW] `desktop/main/file-service.js`
-   Implement `LocalFileService` to handle `fs` operations safely.
-   `handle('fs:readFile', path)`
-   `handle('fs:writeFile', path, data)`

#### [MODIFY] `desktop/main/main.js`
-   Register `file-service` handlers.
-   Ensure `webSecurity: false` or proper CSP to allow loading WASM from local static resources.

#### [MODIFY] `desktop/preload/preload.js`
-   Expose `fs` API to renderer via `contextBridge`.

### 3. Frontend (Editor Component)
#### [NEW] `frontend/src/components/LocalEditor.vue`
-   **Template**: Container `<div>` for the WASM canvas/iframe.
-   **Script**:
    -   Initialize WASM module (e.g., `Module.init`).
    -   `loadDocument(filePath)`: Read via `window.electronAPI.fs.readFile`, pass buffer to WASM.
    -   `saveDocument()`: Get buffer from WASM, write via `window.electronAPI.fs.writeFile`.

#### [MODIFY] `frontend/src/pages/project-overview/project-overview.vue`
-   Replace `<WpsEditor>` with `<LocalEditor>` when running in Electron mode.
-   Add logic to detect Electron environment.

## Verification Plan

### Automated Tests
-   **Unit Tests**: None for WASM integration specifically (too complex to mock).
-   **Integration**: Verify `LocalFileService` using a simple script in Electron console.

### Manual Verification
1.  **Launch**: Run `npm run dev` in `desktop/`. App should launch.
2.  **Load Editor**: Navigate to a project file. The `LocalEditor` should appear instead of WPS.
3.  **WASM Load**: Verify 404s are gone and WASM resources load (Network tab).
4.  **File Open**: Double-click a `.docx` file. Content should render in the canvas.
5.  **Edit & Save**: Type text, click Save. Restart app, reopen file. changes should persist.
6.  **Offline**: Disconnect WiFi. App should still open and edit files.
