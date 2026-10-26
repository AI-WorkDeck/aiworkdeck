// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as barriers from '../../src/utils/checkpointSaveBarrier.js'
import * as protocol from '../../src/utils/localContentProtocol.js'
const body = readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*$/gm, '').replace(/export default \{/, 'return {')
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve } }
const tick = () => new Promise(r => setTimeout(r, 0))
const response = (status, bytes, headers={}) => ({ status, bytes, header: key => headers[key] ?? null })
const json = (status, body) => response(status, new TextEncoder().encode(JSON.stringify(body)), { 'X-AWD-Content-Protocol':'1' })
async function download(bytes) {
 return response(200, bytes.buffer, { 'X-AWD-Content-Protocol':'1', 'X-AWD-File-Uid':'uid-7', 'X-AWD-Actor-Id':'1',
  'X-AWD-SHA256': await protocol.contentSha256(bytes), 'Content-Length': String(bytes.length) })
}
function vmFor(send, projectId, events = []) {
 const deps = { ...barriers, ...protocol, uni: { $emit: (...args) => events.push(args) },
  localContentCapability: (url,args) => protocol.localContentCapability(url,{...args,send}),
  cancelLocalContent: (p,args) => protocol.cancelLocalContent(p,{...args,send}),
  downloadLocalContent: args => protocol.downloadLocalContent({...args, send}),
  saveLocalContent: (p,args) => protocol.saveLocalContent(p,{...args,send}),
  ReviewPanel:null, EditorToolbar:null, EvidenceStaleBar:null, getAuthHeaders:()=>({}),
  getFileBytesUrl:id=>`http://127.0.0.1:8765/api/files/${id}/download`, getFileWriteUrl:id=>`/upload/${id}`,
  getCurrentUser:()=>({displayName:'Test'}), createAuthorNameResolver:()=>({current:()=> 'Test'}), loadBudgetMs:()=>30000,
  classifyLoadFailure:()=> 'loadFailed', shouldSelfHealLoadFailure:()=>false, openFailureOf:()=>null,
 }
 const methods=new Function(...Object.keys(deps),body)(...Object.values(deps)).methods
 const vm={file:{id:7,name:'test.docx',fileType:'docx',fileSize:3}, projectId, ready:true, dirty:true,
  statusKey:'ready', saving:false, docLoadFailed:false, docKind:'writer', loaded:[], legacyUploads:0,
  executor:{executeCommand:async(action,args)=>{ if(action==='load_document') vm.loaded.push([...args.bytes]); return {success:true,kind:'writer',bytes:[4,5,6]} }},
 }
 for (const [name,fn] of Object.entries(methods)) vm[name]=fn.bind(vm)
 Object.assign(vm,{appendLog(){},tryDocxPreview(){},initEvidence(){},initWritingAssistance(){},$emit(){},
  rehideChromeAfterRetarget(){},scheduleProvenanceReload(){},scheduleAnchorCheck(){},loadProvenance(){},
  scheduleAutoSave(){},stampGeneratorMetadata:async b=>b,uploadBytes:async()=>{vm.legacyUploads++}})
 return vm
}
test('supported slow prefetch keeps its stamp when finishDocLoad begins before download ends', async()=>{
 const gate=deferred(), vm=vmFor(async request=>{
  if(request.url.endsWith('/startup-health')) return response(200,new TextEncoder().encode(JSON.stringify({status:'UP',phase:'core',coreContentProtocol:1})))
  if(request.method==='PUT') return json(200,{code:0,data:{operationId:request.headers['X-AWD-Operation-Id'],uid:'uid-7',actorId:1,sha256:await protocol.contentSha256(request.bytes),size:request.bytes.length}})
  return gate.promise
 },101)
 vm.prefetchBytes()
 const loading=vm.finishDocLoad()
 await tick()
 gate.resolve(await download(new Uint8Array([1,2,3])))
 await loading
 assert.deepEqual(vm.loaded,[[1,2,3]])
 const saved=await vm.saveDocument()
 console.log(JSON.stringify({case:'prefetch',ready:vm.ready,metadata:vm._localContentMetadata??null,legacyUploads:vm.legacyUploads}))
 assert.equal(vm.legacyUploads,0,'supported download must not fall back to unconditional legacy upload')
 assert.equal(saved,true)
})
test('explicit authoritative reload after a conflict does not permanently retain an obsolete save context',async()=>{
 const requests=[], current=new Uint8Array([7,8,9]), currentSha=await protocol.contentSha256(current)
 const vm=vmFor(async req=>{
  requests.push(req)
  if(req.url.endsWith('/startup-health')) return response(200,new TextEncoder().encode(JSON.stringify({status:'UP',phase:'full',coreContentProtocol:1})))
  if(req.method==='DELETE') return json(200,{code:0,data:{state:'cancelled',operationId:req.headers['X-AWD-Operation-Id'],uid:'uid-7',actorId:1}})
  if(req.url.includes('/receipts/')) return json(404,{reason:'RECEIPT_NOT_FOUND',writeState:'unknown'})
  if(req.method==='PUT') {
   if(req.headers['X-AWD-Expected-SHA256']!==currentSha) return json(409,{code:-1,reason:'CONTENT_CONFLICT',writeState:'unknown'})
   return json(200,{code:0,data:{operationId:req.headers['X-AWD-Operation-Id'],uid:'uid-7',actorId:1,sha256:await protocol.contentSha256(req.bytes),size:req.bytes.length}})
  }
  return download(current)
 },102)
 vm._localContentMetadata={url:'http://127.0.0.1:8765/api/local-core/projects/102/files/7/content',uid:'uid-7',actorId:'1',sha256:'a'.repeat(64),size:3}
 assert.equal(await vm.autoSave(),undefined)
 assert.ok(vm._localContentPending)
 assert.equal(await vm.reloadFromBackend(),true)
 vm.onDocModified()
 const before=requests.length, saved=await vm.retrySave()
 console.log(JSON.stringify({case:'reload',saved,pendingContext:vm._localContentPending?.saveContext,currentContext:vm._backendSaveContext,requestsOnRetry:requests.length-before,dirty:vm.dirty,status:vm.statusKey}))
 assert.equal(saved,true,'new edits after explicit reload must not be blocked forever by old pending.saveContext')
})

const currentMetadata = projectId => ({url:`http://127.0.0.1:8765/api/local-core/projects/${projectId}/files/7/content`,
  uid:'uid-7',actorId:'1',sha256:'a'.repeat(64),size:3})
async function unknownSave(vm) {
  const pending = await protocol.createLocalContentSave(currentMetadata(vm.projectId),new Uint8Array([4,5,6]))
  Object.assign(pending,{fileId:7,projectId:vm.projectId,generation:0,saveContext:0,attempted:true})
  vm._localContentPending=pending
  vm._localContentMetadata=pending.metadata
  const lease=barriers.beginDocumentSave(vm.projectId,7)
  lease.setOperationId(pending.operationId); lease.finish(false)
  return pending
}

test('failed cancellation keeps the old model, unknown guard, and inputs arriving while reload waits',async()=>{
  const gate=deferred()
  let exports=0
  const vm=vmFor(async req=>{assert.equal(req.method,'DELETE'); return gate.promise},103)
  vm.executor.executeCommand=async()=>{exports++;return{success:true,bytes:[4,5,6]}}
  const pending=await unknownSave(vm)
  vm.dirty=false
  const reload=vm.reloadFromBackend()
  await tick()
  assert.ok(vm._pendingReload)
  vm.onDocModified()
  assert.equal(vm.dirty,true)
  await vm.autoSave()
  assert.equal(await vm.saveDocument(),false)
  assert.equal(await vm.flushSave(),false)
  assert.equal(exports,0)
  assert.equal(vm.dirty,true)
  gate.resolve(json(503,{code:-1,reason:'CONTENT_STORAGE_FAILED',writeState:'unknown'}))
  assert.equal(await reload,false)
  assert.equal(vm.dirty,true)
  assert.equal(vm._localContentPending,pending)
  assert.equal(vm._backendSaveContext,undefined)
  assert.equal(vm.docLoadFailed,false)
  const barrier=barriers.beginCheckpointSaveBarrier(103,7,'failed-cancellation')
  assert.equal(await barrier.drained,false)
  barriers.endCheckpointSaveBarrier(103,7,'failed-cancellation')
})

test('cancelled GET resolves only its operation and requires reload instead of exporting newer dirty input',async()=>{
  let pending, exports=0
  const vm=vmFor(async req=>{
    assert.equal(req.method,undefined)
    return json(200,{code:0,data:{state:'cancelled',operationId:pending.operationId,uid:'uid-7',actorId:1}})
  },104)
  vm.executor.executeCommand=async()=>{exports++;return{success:true,bytes:[8,9,10]}}
  pending=await unknownSave(vm)
  assert.equal(await vm.retrySave(),false)
  assert.equal(exports,0)
  assert.equal(vm.dirty,true)
  assert.equal(vm._localContentPending,pending)
  assert.equal(pending.cancelled,true)
  assert.equal(vm.localSaveReason,'OPERATION_CANCELLED')
  const barrier=barriers.beginCheckpointSaveBarrier(104,7,'cancelled-operation')
  assert.equal(await barrier.drained,true)
  barriers.endCheckpointSaveBarrier(104,7,'cancelled-operation')
})

test('receipt recovery then a fresh export keeps inputs typed during the second upload dirty',async()=>{
  let pending, exporting=false, putCount=0
  const gate=deferred()
  const vm=vmFor(async req=>{
    if(!req.method) return json(200,{code:0,data:{operationId:pending.operationId,uid:'uid-7',actorId:1,sha256:pending.sha256,size:3}})
    putCount++
    assert.equal(req.headers['X-AWD-Expected-SHA256'],pending.sha256)
    await gate.promise
    return json(200,{code:0,data:{operationId:req.headers['X-AWD-Operation-Id'],uid:'uid-7',actorId:1,
      sha256:await protocol.contentSha256(req.bytes),size:req.bytes.length}})
  },105)
  pending=await unknownSave(vm)
  vm.executor.executeCommand=async()=>{exporting=true;return{success:true,bytes:[7,8,9]}}
  const retry=vm.retrySave()
  while(!putCount) await tick()
  assert.equal(exporting,true)
  vm.onDocModified()
  gate.resolve()
  assert.equal(await retry,false,'flush must keep the tab open when newer input is still dirty')
  assert.equal(vm.dirty,true)
  assert.equal(vm._localContentPending,null)
  assert.equal(putCount,1)
})

test('old read-core health without the capability uses its existing download and clears a prior model stamp only after load',async()=>{
  protocol.observeLocalContentBackend({state:'restarting',updatedAt:201})
  let calls=0, legacyDownloads=0
  const vm=vmFor(async req=>{
    calls++; assert.ok(req.url.endsWith('/startup-health'))
    return json(200,{status:'UP',phase:'core'})
  },106)
  const old=currentMetadata(106)
  vm._localContentMetadata=old
  vm.fetchArrayBuffer=async()=>{legacyDownloads++;return new Uint8Array([1,2,3]).buffer}
  const bytes=await vm.fetchDocumentBytes('http://127.0.0.1:8765/api/files/7/download')
  assert.equal(vm._localContentMetadata,old,'downloading alone must not change the stamp of the current model')
  vm._bytesPromise=Promise.resolve(bytes)
  await vm.finishDocLoad()
  assert.equal(vm.docLoadFailed,false)
  assert.equal(vm._localContentMetadata,null)
  assert.equal(legacyDownloads,1)
  assert.equal(calls,1)
})

test('a late cancellation confirmation cannot clear or reload a replacement document',async()=>{
  const gate=deferred(),vm=vmFor(()=>gate.promise,107)
  const old=await unknownSave(vm)
  const reload=vm.reloadFromBackend()
  await tick()
  const replacement={operationId:'replacement-operation'}
  vm._localContentPending=replacement
  vm.file={id:8,name:'other.docx',fileSize:3}
  gate.resolve(json(200,{code:0,data:{state:'cancelled',operationId:old.operationId,uid:'uid-7',actorId:1}}))
  assert.equal(await reload,false)
  assert.equal(vm._localContentPending,replacement)
  assert.deepEqual(vm.loaded,[])
})

for (const disposed of [false, true]) {
  test(`late cancellation after ${disposed ? 'unmount' : 'discard'} does not reload the model`, async () => {
    const gate = deferred(), vm = vmFor(() => gate.promise, disposed ? 109 : 108)
    const pending = await unknownSave(vm)
    const reload = vm.reloadFromBackend()
    await tick()
    if (disposed) vm._backendHealthDisposed = true
    else vm.discardPendingSave()
    gate.resolve(json(200, { code: 0, data: { state: 'cancelled', operationId: pending.operationId, uid: 'uid-7', actorId: 1 } }))
    assert.equal(await reload, false)
    assert.deepEqual(vm.loaded, [])
    assert.equal(vm.dirty, true)
  })
}

test('本地内容保存确认后同样通知项目入口刷新，失败不发成功事件', async () => {
  const events = [], gate = deferred()
  const vm = vmFor(async req => {
    await gate.promise
    return json(200, { code: 0, data: { operationId: req.headers['X-AWD-Operation-Id'],
      uid: 'uid-7', actorId: 1, sha256: await protocol.contentSha256(req.bytes), size: req.bytes.length } })
  }, 1487, events)
  vm._localContentMetadata = currentMetadata(1487)
  const saved = vm.saveDocument()
  await tick()
  assert.deepEqual(events, [])
  gate.resolve()
  assert.equal(await saved, true)
  assert.equal(vm.legacyUploads, 0)
  assert.deepEqual(events, [['awd:file-saved', { projectId: 1487, fileId: 7 }]])

  const failedEvents = []
  const failed = vmFor(async () => json(409, { code: -1, reason: 'CONTENT_CONFLICT', writeState: 'unknown' }), 1488, failedEvents)
  failed._localContentMetadata = currentMetadata(1488)
  assert.equal(await failed.saveDocument(), false)
  assert.deepEqual(failedEvents, [])
})
