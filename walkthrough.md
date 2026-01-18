# Verification: Local LibreOffice Integration

## Overview
This walkthrough guides you through verifying the new Local LibreOffice WASM integration in the Electron desktop app.

## Prerequisites
1.  **Electron Environment**: You must run the app in Electron (`npm run dev` in `desktop/`).
2.  **Mock Binaries**: Ensure `frontend/static/libreoffice-wasm/soffice.js` exists (created by `download_libreoffice_wasm.sh`).

## Steps

### 1. Launch Desktop App
Run the following command in the `desktop` directory:
```bash
cd desktop
npm run dev
```
Wait for the Electron window to open.

### 2. Open a Document
1.  In the project file tree, find a `.docx` file.
2.  Double-click to open it.
3.  **Expected**: 
    -   The "Local LibreOffice WASM Placeholder" grey canvas should appear.
    -   Status bar should show "Initializing..." -> "File read success" -> "Mock Editor Ready".
    -   The file path should be displayed on the canvas.

### 3. Verify File I/O (Mock)
1.  Open the DevTools (Cmd+Option+I).
2.  Check the Console for `[LocalFileService]` logs.
    -   `Reading file: /path/to/your/file.docx`
3.  Click the **"保存 (Save)"** button in the editor toolbar.
4.  Check Console for:
    -   `Writing file: ...`
    -   `Save success`

### 4. Verify Fallback (Web Mode)
1.  Open the app in a normal browser (e.g., Chrome).
2.  Open the same `.docx` file.
3.  **Expected**: The standard WPS Web Office editor should load (if configured), or a file preview. The Local Editor should NOT appear.

## Troubleshooting
-   **White Screen / 404**: Check if `frontend/static/libreoffice-wasm/soffice.js` is loaded in Network tab.
-   **"Not in Electron environment"**: Ensure you are running via `npm run dev` in the `desktop` folder, and `preload.js` is correctly exposing `window.checkbaDesktop`.
