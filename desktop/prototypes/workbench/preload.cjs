// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('prototype',{list:()=>ipcRenderer.invoke('prototype:list'),open:ids=>ipcRenderer.invoke('prototype:open',ids),save:text=>ipcRenderer.invoke('prototype:save',text),painted:kind=>ipcRenderer.send('prototype:painted',kind)});
