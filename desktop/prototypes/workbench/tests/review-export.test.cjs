// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {exportWithInlineRevisions}=require('../review-export.cjs');

test('an inline document exports without toggling its view',async()=>{
 const calls=[];
 const bytes=await exportWithInlineRevisions(async p=>{calls.push(p);return {mode:'all'}},async()=>{calls.push('export');return 'bytes'});
 assert.equal(bytes,'bytes');assert.deepEqual(calls,[undefined,'export']);
});
for(const mode of ['final','balloons','margin'])test(`exports in inline view then restores ${mode} before returning bytes`,async()=>{
 const calls=[];
 const result=await exportWithInlineRevisions(async p=>{calls.push(p);return {mode:p?.mode||mode}},async()=>{calls.push('export');return 'bytes'});
 assert.equal(result,'bytes');assert.deepEqual(calls,[undefined,{mode:'all',internal:true,refresh:true},'export',{mode,internal:true,refresh:true}]);
});
test('failed export restores the view and never returns publishable bytes',async()=>{
 const calls=[];
 await assert.rejects(exportWithInlineRevisions(async p=>{calls.push(p);return {mode:'final'}},async()=>{throw Error('export failed')}),/export failed/);
 assert.deepEqual(calls,[undefined,{mode:'all',internal:true,refresh:true},{mode:'final',internal:true,refresh:true}]);
});
test('failed restoration rejects after export instead of reporting a saved document',async()=>{
 let exported=false,published=false;
 await assert.rejects((async()=>{
  await exportWithInlineRevisions(async p=>{if(p?.mode==='final')throw Error('restore failed');return {mode:'final'}},async()=>{exported=true;return 'bytes'});
  published=true;
 })(),/restore failed/);
 assert.equal(exported,true);assert.equal(published,false);
});
test('failed inline switch attempts restoration and never exports',async()=>{
 const calls=[];
 await assert.rejects(exportWithInlineRevisions(async p=>{calls.push(p);if(p?.mode==='all')throw Error('switch failed');return {mode:'balloons'}},async()=>{throw Error('must not export')}),/switch failed/);
 assert.deepEqual(calls,[undefined,{mode:'all',internal:true,refresh:true},{mode:'balloons',internal:true,refresh:true}]);
});
test('unreadable state refuses export',async()=>{
 let exported=false;
 await assert.rejects(exportWithInlineRevisions(async()=>({mode:'unknown'}),async()=>{exported=true}),/状态不可读/);
 assert.equal(exported,false);
});
