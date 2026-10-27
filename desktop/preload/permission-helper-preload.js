// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('checkbaPermissionHelper', {
  startAppDrag: () => ipcRenderer.invoke('checkba:permissions-start-app-drag'),
  reopenSettings: (id) => ipcRenderer.invoke('checkba:permissions-open-settings', { id, showFloatingHelper: false }),
  closeHelper: () => ipcRenderer.invoke('checkba:permissions-close-helper'),
  onState: (handler) => {
    const listener = (_evt, data) => handler && handler(data);
    ipcRenderer.on('checkba:permission-helper-state', listener);
    return () => ipcRenderer.removeListener('checkba:permission-helper-state', listener);
  },
});
