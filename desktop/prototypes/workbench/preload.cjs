// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('prototype',{
 list:()=>ipcRenderer.invoke('prototype:list'),
 open:ids=>ipcRenderer.invoke('prototype:open',ids),
 close:()=>ipcRenderer.invoke('prototype:close'),
 save:()=>ipcRenderer.invoke('prototype:save'),
 paint:viewport=>ipcRenderer.invoke('prototype:paint',viewport),
 action:(action,params)=>ipcRenderer.invoke('prototype:action',action,params),
 writeClipboard:text=>ipcRenderer.invoke('prototype:write-clipboard',text),
 history:()=>ipcRenderer.invoke('prototype:history'),
 createVersion:title=>ipcRenderer.invoke('prototype:create-version',title),
 restore:ref=>ipcRenderer.invoke('prototype:restore',ref),
 painted:kind=>ipcRenderer.send('prototype:painted',kind),
 onEvent:listener=>{const handler=(_,event)=>listener(event);ipcRenderer.on('prototype:event',handler);return()=>ipcRenderer.removeListener('prototype:event',handler)},
 onFlush:listener=>{const handler=async(_,id)=>{try{await listener();ipcRenderer.send('prototype:flushed',id,true)}catch(error){ipcRenderer.send('prototype:flushed',id,false,String(error.message||error))}};ipcRenderer.on('prototype:flush',handler);return()=>ipcRenderer.removeListener('prototype:flush',handler)}
});
