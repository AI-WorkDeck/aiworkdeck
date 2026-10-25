// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test=require('node:test'),assert=require('node:assert/strict')
const {JSDOM}=require('../../frontend/node_modules/jsdom')
const {createDocumentInput}=require('../../frontend/src/composables/nativeDocumentInput.js')
const tick=()=>new Promise(r=>setImmediate(r))
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
function harness(request) {
 const dom=new JSDOM('<div><canvas></canvas></div>',{pretendToBeVisual:true}),calls=[],errors=[]
 const controller=createDocumentInput({canvas:dom.window.document.querySelector('canvas'),viewport:()=>({xTwips:0,yTwips:0,widthTwips:1500,heightTwips:1500,cssWidth:100,cssHeight:100}),
  request:async(action,params)=>{calls.push({action,params});if(request)return request(action,params);return{applied:true,documentEpoch:1,viewId:0,lastInputSeq:params.inputSeq}},onError:error=>errors.push(error)})
 controller.setDocument({documentEpoch:1,viewId:0,readOnly:false});controller.handleCallback({callbackType:1,documentEpoch:1,viewId:0,payload:'100,100,0,100'})
 const input=dom.window.document.querySelector('input')
 return{controller,input,dom,calls,errors,type:text=>input.dispatchEvent(new dom.window.InputEvent('input',{bubbles:true,data:text,inputType:'insertText'})),close(){controller.dispose();dom.window.close()}}
}
test('revocation during IME locks immediately and late completion cannot replay after regrant',async()=>{
 const h=harness();try{
  h.input.dispatchEvent(new h.dom.window.CompositionEvent('compositionstart',{bubbles:true}))
  h.controller.setReadOnly(true,{pending:true});assert.equal(h.input.readOnly,true);assert.equal(h.controller.getState().composing,true)
  h.controller.setReadOnly(false,{pending:false})
  h.input.dispatchEvent(new h.dom.window.CompositionEvent('compositionend',{bubbles:true,data:'旧候选'}));h.type('旧候选');await tick()
  assert.equal(h.calls.filter(x=>x.action==='input_text').length,0)
  h.type('新的输入');await h.controller.flush();assert.deepEqual(h.calls.filter(x=>x.action==='input_text').map(x=>x.params.text),['新的输入'])
  assert.equal(h.errors.length,0)
 }finally{h.close()}
})
test('known host rejection does not consume native sequence or replay rejected text',async()=>{
 const held=deferred();let text=0,last=0
 const h=harness(async(action,params)=>{
  if(action==='input_text'&&++text===1)return held.promise
  if(action.startsWith('input_')){assert.equal(params.inputSeq,action==='input_barrier'?last:last+1);last=params.inputSeq}
  return{applied:true,documentEpoch:1,viewId:0,lastInputSeq:last}
 });try{
  h.type('拒绝的字');h.type('后一个字');await tick();h.controller.setReadOnly(true,{pending:true})
  held.reject(Object.assign(Error('read only'),{code:'READ_ONLY',inputNotConsumed:true}));await tick()
  h.controller.setReadOnly(false);h.type('再输入');const barrier=await h.controller.flush()
  assert.equal(h.controller.getState().failed,false);assert.equal(h.errors.length,0)
  assert.deepEqual(h.calls.filter(x=>x.action==='input_text').map(x=>x.params.inputSeq),[1,1])
  assert.equal(barrier.lastInputSeq,1);assert.equal(h.controller.getState().inputSeq,3)
 }finally{h.close()}
})
test('permission-looking error without explicit unconsumed proof remains fatal',async()=>{
 const h=harness(async()=>{throw Object.assign(Error('uncertain'),{code:'READ_ONLY'})});try{
  h.type('未知结果');await tick();assert.equal(h.controller.getState().failed,true);assert.equal(h.errors.length,1)
  await assert.rejects(h.controller.flush(),/uncertain/)
 }finally{h.close()}
})
test('pending permission blocks mouse and shortcuts; confirmed read-only still permits selection',async()=>{
 const h=harness();try{
  const canvas=h.dom.window.document.querySelector('canvas')
  h.controller.setReadOnly(true,{pending:true})
  canvas.dispatchEvent(new h.dom.window.MouseEvent('mousedown',{bubbles:true,button:0}));h.input.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{bubbles:true,key:'ArrowRight'}));await tick();assert.equal(h.calls.length,0)
  h.controller.setReadOnly(true,{pending:false});h.input.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{bubbles:true,key:'ArrowRight'}));await tick()
  assert.ok(h.calls.some(x=>x.action==='input_key'));h.type('禁止');await tick();assert.equal(h.calls.filter(x=>x.action==='input_text').length,0)
 }finally{h.close()}
})
test('late refusal from an older permission epoch cannot re-lock a confirmed new grant',async()=>{
 const held=deferred();let first=true
 const h=harness(async(action,p)=>{if(action==='input_text'&&first){first=false;return held.promise}return{applied:true,documentEpoch:1,viewId:0,lastInputSeq:p.inputSeq}})
 try{
  h.type('旧输入');await tick();h.controller.setReadOnly(true,{pending:true});h.controller.setReadOnly(false)
  held.reject(Object.assign(Error('old refusal'),{code:'READ_ONLY',inputNotConsumed:true}));await tick()
  assert.equal(h.input.readOnly,false);h.type('新输入');await h.controller.flush();assert.equal(h.errors.length,0)
 }finally{h.close()}
})
