// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {REVIEW_BATCH_SIZE,hydrateReviewBatch,requireReviewDetails}=require('../review-hydration.cjs');
const copy=value=>structuredClone(value);
function harness(count=600){
 const calls=[];
 let document={documentEpoch:3,documentUrl:'file:///isolated/document.docx'};
 let current=Array.from({length:count},(_,i)=>({revisionId:String(i+1),author:'Reviewer '+(i%3),type:i%2?'Delete':'Insert',dateTime:'2026-10-25T09:00:00',description:'Summary '+i,rects:[{x:1,y:i*10}]}));
 const original={documentEpoch:3,refreshEpoch:7,hydratedCount:0,items:current.map(item=>({...copy(item),text:null,textAvailable:false}))};
 let identity=original,afterDetails=()=>{},alterBatch=batch=>batch;
 const deps={
  getIdentity:()=>identity,getDocument:()=>document,
  snapshot:async()=>{calls.push('snapshot');return {documentEpoch:document.documentEpoch,refreshEpoch:99,items:copy(current)}},
  details:async params=>{
   calls.push(['details',params.start,params.limit]);
   const entries=current.slice(params.start,params.start+params.limit).map((item,i)=>({index:params.start+i,identifier:'uno-'+item.revisionId,author:item.author,type:item.type,dateTime:item.dateTime,text:'Full '+item.revisionId+' 中文🙂\n'+('long content '.repeat(120)),successor:''}));
   const batch=alterBatch({start:params.start,total:current.length,entries,controllerCapabilities:{AwdReviewGeometry:true}});
   afterDetails();return batch;
  }
 };
 return {deps,original,calls,
  run:(start=original.hydratedCount,limit=REVIEW_BATCH_SIZE)=>hydrateReviewBatch({documentEpoch:3,refreshEpoch:7,start,limit},deps),
  setIdentity:value=>{identity=value},setDocument:value=>{document=value},setCurrent:value=>{current=value},current:()=>current,
  afterDetails:fn=>{afterDetails=fn},alterBatch:fn=>{alterBatch=fn}};
}

test('all 600 complete Unicode texts are reachable in bounded independent batches',async()=>{
 const h=harness();let offset=0,batches=0;
 while(offset<600){const batch=await h.run(offset);assert.equal(batch.start,offset);offset=batch.nextOffset;batches++}
 assert.equal(batches,24);assert.equal(h.original.hydratedCount,600);
 for(const item of h.original.items){assert.equal(item.textAvailable,true);assert.ok(item.text.endsWith('long content '.repeat(120)));requireReviewDetails(h.original,item.revisionId)}
 assert.ok(h.calls.filter(c=>Array.isArray(c)).every(c=>c[2]===25));
});

test('a partial final batch retains its exact alignment',async()=>{
 const h=harness(27);await h.run();const last=await h.run();
 assert.equal(last.start,25);assert.equal(last.nextOffset,27);assert.equal(last.items.length,2);assert.equal(last.items[1].identifier,'uno-27');
});

test('stacked revisions retain the current author while separately validating CAPI successor author',async()=>{
 const h=harness(2);
 h.alterBatch(batch=>{batch.entries.forEach(item=>{item.capiAuthor=item.author;item.author='Current reviewer'});return batch});
 await h.run(0,1);await h.run(1,1);
 assert.equal(h.original.items[0].author,'Current reviewer');
 assert.equal(h.original.items[0].capiAuthor,'Reviewer 0');
 const wrong=harness(1);
 wrong.alterBatch(batch=>{batch.entries[0].capiAuthor='Forged prior author';return batch});
 await assert.rejects(wrong.run(),/STALE_REVIEW_BATCH/);
});

test('oversized, missing, negative and fractional batches fail before native reads',async()=>{
 for(const [start,limit]of [[0,26],[-1,25],[0,0],[0,1.5],[0,undefined]]){
  const h=harness();await assert.rejects(hydrateReviewBatch({documentEpoch:3,refreshEpoch:7,start,limit},h.deps),/range/);assert.deepEqual(h.calls,[]);
 }
});

test('summary-only cards cannot be acted on even when a caller invents an identifier',()=>{
 const h=harness(1);h.original.items[0].identifier='invented';
 assert.throws(()=>requireReviewDetails(h.original,'1'),/仍在读取/);
 assert.throws(()=>requireReviewDetails(h.original,'missing'),/仍在读取/);
});

test('changed count, order or semantic identity prevents the batch read',async()=>{
 for(const change of [items=>items.slice(1),items=>[items[1],items[0],...items.slice(2)],items=>items.map((item,i)=>i?item:{...item,description:'changed'})]){
  const h=harness(3);h.setCurrent(change(h.current()));await assert.rejects(h.run(),/STALE_REVIEW_BATCH/);
  assert.equal(h.calls.some(Array.isArray),false);assert.equal(h.original.hydratedCount,0);
 }
});

test('layout movement elsewhere does not require rereading already aligned identities',async()=>{
 const h=harness(2);h.setCurrent(h.current().map(item=>({...item,rects:[{x:5,y:5000}]})));
 const batch=await h.run();assert.equal(batch.items.length,2);
});

for(const replacement of ['document','url','list'])test(`a late batch cannot update a replacement ${replacement}`,async()=>{
 const h=harness(3);
 h.afterDetails(()=>{
  if(replacement==='document')h.setDocument({documentEpoch:4,documentUrl:'file:///isolated/document.docx'});
  else if(replacement==='url')h.setDocument({documentEpoch:3,documentUrl:'file:///isolated/another.docx'});
  else h.setIdentity({...h.original,refreshEpoch:8});
 });
 await assert.rejects(h.run(),/STALE_REVIEW_BATCH/);
 assert.equal(h.original.hydratedCount,0);assert.ok(h.original.items.every(item=>!item.textAvailable));
});

test('mutation during the UNO read cannot partially publish details',async()=>{
 const h=harness(3);h.afterDetails(()=>h.setCurrent(h.current().map((item,i)=>i?item:{...item,type:'Delete'})));
 await assert.rejects(h.run(),/STALE_REVIEW_BATCH/);assert.equal(h.original.hydratedCount,0);
 assert.ok(h.original.items.every(item=>item.text===null));
});

for(const bad of ['index','author','duplicate-id','count','text'])test(`bad ${bad} alignment rejects the entire batch`,async()=>{
 const h=harness(3);h.alterBatch(batch=>{
  if(bad==='count')batch.total++;
  else if(bad==='duplicate-id')batch.entries[1].identifier=batch.entries[0].identifier;
  else if(bad==='text')batch.entries[1].text=null;
  else if(bad==='index')batch.entries[1].index=99;
  else batch.entries[1].author='Other';
  return batch;
 });
 await assert.rejects(h.run(),/STALE_REVIEW_BATCH/);assert.equal(h.original.hydratedCount,0);
 assert.ok(h.original.items.every(item=>!item.textAvailable));
});

test('a completed batch cannot be replayed or skip unread entries',async()=>{
 const h=harness(50);await h.run();
 await assert.rejects(h.run(0),/STALE_REVIEW_BATCH/);await assert.rejects(h.run(26),/STALE_REVIEW_BATCH/);
 assert.equal(h.original.hydratedCount,25);
});

test('input can run between independent batch tasks without dropping the remaining details',async()=>{
 const h=harness(50);let tail=Promise.resolve();const task=fn=>{const next=tail.then(fn);tail=next;return next};
 const first=task(()=>h.run());const input=task(()=>{h.calls.push('input');h.setCurrent(h.current().map(item=>({...item,rects:[{x:2,y:100}]})))});
 await first;await input;await task(()=>h.run());
 assert.equal(h.original.hydratedCount,50);
 assert.deepEqual(h.calls,['snapshot',['details',0,25],'snapshot','input','snapshot',['details',25,25],'snapshot']);
});
