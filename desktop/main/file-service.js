const fs = require('fs/promises');
const path = require('path');
const { ipcMain, dialog } = require('electron');

/**
 * Initialize local file service handlers
 */
function initLocalFileService() {
    console.log('[LocalFileService] Initializing...');

    // Handler: Read file
    ipcMain.handle('fs:readFile', async (event, filePath) => {
        try {
            console.log(`[LocalFileService] Reading file: ${filePath}`);
            // Security check: ensure path is valid string
            if (!filePath || typeof filePath !== 'string') {
                throw new Error('Invalid file path');
            }

            const buffer = await fs.readFile(filePath);
            // Return as Uint8Array (Node.js Buffer is compatible)
            return buffer;
        } catch (error) {
            console.error(`[LocalFileService] Error reading file: ${filePath}`, error);
            return { error: error.message };
        }
    });

    // Handler: Write file
    ipcMain.handle('fs:writeFile', async (event, { filePath, data }) => {
        try {
            console.log(`[LocalFileService] Writing file: ${filePath}, size: ${data ? data.byteLength : 0}`);
            if (!filePath || typeof filePath !== 'string') {
                throw new Error('Invalid file path');
            }

            // data should be Uint8Array or Buffer
            await fs.writeFile(filePath, Buffer.from(data));
            return { success: true };
        } catch (error) {
            console.error(`[LocalFileService] Error writing file: ${filePath}`, error);
            return { error: error.message };
        }
    });

    // Handler: Open File Dialog
    ipcMain.handle('fs:showOpenDialog', async (event, options) => {
        return await dialog.showOpenDialog(options);
    });
}

module.exports = {
    initLocalFileService
};
