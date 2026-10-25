// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { NativeEditorSession } = require('../main/native/editor-session')
const { createNativeEditorManager } = require('../main/native/editor-ipc')

function opened(readOnly = false) {
  const events = [], calls = []
  const session = new NativeEditorSession({ config: {}, run: '/unused', readOnly, onEvent: event => events.push(event) })
  session.model = { trackingReady: true, documentEpoch: 7, viewId: 3, documentUrl: 'file:///private/owned.docx' }
  session.engine = { call: async (action, params) => { calls.push({ action, params }); return { success: true } } }
  return { session, calls, events }
}
test('unknown capabilities fail explicitly, without issuing a native command', async () => {
  const { session, calls } = opened()
  await assert.rejects(session.execute('insert_image', { data: [] }), { code: 'UNSUPPORTED_NATIVE_ACTION' })
  assert.equal(calls.length, 0)
})

test('a queued paint from the previous page width requests a fresh viewport without failing the engine', async () => {
  const { session, calls } = opened()
  session.model.widthTwips = 16676; session.model.heightTwips = 137260
  const params = { documentEpoch: 7, width: 556.8, height: 706, scale: 2,
    xTwips: 0, yTwips: 0, widthTwips: 16704, documentWidthTwips: 16704 }
  assert.deepEqual(await session.execute('native_paint', params), {
    stale: true, documentEpoch: 7, widthTwips: 16676, heightTwips: 137260,
  })
  assert.equal(calls.length, 0)
  assert.equal(session.failure, undefined)
  await assert.rejects(session.execute('native_paint', { ...params, documentWidthTwips: 16676 }), /Invalid native viewport/)
});

function reviewLayoutSession(mode = 'all') {
  const h = opened(), { session } = h
  session.revision = 5
  session.comments = { documentEpoch: 7, revision: 5, items: new Map() }
  const geometry = { pages: [{ number: 1, x: 200, y: 200, width: 12000, height: 16000 }],
    comments: [], revisions: [{ id: 17, index: 0, page: 1, available: true, anchor: { x: 500, y: 1000, width: 1, height: 300 } }] }
  session.unoCall = async action => {
    if (action === 'view') return { mode }
    if (action === 'geometry') return { available: true, geometry, mode, sidebarWidth: 280 }
    throw Error('Unexpected UNO read: ' + action)
  }
  return { ...h, geometry }
}
test('sidebar and balloon reads share one revision hydration for the same document state', async () => {
  const { session } = opened()
  const held = latch(); let snapshots = 0
  session.engine.call = async () => {
    snapshots++; await held.promise
    return { documentEpoch: 7, refreshEpoch: 8, items: [] }
  }
  const first = session.listRevisions(), second = session.listRevisions()
  held.resolve()
  const results = await Promise.all([first, second])
  assert.equal(snapshots, 1)
  assert.equal(results[0], results[1])
  await session.listRevisions()
  assert.equal(snapshots, 2, 'a completed read is not an indefinite cache')
})
test('inline review positions do not hydrate revision text or reserve space for hidden deletions', async () => {
  const { session, geometry } = reviewLayoutSession()
  geometry.revisions.push({ id: 18, index: 1, available: false })
  session.listRevisions = () => { throw Error('Inline view must not scan revision text') }
  const result = await session.execute('get_review_layout', { documentEpoch: 7 })
  assert.equal(result.items.length, 1); assert.deepEqual(result.items[0].data, { index: 0 })
  assert.equal(result.pending, 0); assert.equal(result.writable, true)
  session.readOnly = true
  assert.equal((await session.execute('get_review_layout')).writable, false)
  await assert.rejects(session.execute('get_review_layout', { documentEpoch: 6 }), /STALE_DOCUMENT/)
})
test('balloons bind complete metadata to native IDs, never array position, including more than 500 revisions', async () => {
  const { session, geometry } = reviewLayoutSession('balloons')
  let hydrated = 0
  session.listRevisions = async () => {
    hydrated++
    session.review = { revision: 5, items: Array.from({ length: 601 }, (_, i) => ({ revisionId: String(i + 17),
      identifier: 'identifier-' + i, type: 'Delete', text: '完整原文' + i, author: '作者' + i, dateTime: '2026-10-01' })) }
  }
  geometry.revisions = Array.from({ length: 601 }, (_, i) => ({ id: i + 17, index: 600 - i, page: 1,
    available: true, anchor: { x: 500, y: 1000 + i * 300, width: 1, height: 300 } }))
  const result = await session.execute('get_review_layout')
  assert.equal(hydrated, 1); assert.equal(result.items.length, 601); assert.equal(result.truncated, false)
  assert.equal(result.items[600].data.text, '完整原文600'); assert.equal(result.items[600].data.index, 0)
  assert.equal(result.items[600].data.identifier, 'identifier-600')
})
test('unread revisions and unlaid comments keep the gutter without guessing metadata', async () => {
  const { session, geometry } = reviewLayoutSession('balloons')
  session.review = { revision: 4, items: [] }
  session.comments.items.set('postit:9', { id: 'postit:9', content: '批注' })
  geometry.comments.push({ id: 9, available: false })
  const result = await session.execute('get_review_layout', { fresh: false })
  assert.equal(result.unread, 1); assert.equal(result.pending, 1); assert.equal(result.stale, true)
  assert.equal(result.items.length, 0)
  await assert.rejects(session.execute('resolve_revisions', { documentSeq: 7, revision: result.revision,
    indices: [0], action: 'accept' }), /STALE_REVIEW/)
})
test('a retarget during layout hydration cannot publish cards for the previous document', async () => {
  const { session } = reviewLayoutSession('balloons')
  session.listRevisions = async () => { session.model = { ...session.model, documentEpoch: 8 } }
  await assert.rejects(session.execute('get_review_layout'), /STALE_DOCUMENT/)
})
test('readonly blocks text, formatting key, review and export while retaining navigation', async () => {
  const { session, calls } = opened(true)
  for (const action of ['export_document', 'undo', 'set_track_changes']) await assert.rejects(session.execute(action, { on: true }), { code: 'READ_ONLY' })
  await assert.rejects(session.execute('native_input', { action: 'input_text', params: { documentEpoch: 7, text: '中' } }), { code: 'READ_ONLY' })
  await assert.rejects(session.execute('native_input', { action: 'input_key', params: { documentEpoch: 7, eventType: 0, charCode: 0, keyCode: 0x2000 | 513 } }), { code: 'READ_ONLY' })
  await session.execute('native_input', { action: 'input_key', params: { documentEpoch: 7, eventType: 0, charCode: 0, keyCode: 1024 } })
  assert.equal(calls.length, 1)
})
test('old epoch and malformed tracking flags cannot mutate current model', async () => {
  const { session, calls } = opened()
  await assert.rejects(session.execute('native_input', { documentEpoch: 6, action: 'input_text', params: { documentEpoch: 6 } }), /STALE_DOCUMENT/)
  await assert.rejects(session.execute('set_track_changes', { on: 1 }), /boolean/)
  assert.equal(calls.length, 0)
})
test('author-only retarget preserves document and calls only remote author configuration', async () => {
  const { session } = opened(), model = session.model, calls = []
  session.unoCall = async (...args) => { calls.push(args); return { authorName: args[1].name } }
  assert.equal((await session.execute('load_document', { authorName: '真实用户' })).authorName, '真实用户')
  assert.equal(session.model, model)
  assert.deepEqual(calls, [['author', { name: '真实用户' }]])
})
test('every native mutation invalidates old review fences before any resolution', async () => {
  const { session, calls } = opened()
  session.review = { revision: 4, items: [] }; session.revision = 5
  await assert.rejects(session.execute('resolve_revisions', { documentSeq: 7, revision: 4, indices: [0], action: 'accept' }), /STALE_REVIEW/)
  assert.equal(calls.length, 0)
})
test('complete expected revision text is required before resolving a batch', async () => {
  const { session, calls } = opened()
  session.review = { revision: 0, items: [{ identifier: 'a', text: 'full text', author: 'Alice', type: 'Insert', dateTime: 'date' }] }
  await assert.rejects(session.execute('resolve_revisions', { documentSeq: 7, revision: 0, indices: [0], action: 'accept',
    expectedRevisions: [{ index: 0, identifier: 'a', text: 'truncated', author: 'Alice', type: 'Insert', timestamp: 'date' }] }), /STALE_REVIEW_TEXT/)
  assert.equal(calls.length, 0)
})
test('changed unconfirmed tracking state does not return success', async () => {
  const { session, events } = opened()
  session.unoCall = async () => ({ enabled: false, changed: true, modified: false })
  await assert.rejects(session.execute('set_track_changes', { on: false }), /not confirmed/)
  assert.equal(events[0].type, 'engine-failed')
  await assert.rejects(session.execute('get_ui_state'), /not confirmed/)
})
test('manager binds session to exact sender and refuses unsupported platforms and format', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'awd-native-ipc-'))
  try {
    const configFile = path.join(root, 'config.json'), executable = path.join(root, 'worker')
    await fs.writeFile(executable, '')
    await fs.writeFile(configFile, JSON.stringify({ worker: executable, unoHost: executable, runtime: root, unoRuntime: root }))
    let finishClose
    const closeGate = new Promise(resolve => { finishClose = resolve })
    const calls = [], manager = createNativeEditorManager({ root, configFile, platform: 'darwin', createSession: () => ({
      execute: async (...args) => { calls.push(args); return { success: true } }, close: async () => { calls.push(['close']); await closeGate } }) })
    const sender = new EventEmitter(); sender.isDestroyed = () => false; sender.send = () => {}
    await assert.rejects(manager.open(sender, { name: 'report.doc', readOnly: false }), /DOCX/)
    await assert.rejects(manager.open(sender, { name: 'report.docx' }), /readOnly/)
    const descriptor = await manager.open(sender, { name: 'report.docx', readOnly: false })
    const denied = await manager.request({}, descriptor.sessionId, 'export_document', {})
    assert.equal(denied.success, false); assert.equal(calls.length, 0)
    assert.equal((await manager.request(sender, descriptor.sessionId, 'export_document', {})).success, true)
    const closing = manager.closeAll()
    assert.equal((await fs.readdir(root)).some(name => name.startsWith('session-')), true)
    finishClose(); await closing; assert.deepEqual(calls.at(-1), ['close'])
    assert.equal((await fs.readdir(root)).some(name => name.startsWith('session-')), false)
    await assert.rejects(manager.open(sender, { name: 'report.docx', readOnly: false }), /unavailable/)
    const windows = createNativeEditorManager({ root, configFile, platform: 'win32' })
    await assert.rejects(windows.open(sender, { name: 'report.docx', readOnly: false }), /platform/)
    const failed = createNativeEditorManager({ root, configFile, platform: 'darwin', createSession: () => ({
      failure: Error('OUTCOME_UNKNOWN'), model: { name: 'retained.docx' }, close: async () => {} }) })
    await failed.open(sender, { readOnly: false, empty: true })
    await failed.closeAll()
    const retained = (await fs.readdir(root)).filter(name => name.startsWith('session-'))
    assert.equal(retained.length, 1)
    const recovery = JSON.parse(await fs.readFile(path.join(root, retained[0], 'recovery.json'), 'utf8'))
    assert.equal(recovery.reason, 'OUTCOME_UNKNOWN')
    assert.equal(recovery.documentName, 'retained.docx')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('closing during startup prevents late child spawn and waits for owned filesystem work', async () => {
  const run = await fs.mkdtemp(path.join(os.tmpdir(), 'awd-native-close-start-'))
  let spawned = 0
  const session = new NativeEditorSession({ run, config: {}, readOnly: false, channel() { spawned++; throw Error('must not spawn') } })
  try {
    const opening = session.execute('load_document', { bytes: [], name: 'blank.docx', authorName: 'A' })
    const rejected = assert.rejects(opening, /closed/)
    await Promise.resolve()
    await session.close(); await rejected
    assert.equal(spawned, 0)
  } finally { await fs.rm(run, { recursive: true, force: true }) }
})

test('formatting outcome uncertainty locks later mutation and readonly cannot format', async () => {
  const {session} = opened()
  session.unoCall = async () => { throw Error('FORMAT_OUTCOME_UNKNOWN: silent no-op') }
  await assert.rejects(session.execute('format_selection', {bold:true}), /FORMAT_OUTCOME_UNKNOWN/)
  await assert.rejects(session.execute('native_input', {action:'input_text',params:{documentEpoch:7,text:'no'}}), /FORMAT_OUTCOME_UNKNOWN/)
  const {session:readonly} = opened(true)
  await assert.rejects(readonly.execute('format_selection', {bold:true}), {code:'READ_ONLY'})
})

test('selection readback callbacks do not feed repeated UI reads back into themselves', async () => {
  let reads = 0, notifications = 0
  const pending = []
  const session = new NativeEditorSession({config:{},run:'/unused',readOnly:false,onEvent(event) {
    if (event.type !== 'selection') return
    notifications++
    // A bounded reproducer of Toolbar/host readbacks, each of which can cause
    // Writer to repeat the current selection callback without a real change.
    if (reads < 8) pending.push(session.execute('get_ui_state'))
  }})
  session.model={trackingReady:true,documentEpoch:1,viewId:0}
  const callback={type:'callback',documentEpoch:1,viewId:0,callbackType:2,payload:'100,100,50,20'}
  session.unoCall=async()=>{reads++;session.event({...callback});return {}}
  session.event(callback)
  while(pending.length) await pending.shift()
  assert.equal(reads,1)
  assert.equal(notifications,1)
  session.event({...callback,payload:'200,100,50,20'})
  while(pending.length) await pending.shift()
  assert.equal(notifications,3) // real move, then readback returns the old rect
  session.event({...callback,viewId:1})
  while(pending.length) await pending.shift()
  assert.equal(notifications,4)
  session.model={trackingReady:true,documentEpoch:2,viewId:0}
  session.event({...callback,documentEpoch:2})
  while(pending.length) await pending.shift()
  assert.equal(notifications,5)
})


test('a view preference that unexpectedly changes document state blocks subsequent edits',async()=>{
  const {session}=opened()
  session.unoCall=async()=>{throw Error('VIEW_OUTCOME_UNKNOWN: view settings changed document state')}
  await assert.rejects(session.execute('set_view_options',{ruler:true}),/VIEW_OUTCOME_UNKNOWN/)
  await assert.rejects(session.execute('native_input',{action:'input_text',params:{documentEpoch:7,text:'no'}}),/VIEW_OUTCOME_UNKNOWN/)
})

test('actual view readback is allowed in readonly mode without emitting a document mutation',async()=>{
  const {session,events}=opened(true), view={ruler:true,zoom:150}
  session.unoCall=async method=>method==='set_zoom'?{zoom:150}:view
  const result=await session.execute('set_zoom',{value:150})
  assert.deepEqual(result.nativeView,view)
  assert.deepEqual(events,[])
  await assert.rejects(session.execute('set_style',{styleName:'Heading 1'}),{code:'READ_ONLY'})
})

const fullComment = {id:'comment-a',author:'Alice',content:'完整中文批注',timestamp:'2026-10-25T12:00:00.000000000',anchorText:'原文',resolved:false}
test('comments read native parent topology in the same queue and do not accept caller topology',async()=>{
  const {session,calls}=opened()
  const order=[]
  session.engine.call=async(action,params)=>{calls.push({action,params});order.push('native');return {value:JSON.stringify({comments:[{id:10,parentId:0}]})}}
  session.unoCall=async(action,params)=>{order.push('uno');assert.equal(action,'list_comments');assert.deepEqual(params.nativeCommentParents,[{id:10,parentId:0}]);return {success:true,comments:[fullComment],count:1,truncated:false}}
  const result=await session.execute('list_comments',{nativeCommentParents:[{id:1,parentId:1}],nativeReadOnly:false})
  assert.deepEqual(order,['native','uno']);assert.equal(result.documentSeq,7);assert.equal(result.truncated,false)
  assert.equal(calls[0].params.documentEpoch,7)
})
test('comment identity is epoch bound and a complete cached fence is verified even after unrelated edits',async()=>{
  const {session}=opened(), calls=[]
  session.comments={documentEpoch:7,items:new Map([[fullComment.id,fullComment]])}
  session.revision=5
  session.unoCall=async(action,params)=>{calls.push({action,params});return {success:true,changed:true}}
  await assert.rejects(session.execute('reply_comment',{id:fullComment.id,documentSeq:6,text:'reply'}),/STALE_DOCUMENT/)
  assert.equal(calls.length,0)
  await session.execute('reply_comment',{id:fullComment.id,revision:1,text:'reply',asUser:true})
  assert.deepEqual(calls[0].params.expectedComment,fullComment)
  assert.equal(session.revision,6)
  session.comments=null
  await assert.rejects(session.execute('reply_comment',{id:fullComment.id,text:'old card'}),/STALE_COMMENT/)
})
test('readonly comments fail before native topology or UNO; uncertain writes lock the model',async()=>{
  const {session,calls}=opened(true)
  for(const action of ['add_comment_at_selection','reply_comment','delete_comment','update_comment','set_comment_resolved'])
    await assert.rejects(session.execute(action,{id:fullComment.id}),{code:'READ_ONLY'})
  assert.equal(calls.length,0)
  const {session:writable}=opened()
  writable.unoCall=async()=>{throw Error('COMMENT_OUTCOME_UNKNOWN: restore failed')}
  await assert.rejects(writable.execute('add_comment_at_selection',{comment:'test'}),/COMMENT_OUTCOME_UNKNOWN/)
  await assert.rejects(writable.execute('export_document'),/COMMENT_OUTCOME_UNKNOWN/)
})
test('UNO receives authoritative session readOnly after caller parameters',async()=>{
  const {session}=opened(true)
  let params
  session.uno={call:async(_,value)=>{params=value;return {}}}
  await session.unoCall('list_comments',{nativeReadOnly:false,documentUrl:'file:///other.docx'})
  assert.equal(params.nativeReadOnly,true);assert.equal(params.documentUrl,'file:///private/owned.docx')
})
function latch(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
test('permission revocation immediately gates queued input and does not consume its native sequence',async()=>{
  const {session,calls}=opened();session.model.trackingInitialized=true
  const gate=latch();const held=session.task(()=>gate.promise)
  const text=session.execute('native_input',{action:'input_text',params:{documentEpoch:7,inputSeq:1,text:'blocked'}})
  const rejected=assert.rejects(text,{code:'READ_ONLY',inputNotConsumed:true})
  session.engine.call=async(action,params)=>{calls.push({action,params});return {readOnly:params.readOnly,documentEpoch:7,permissionSeq:params.permissionSeq,lastInputSeq:0}}
  const revoke=session.execute('set_read_only',{documentEpoch:7,permissionSeq:1,readOnly:true})
  assert.equal(session.readOnly,true);assert.equal(session.permissionPending,true)
  gate.resolve();await held;await rejected
  const reply=await revoke
  assert.equal(reply.lastInputSeq,0);assert.equal(session.permissionPending,false)
  assert.deepEqual(calls.map(c=>c.action),['set_read_only'])
})
test('late permission grant cannot overrule a newer revocation or reopen its input window',async()=>{
  const {session}=opened(true);session.model.trackingInitialized=true
  const gate=latch(),started=latch();const calls=[]
  session.engine.call=async(action,params)=>{calls.push(params);if(params.permissionSeq===1){started.resolve();await gate.promise}return {readOnly:params.readOnly,documentEpoch:7,permissionSeq:params.permissionSeq,lastInputSeq:0}}
  const grant=session.execute('set_read_only',{documentEpoch:7,permissionSeq:1,readOnly:false})
  const stale=assert.rejects(grant,/STALE_PERMISSION_UPDATE/);await started.promise
  const revoke=session.execute('set_read_only',{documentEpoch:7,permissionSeq:2,readOnly:true})
  assert.equal(session.readOnly,true)
  await assert.rejects(session.input('input_mouse',{documentEpoch:7,inputSeq:1,eventType:0}),{code:'READ_ONLY_PENDING',inputNotConsumed:true})
  gate.resolve();await stale;await revoke
  assert.equal(session.readOnly,true);assert.equal(session.permissionSeq,2)
  assert.deepEqual(calls.map(x=>x.permissionSeq),[1,2])
})
test('invalid or stale permission update cannot alter model and failed acknowledgement remains locked',async()=>{
  const {session,calls}=opened()
  for(const params of [{documentEpoch:6,permissionSeq:1,readOnly:false},{documentEpoch:7,permissionSeq:0,readOnly:false},{documentEpoch:7,permissionSeq:1,readOnly:0}])
    await assert.rejects(session.execute('set_read_only',params),/STALE_DOCUMENT|INVALID_PERMISSION_UPDATE/)
  assert.equal(session.readOnly,false);assert.equal(calls.length,0)
  session.engine.call=async()=>({documentEpoch:7,readOnly:false,permissionSeq:1,lastInputSeq:0})
  await assert.rejects(session.execute('set_read_only',{documentEpoch:7,permissionSeq:1,readOnly:true}),/not confirmed/)
  assert.equal(session.readOnly,true)
  await assert.rejects(session.execute('native_input',{action:'input_text',params:{documentEpoch:7}}),/not confirmed/)
})

test('document commands use session authority and writable bookmarks join the undo lineage',async()=>{
  const {session}=opened();session.revision=42
  const calls=[];let edits=0
  session.uno={call:async(action,params)=>{calls.push({action,params});return {success:true,revision:params.nativeRevision}}}
  session.undo.edit=async run=>{edits++;return run()}
  const result=await session.execute('get_document_text',{nativeReadOnly:true,nativeDocumentEpoch:999,nativeRevision:999,__agent:true})
  assert.equal(result.revision,42)
  assert.equal(calls[0].params.nativeReadOnly,false);assert.equal(calls[0].params.nativeDocumentEpoch,7)
  assert.equal(calls[0].params.nativeRevision,42);assert.equal(calls[0].params.__agent,true)
  await session.execute('find_text_locations',{keyword:'目标'})
  await session.execute('clear_anchors')
  assert.equal(edits,2)
  await assert.rejects(session.execute('get_paragraph',{documentEpoch:6,index:0}),/STALE_DOCUMENT/)
  assert.equal(calls.length,3)
})
test('readonly document searches and navigation cannot request writable bookmark handling',async()=>{
  const {session}=opened(true);const calls=[]
  session.undo.edit=async()=>{throw Error('readonly must not create bookmarks')}
  session.uno={call:async(action,params)=>{calls.push({action,params});return {success:true}}}
  for(const action of ['get_document_text','get_paragraph','get_outline','find_text_locations','set_selection','clear_anchors','get_cursor_context','get_hyperlink_at_cursor'])
    await session.execute(action,{nativeReadOnly:false})
  assert.ok(calls.every(call=>call.params.nativeReadOnly===true))
})
test('failed final-view restoration blocks future document writes and does not retry',async()=>{
  const {session}=opened();let reads=0
  session.unoCall=async()=>{reads++;throw Error('FINAL_TEXT_RESTORE_FAILED: enableSetModified')}
  await assert.rejects(session.execute('get_document_text',{__agent:true}),/FINAL_TEXT_RESTORE_FAILED/)
  await assert.rejects(session.execute('native_input',{action:'input_text',params:{documentEpoch:7,text:'no'}}),/FINAL_TEXT_RESTORE_FAILED/)
  assert.equal(reads,1)
})

test('agent view callbacks require fresh complete revision proof before retaining an existing card',async()=>{
  const {session,events}=opened(true)
  const item={revisionId:'1',identifier:'uno-1',author:'A',type:'Delete',dateTime:'2026-10-01',description:'Delete text',text:'full original text',textAvailable:true}
  const identity={documentEpoch:7,revision:0,items:[item],hydratedCount:1}
  session.review=identity
  const callback={type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:'1'}})}
  let currentText=item.text,proofs=0
  session.engine.call=async()=>({documentEpoch:7,items:[{...item}]})
  session.unoCall=async(method)=>{
    if(method==='get_document_text'){session.event(callback);return {success:true}}
    if(method==='check_revision_batch'){proofs++;return {entries:[{...item,index:0,text:currentText}],total:1}}
    throw Error(method)
  }
  await session.execute('get_document_text',{__agent:true})
  assert.equal(session.revision,0);assert.ok(proofs>0)
  assert.equal(events.filter(e=>e.type==='review-changed').length,0)
  // A late event with the same payload still checks the current full text.
  currentText='changed beyond an identical truncated description';session.event(callback)
  await new Promise(resolve=>setTimeout(resolve,10));await session.queue
  assert.equal(session.revision,1)
  assert.equal(events.filter(e=>e.type==='review-changed').length,1)
})

test('new revision events and actual edits are never suppressed by a view-read proof',async()=>{
  const {session,events}=opened(true)
  session.review={revision:0,hydratedCount:0,items:[]}
  session.unoCall=async()=>{session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:30,payload:'{}'});return {success:true}}
  await session.execute('get_outline',{__agent:true})
  assert.equal(session.revision,1)
  session.changed();assert.equal(session.revision,2)
  assert.equal(events.filter(e=>e.type==='review-changed').length,1)
})

test('view proofs are bounded, yield to queued input and cannot publish into another model',async()=>{
  const {session,events}=opened(true)
  const items=Array.from({length:60},(_,index)=>({revisionId:String(index),identifier:'uno-'+index,author:'A',type:'Delete',dateTime:'date',description:'summary',text:'full '+index,textAvailable:true}))
  session.review={revision:0,items,hydratedCount:60}
  const batches=[],order=[]
  session.engine.call=async()=>({documentEpoch:7,items})
  session.unoCall=async(method,params)=>{
    if(method==='get_document_text'){
      for(let index=0;index<60;index++)session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:String(index)}})})
      return {success:true}
    }
    batches.push(params.targets.length);order.push('proof')
    return {total:60,entries:params.targets.map(({index})=>({...items[index],index}))}
  }
  const read=session.execute('get_document_text',{__agent:true})
  const queued=session.task(()=>order.push('input-ready'))
  await read;await queued;await new Promise(resolve=>setTimeout(resolve,15));await session.queue
  assert.deepEqual(batches,[25,25,10]);assert.deepEqual(order.slice(0,2),['proof','input-ready'])
  const old=session.viewReadGuard
  old.pending.add(0);session.model={...session.model,documentEpoch:8}
  await session.verifyViewRead(old)
  assert.equal(batches.length,3);assert.equal(session.revision,0)
  session.closed=true
  assert.equal(session.currentViewRead(old),false)
  assert.equal(events.filter(e=>e.type==='review-changed').length,0)
})

test('selected native text commits inside one owned context and collapsed typing does not add an end RPC',async()=>{
  for(const grouped of [true,false]){
    const {session}=opened(),calls=[]
    session.unoCall=async(method,params)=>{calls.push(method);return {...params,grouped,closed:true}}
    session.engine.call=async(action,params)=>{calls.push(action);return {applied:true,lastInputSeq:params.inputSeq,documentEpoch:7}}
    await session.execute('native_input',{action:'input_text',params:{documentEpoch:7,inputSeq:1,text:'中文'}})
    assert.deepEqual(calls,grouped?['input_undo_begin','input_text','input_undo_end']:['input_undo_begin','input_text'])
  }
})

test('permission change while preparing input closes its context and does not consume or replay text',async()=>{
  const {session,calls}=opened();const prepared=latch(),release=latch(),cleanup=[]
  session.unoCall=async(method,params)=>{if(method==='input_undo_begin'){prepared.resolve();await release.promise;return {...params,grouped:true}}cleanup.push(params);return {...params,closed:true}}
  const commit=session.execute('native_input',{action:'input_text',params:{documentEpoch:7,inputSeq:1,text:'must not replay'}})
  const denied=assert.rejects(commit,{code:'READ_ONLY_PENDING',inputNotConsumed:true})
  await prepared.promise;session.permissionSeq++;session.readOnly=true;release.resolve();await denied
  assert.equal(calls.length,0);assert.equal(cleanup.length,1);assert.equal(cleanup[0].applied,false)
  assert.equal(session.failure,undefined)
})

test('uncertain input cleanup locks further writing while preserving the original input sequence',async()=>{
  const {session}=opened();let inputs=0
  session.unoCall=async(method,params)=>{if(method==='input_undo_begin')return {...params,grouped:true};throw Error('leave failed')}
  session.engine.call=async(action,params)=>{inputs++;return {applied:true,lastInputSeq:params.inputSeq,documentEpoch:7}}
  const request={action:'input_text',params:{documentEpoch:7,inputSeq:1,text:'once'}}
  await assert.rejects(session.execute('native_input',request),/INPUT_OUTCOME_UNKNOWN/)
  await assert.rejects(session.execute('native_input',request),/INPUT_OUTCOME_UNKNOWN/)
  assert.equal(inputs,1)
})

test('refreshing details keeps the published card usable and a resolution invalidates the pending snapshot',async()=>{
  const {session}=opened(),entered=latch(),release=latch()
  const item={revisionId:'1',identifier:'uno-1',author:'A',type:'Insert',dateTime:'date',description:'summary',text:'full text',textAvailable:true}
  const published={documentEpoch:7,refreshEpoch:1,revision:0,items:[item],hydratedCount:1}
  session.review=published
  session.engine.call=async()=>({documentEpoch:7,refreshEpoch:2,items:[{...item}]})
  session.unoCall=async()=>{entered.resolve();await release.promise;return {start:0,total:1,entries:[{...item,index:0}]}}
  let resolved=false
  session.resolveCard=async(action,card,identity)=>{assert.equal(identity,published);resolved=true;session.changed();session.review=null;return {success:true}}
  const refreshing=session.execute('list_revisions'),outcome=refreshing.then(value=>({value}),error=>({error}))
  try{
    await entered.promise
    assert.equal(session.review,published)
    const resolve=session.execute('resolve_revision',{documentSeq:7,revision:0,index:0,identifier:'uno-1',action:'accept',
      expectedRevision:{index:0,identifier:'uno-1',author:'A',type:'Insert',timestamp:'date',text:'full text'}})
    release.resolve();assert.equal((await resolve).success,true)
    assert.match((await outcome).error.message,/STALE_REVIEW_BATCH/)
    assert.equal(resolved,true);assert.equal(session.review,null)
  }finally{release.resolve();await outcome}
})

test('new text and evidence writes enforce readonly, epoch and native receipt types',async()=>{
  const actions=['replace_at_position','replace_selection','insert_at_cursor','modify_paragraph','bookmark_selection','set_selection_hyperlink','adopt_legacy_links']
  const {session:readonly,calls}=opened(true)
  for(const action of actions)await assert.rejects(readonly.execute(action,{nativeReadOnly:false}),{code:'READ_ONLY'})
  assert.equal(calls.length,0)
  const {session}=opened()
  await assert.rejects(session.execute('modify_paragraph',{documentSeq:6}),/STALE_DOCUMENT/)
  session.unoCall=async()=>({success:true,changed:false,textChanged:'false',trackingChanged:false})
  await assert.rejects(session.execute('modify_paragraph',{index:0,newText:'x'}),/EDIT_OUTCOME_UNKNOWN/)
  await assert.rejects(session.execute('export_document'),/EDIT_OUTCOME_UNKNOWN/)
})

test('text state-only change and evidence no-op use separate trusted undo proofs',async()=>{
  const {session,events}=opened();const noop=[]
  session.undo.edit=async(run,options)=>{const result=await run();noop.push(options.isNoop(result));return result}
  const replies=[{success:true,changed:true,textChanged:false,trackingChanged:true},
    {success:true,changed:false,bookmarkMutations:0,hyperlinkMutations:0},
    {success:true,changed:true,bookmarkMutations:0,hyperlinkMutations:1}]
  session.unoCall=async()=>replies.shift()
  await session.execute('modify_paragraph',{index:0,newText:'same'})
  await session.execute('adopt_legacy_links')
  await session.execute('set_selection_hyperlink',{url:'https://example.test'})
  assert.deepEqual(noop,[true,true,false]);assert.equal(events.filter(e=>e.type==='modified').length,2)
})

test('evidence navigation shares host model authority and restoration failure locks writes',async()=>{
  const {session}=opened(true);const calls=[]
  session.uno={call:async(action,params)=>{calls.push(params);return {success:true}}}
  for(const action of ['collapse_selection','get_bookmark_context','check_link_anchors','goto_bookmark','get_selection_hyperlink'])
    await session.execute(action,{nativeReadOnly:false,nativeDocumentEpoch:99,documentUrl:'file:///other'})
  assert.ok(calls.every(p=>p.nativeReadOnly===true&&p.nativeDocumentEpoch===7&&p.documentUrl==='file:///private/owned.docx'))
  session.unoCall=async()=>{throw Error('EDIT_OUTCOME_UNKNOWN: final restoration failed')}
  await assert.rejects(session.execute('collapse_selection'),/EDIT_OUTCOME_UNKNOWN/)
  await assert.rejects(session.execute('get_selection'),/EDIT_OUTCOME_UNKNOWN/)
})
