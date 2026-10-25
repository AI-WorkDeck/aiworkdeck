// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual renderer with a synthetic transport; not a real native/UI timing test.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('../../../../frontend/node_modules/jsdom');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('DOM state timed out');await wait(5)}}
function harness(){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const source=fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://prototype.invalid/'});
 const w=dom.window,doc=w.document,marks=[],calls=[],batches=[];
 let epoch=1,prefix='old',summary=0,onEvent,inputRequest;
 w.ImageData=class{constructor(pixels,width,height){this.pixels=pixels;this.width=width;this.height=height}};
 w.HTMLCanvasElement.prototype.getContext=()=>({putImageData(){}});
 Object.defineProperty(doc.querySelector('#viewport'),'clientWidth',{value:800});
 Object.defineProperty(doc.querySelector('#viewport'),'clientHeight',{value:600});
 w.AWDDocumentInput={createDocumentInput:options=>{
  inputRequest=options.request;
  return {setDocument(){},handleCallback(){},viewportChanged(){},flush:async()=>{},suspend:async()=>{},resume(){},dispose(){}};
 }};
 w.prototype={
  list:async()=>({projects:[{id:1,name:'Synthetic project',files:[{id:1,name:'test.docx'}]}]}),
  open:async()=>({documentEpoch:epoch,viewId:0,widthTwips:12000,heightTwips:15000}),
  close:async()=>{},save:async()=>({saved:true,dirty:false}),writeClipboard:async()=>{},
  paint:async()=>({pixels:[255,255,255,255],width:1,height:1,yTwips:0}),
  onFlush(){},onEvent:listener=>{onEvent=listener},painted:name=>marks.push(name),
  action:async(action,params)=>{
   calls.push({action,params});
   if(action==='review_snapshot')return {documentEpoch:epoch,refreshEpoch:++summary,hydratedCount:0,batchSize:2,
    items:Array.from({length:3},(_,i)=>({revisionId:prefix+'-'+i,author:'Reviewer',type:'Delete',description:prefix+' summary '+i,text:null,textAvailable:false}))};
   if(action==='review_batch')return new Promise((resolve,reject)=>batches.push({params,prefix,resolve,reject}));
   return {applied:true,documentEpoch:params.documentEpoch,viewId:0,lastInputSeq:params.inputSeq};
  }
 };
 w.eval(source);
 return {dom,w,doc,marks,calls,batches,
  async open(){await until(()=>doc.querySelector('#projects button'));doc.querySelector('#projects button').click();await until(()=>batches.length===1)},
  complete(index){const b=batches[index],end=Math.min(b.params.start+b.params.limit,3);b.resolve({documentEpoch:b.params.documentEpoch,refreshEpoch:b.params.refreshEpoch,start:b.params.start,nextOffset:end,total:3,
   items:Array.from({length:end-b.params.start},(_,i)=>({revisionId:b.prefix+'-'+(b.params.start+i),identifier:'uno-'+b.prefix+'-'+(b.params.start+i),text:b.prefix+' complete full text '+(b.params.start+i),textAvailable:true}))})},
  input:()=>inputRequest('input_text',{inputSeq:1,text:'interleaved'}),
  replace(){epoch++;prefix='new';onEvent({type:'document-closed'});onEvent({type:'document-opened',model:{documentEpoch:epoch,viewId:0,widthTwips:12000,heightTwips:15000}})},
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
