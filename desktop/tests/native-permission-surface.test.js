// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path')
const {JSDOM}=require('../../frontend/node_modules/jsdom')
const input=require('../../frontend/src/composables/nativeDocumentInput.js')
const {pathToFileURL}=require('node:url')
const tick=()=>new Promise(r=>setImmediate(r))
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
async function harness(){
 const text=(await fs.readFile(path.join(__dirname,'../../frontend/src/composables/nativeOfficeSurface.js'),'utf8')).replace("import './nativeDocumentInput.js'",'')
  .replace(/from '(\.\.?\/[^']+)'/g,(_,specifier)=>`from '${pathToFileURL(path.resolve(__dirname,'../../frontend/src/composables',specifier)).href}'`)
 const {createNativeOfficeSurface}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))
 globalThis.AWDDocumentInput=input;globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.ImageData=class{constructor(){}}
 const dom=new JSDOM('<main></main>',{pretendToBeVisual:true});dom.window.HTMLCanvasElement.prototype.getContext=()=>({putImageData(){}})
 const calls=[],permissions=[],waiters=new Map();let epoch=0,seq=0,held=false,denied=false
 const api={onNativeEvent(){return()=>{}},async nativeClose(){},async nativeRequest(id,action,p){
  calls.push({action,p});if(action==='load_document')return{success:true,nativeModel:{documentEpoch:++epoch,viewId:0,widthTwips:1000,heightTwips:2000,readOnly:false,permissionSeq:seq,view:{zoom:100,ruler:false},layout:{unit:'twip',pages:[{x:0,y:0,width:1000,height:2000}]}},callbacks:[{callbackType:1,documentEpoch:epoch,viewId:0,payload:'10,10,0,100'}]}
  if(action==='set_read_only'){seq=p.permissionSeq;const reply={success:true,...p,lastInputSeq:0};if(!held)return reply;const d=deferred();permissions.push({p,resolve:value=>d.resolve(value||reply)});return d.promise}
  if(action==='native_paint')return{...p,width:1,height:1,heightTwips:2000,pixels:new Uint8Array(4)}
  if(action==='native_input'){if(denied&&p.action==='input_text')return{success:false,code:'READ_ONLY',inputNotConsumed:true};return{applied:true,documentEpoch:p.documentEpoch,viewId:0,lastInputSeq:p.params.inputSeq}}
  return{success:true}
 }}
 const surface=createNativeOfficeSurface({api,info:{sessionId:'permission'},document:dom.window.document});dom.window.document.querySelector('main').append(surface.element)
 Object.defineProperties(surface.element,{clientWidth:{value:600},clientHeight:{value:600}})
 surface.transport.subscribe(message=>{if(message.type==='result')waiters.get(message.reqId)?.(message.result)})
 let request=0
 const execute=(action,p={})=>new Promise(resolve=>{const reqId=++request;waiters.set(reqId,resolve);surface.transport.send({type:'exec',reqId,action,params:p})})
 return{surface,dom,calls,permissions,execute,hold(){held=true},deny(){denied=true},async close(){for(const p of permissions)p.resolve();await surface.dispose();dom.window.close()}}
}
test('permission arriving before load is applied before input is created',async()=>{
 const h=await harness();try{
  await h.surface.setReadOnly(true);h.hold();const opening=h.execute('load_document',{bytes:[1],name:'a.docx'});await tick()
  assert.equal(h.permissions.length,1);assert.equal(h.surface.element.querySelector('input'),null)
  h.permissions[0].resolve();assert.equal((await opening).success,true);assert.equal(h.surface.element.querySelector('input').readOnly,true)
 }finally{await h.close()}
})
test('late older grant cannot unlock newer revoke and retarget reapplies latest policy',async()=>{
 const h=await harness();try{
  await h.execute('load_document',{bytes:[1],name:'a.docx'});h.hold()
  const grant=h.surface.setReadOnly(false), revoke=h.surface.setReadOnly(true);await tick();const entry=h.surface.element.querySelector('input');assert.equal(entry.disabled,true)
  assert.equal(h.permissions.length,2);assert.ok(h.permissions[1].p.permissionSeq>h.permissions[0].p.permissionSeq)
  h.permissions[1].resolve();await revoke;assert.equal(entry.readOnly,true)
  h.permissions[0].resolve();await grant;assert.equal(entry.readOnly,true)
  const retarget=h.execute('load_document',{bytes:[2],name:'b.docx'});await tick();assert.equal(h.permissions[2].p.documentEpoch,2);assert.equal(h.permissions[2].p.readOnly,true)
  h.permissions[2].resolve();assert.equal((await retarget).success,true);assert.equal(h.surface.element.querySelector('input').readOnly,true)
 }finally{await h.close()}
})
test('invalid permission acknowledgement stays locked',async()=>{
 const h=await harness();try{
  await h.execute('load_document',{bytes:[1],name:'a.docx'});h.hold();const grant=h.surface.setReadOnly(false);await tick()
  h.permissions[0].resolve({success:true,readOnly:false,documentEpoch:99,permissionSeq:h.permissions[0].p.permissionSeq,lastInputSeq:0})
  await assert.rejects(grant,/permission/i);assert.equal(h.surface.element.querySelector('input').readOnly,true);assert.equal(h.surface.element.querySelector('input').disabled,true)
 }finally{await h.close()}
})
test('surface preserves explicit inputNotConsumed marker instead of poisoning input',async()=>{
 const h=await harness();try{
  await h.execute('load_document',{bytes:[1],name:'a.docx'});h.deny();const entry=h.surface.element.querySelector('input')
  entry.dispatchEvent(new h.dom.window.InputEvent('input',{bubbles:true,data:'拒绝',inputType:'insertText'}));await tick()
  assert.equal(entry.readOnly,true);assert.equal(entry.disabled,false)
 }finally{await h.close()}
})
test('load joins the latest permission request without exposing input between superseded receipts',async()=>{
 const h=await harness();try{
  await h.surface.setReadOnly(true);h.hold();const opening=h.execute('load_document',{bytes:[1],name:'a.docx'});await tick()
  const promote=h.surface.setReadOnly(false);await tick();assert.equal(h.permissions.length,2)
  h.permissions[0].resolve();await tick();assert.equal(h.surface.element.querySelector('input'),null);assert.equal(h.permissions.length,2)
  h.permissions[1].resolve();await promote;assert.equal((await opening).success,true);assert.equal(h.surface.element.querySelector('input').readOnly,false)
 }finally{await h.close()}
})
