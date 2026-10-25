// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual renderer with a synthetic transport; not a real native/UI timing test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('../../../../frontend/node_modules/jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('DOM state timed out');await wait(5)}}
function harness(options={}){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const source=fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://prototype.invalid/'});
 const w=dom.window,doc=w.document,marks=[],calls=[],batches=[],inputs=[];
 let epoch=1,prefix='old',summary=0,count=3,onEvent,inputRequest,onChanged,trackingHandler;
 const model=()=>({documentEpoch:epoch,viewId:0,widthTwips:12000,heightTwips:15000,trackingReady:true,recordChanges:true});
 w.ImageData=class{constructor(pixels,width,height){this.pixels=pixels;this.width=width;this.height=height}};
 w.HTMLCanvasElement.prototype.getContext=()=>({putImageData(){}});
 Object.defineProperty(doc.querySelector('#viewport'),'clientWidth',{value:800});
 Object.defineProperty(doc.querySelector('#viewport'),'clientHeight',{value:600});
 w.AWDDocumentInput={createDocumentInput:settings=>{
  inputRequest=settings.request;onChanged=settings.onChanged;
  const state={suspended:false,resumes:0,disposed:false};inputs.push(state);
  return {setDocument(){},handleCallback(){},viewportChanged(){},flush:async()=>{},
   suspend:async()=>{if(options.composing)throw Error('COMPOSITION_ACTIVE');state.suspended=true},
   resume(){state.resumes++;state.suspended=false},dispose(){state.disposed=true}};
 }};
 w.prototype={
  list:async()=>({projects:[{id:1,name:'Synthetic project',files:[{id:1,name:'test.docx'}]}]}),
  open:async()=>({...model(),...options.openState}),
  close:async()=>{},save:async()=>({saved:true,dirty:false}),writeClipboard:async()=>{},
  paint:async()=>({pixels:[255,255,255,255],width:1,height:1,yTwips:0}),
  onFlush(){},onEvent:listener=>{onEvent=listener},painted:name=>marks.push(name),
  action:async(action,params)=>{
   calls.push({action,params});
   if(action==='review_snapshot')return {documentEpoch:epoch,refreshEpoch:++summary,hydratedCount:0,batchSize:2,
    items:Array.from({length:count},(_,i)=>({revisionId:prefix+'-'+i,author:'Reviewer',type:'Delete',description:prefix+' summary '+i,text:null,textAvailable:false}))};
   if(action==='review_batch')return new Promise((resolve,reject)=>batches.push({params,prefix,count,resolve,reject}));
   if(action==='review_tracking')return trackingHandler?trackingHandler(params):{documentEpoch:epoch,enabled:params.enabled,changed:true,modified:true};
   return {applied:true,documentEpoch:params.documentEpoch,viewId:0,lastInputSeq:params.inputSeq};
  }
 };
 w.eval(source);
 return {dom,w,doc,marks,calls,batches,inputs,
  async open(){await until(()=>doc.querySelector('#projects button'));doc.querySelector('#projects button').click();await until(()=>batches.length===1)},
  complete(index){const b=batches[index],end=Math.min(b.params.start+b.params.limit,b.count);b.resolve({documentEpoch:b.params.documentEpoch,refreshEpoch:b.params.refreshEpoch,start:b.params.start,nextOffset:end,total:b.count,
   items:Array.from({length:end-b.params.start},(_,i)=>({revisionId:b.prefix+'-'+(b.params.start+i),identifier:'uno-'+b.prefix+'-'+(b.params.start+i),text:b.prefix+' complete full text '+(b.params.start+i),textAvailable:true}))})},
  input:()=>inputRequest('input_text',{inputSeq:1,text:'interleaved'}),
  setTrackingHandler:handler=>{trackingHandler=handler},
  addRevision(){count++;onChanged({action:'input_text'});onEvent({type:'callback',callbackType:30,documentEpoch:epoch})},
  changed(callbackEpoch=epoch){onEvent({type:'callback',callbackType:31,documentEpoch:callbackEpoch})},
  replace(){epoch++;prefix='new';count=3;onEvent({type:'document-closed'});onEvent({type:'document-opened',model:model()})},
  close(){onEvent({type:'document-closed'});dom.window.close()}
 };
}

test('summary cards are disabled, each completed batch enables only its own cards, and input gets a turn',async()=>{
 const h=harness();
 try{
  await h.open();const cards=[...h.doc.querySelectorAll('.item')];assert.equal(cards.length,3);
  assert.ok(cards.every(card=>[...card.querySelectorAll('button')].every(button=>button.disabled)));
  assert.ok(h.marks.includes('review-summary'));assert.equal(h.marks.includes('review-ready'),false);
  h.complete(0);
  // The next batch is delayed by a renderer timer, so a queued input event can run.
  await new Promise(resolve=>h.w.setTimeout(()=>{h.input().then(resolve)},0));await until(()=>h.batches.length===2);
  assert.ok([...cards[0].querySelectorAll('button')].every(button=>!button.disabled));
  assert.ok([...cards[2].querySelectorAll('button')].every(button=>button.disabled));
  assert.equal(h.doc.querySelectorAll('.item')[0],cards[0]);
  assert.equal(h.calls.filter(c=>c.action==='input_text').length,1);
  assert.ok(h.calls.findIndex(c=>c.action==='input_text')<h.calls.findIndex(c=>c.action==='review_batch'&&c.params.start===2));
  assert.equal(h.marks.includes('review-ready'),false);
  h.complete(1);await until(()=>h.marks.includes('review-ready'));
  assert.equal(h.doc.querySelector('#revision-count').textContent,'3 处修订');
  assert.ok([...h.doc.querySelectorAll('#revision-items button')].every(button=>!button.disabled));
  assert.equal(cards[2].querySelector('p').textContent,'old complete full text 2');
 }finally{h.close()}
});

test('unconfirmed default tracking never mounts an editable document',async()=>{
 const h=harness({openState:{trackingReady:false}});
 try{
  await until(()=>h.doc.querySelector('#projects button'));h.doc.querySelector('#projects button').click();
  await until(()=>h.doc.querySelector('#status').textContent.includes('初始化未确认'));
  assert.equal(h.inputs.length,0);assert.equal(h.batches.length,0);assert.equal(h.marks.includes('body-visible'),false);
  assert.equal(h.doc.querySelector('#tracking').disabled,true);
 }finally{h.close()}
});

test('tracking toggle drains input and shows only confirmed state; composition blocks mutation',async()=>{
 for(const composing of [false,true]){
  const h=harness({composing});
  try{
   await h.open();const button=h.doc.querySelector('#tracking');assert.equal(button.getAttribute('aria-pressed'),'true');
   button.click();await until(()=>!button.disabled);
   const toggles=h.calls.filter(c=>c.action==='review_tracking');
   assert.equal(toggles.length,composing?0:1);
   assert.equal(button.getAttribute('aria-pressed'),String(composing));
   assert.equal(h.inputs[0].suspended,false);
   if(!composing)assert.equal(h.doc.querySelector('#status').textContent,'待保存');
  }finally{h.close()}
 }
});

test('failed tracking readback leaves input and controls disabled',async()=>{
 const h=harness();
 try{
  await h.open();h.setTrackingHandler(()=>({documentEpoch:1,enabled:true}));
  h.doc.querySelector('#tracking').click();await until(()=>h.doc.querySelector('#status').textContent.includes('状态未确认'));
  assert.equal(h.inputs[0].suspended,true);assert.equal(h.doc.querySelector('#tracking').disabled,true);
  assert.equal(h.doc.querySelector('#save').disabled,true);
 }finally{h.close()}
});

test('a tracking response for an old document cannot change the replacement state',async()=>{
 const h=harness();let resolve;
 try{
  await h.open();h.setTrackingHandler(()=>new Promise(r=>{resolve=r}));h.doc.querySelector('#tracking').click();await until(()=>resolve);
  h.replace();await until(()=>h.inputs.length===2);resolve({documentEpoch:1,enabled:false,changed:true,modified:true});await wait(30);
  assert.equal(h.doc.querySelector('#tracking').getAttribute('aria-pressed'),'true');
  assert.equal(h.inputs[0].disposed,true);assert.equal(h.inputs[1].resumes,0);
 }finally{h.close()}
});

test('typing after full hydration refreshes new revisions once the input burst settles',async()=>{
 const h=harness();
 try{
  await h.open();h.complete(0);await until(()=>h.batches.length===2);h.complete(1);await until(()=>h.marks.includes('review-ready'));
  h.addRevision();assert.ok([...h.doc.querySelectorAll('#revision-items button')].every(b=>b.disabled));
  for(let i=0;i<3;i++){await wait(60);h.changed()}
  assert.equal(h.calls.filter(c=>c.action==='review_snapshot').length,1);
  await until(()=>h.batches.length===3);
  assert.equal(h.calls.filter(c=>c.action==='review_snapshot').length,2);
  h.complete(2);await until(()=>h.batches.length===4);h.complete(3);
  await until(()=>h.doc.querySelector('#revision-count').textContent==='4 处修订');
  assert.equal(h.doc.querySelectorAll('.item').length,4);
 }finally{h.close()}
});

test('switching documents cancels delayed review refresh and ignores old native callbacks',async()=>{
 const h=harness();
 try{
  await h.open();h.addRevision();h.replace();await until(()=>h.batches.length===2);
  h.changed(1);await wait(300);
  assert.equal(h.calls.filter(c=>c.action==='review_snapshot').length,2);
  assert.ok(h.doc.querySelector('#revision-items').textContent.includes('new summary'));
 }finally{h.close()}
});

test('late details from a closed document cannot replace the new document sidebar',async()=>{
 const h=harness();
 try{
  await h.open();h.replace();await until(()=>h.batches.length===2);
  h.complete(0);await wait(20);
  assert.ok(h.doc.querySelector('#revision-items').textContent.includes('new summary'));
  assert.equal(h.doc.querySelector('#revision-items').textContent.includes('old complete'),false);
  assert.equal(h.marks.includes('review-ready'),false);
  h.complete(1);await until(()=>h.batches.length===3);h.complete(2);await until(()=>h.marks.includes('review-ready'));
  assert.equal(h.doc.querySelectorAll('.item')[2].querySelector('p').textContent,'new complete full text 2');
 }finally{h.close()}
});

test('a stale native batch refreshes summaries and recovers enabled actions',async()=>{
 const h=harness();
 try{
  await h.open();h.batches[0].reject(Error('STALE_REVIEW_BATCH: changed while editing'));
  await until(()=>h.batches.length===2);
  assert.ok(h.batches[1].params.refreshEpoch>h.batches[0].params.refreshEpoch);
  assert.equal(h.marks.includes('review-ready'),false);
  h.complete(1);await until(()=>h.batches.length===3);h.complete(2);await until(()=>h.marks.includes('review-ready'));
  assert.ok([...h.doc.querySelectorAll('#revision-items button')].every(button=>!button.disabled));
 }finally{h.close()}
});
