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

test('PDF export allows readonly, owns output path and returns verified bytes without a mutation',async()=>{
  const {session,events}=opened(true)
  session.review={revision:0,items:[],hydratedCount:0}
  session.run=await fs.mkdtemp(path.join(os.tmpdir(),'awd-pdf-'))
  session.unoCall=async(action,params)=>{
    assert.equal(action,'export_pdf');assert.equal(params.nativeOutputPath,path.join(session.run,'export.pdf'))
    await fs.writeFile(params.nativeOutputPath,'%PDF-test')
    return {success:true}
  }
  try{
    const result=await session.execute('export_pdf',{nativeOutputPath:'/untrusted.pdf'})
    assert.equal(Buffer.from(result.bytes).toString(),'%PDF-test');assert.equal(result.size,9)
    assert.equal(events.length,0);assert.equal(session.revision,0)
    await assert.rejects(fs.access(path.join(session.run,'export.pdf')),{code:'ENOENT'})
  }finally{await fs.rm(session.run,{recursive:true,force:true})}
})

test('PDF state uncertainty locks the native session instead of returning bytes',async()=>{
  const {session}=opened(true)
  session.review={revision:0,items:[],hydratedCount:0}
  session.run=await fs.mkdtemp(path.join(os.tmpdir(),'awd-pdf-'))
  session.unoCall=async()=>{throw Error('PDF_EXPORT_OUTCOME_UNKNOWN: source changed')}
  try{
    await assert.rejects(session.execute('export_pdf'),/PDF_EXPORT_OUTCOME_UNKNOWN/)
    assert.ok(session.failure)
  }finally{await fs.rm(session.run,{recursive:true,force:true})}
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
  assert.deepEqual(calls.map(call=>call.action), ['input_key','selected_text'])
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
  session.review={revision:42,items:[],hydratedCount:0}
  const calls=[];let edits=0
  session.uno={call:async(action,params)=>{if(action==='capture_view_read')return {token:'proof'};calls.push({action,params});return {success:true,revision:params.nativeRevision}}}
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
  session.review={revision:0,items:[],hydratedCount:0}
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
    if(method==='capture_view_read')return {token:'proof'}
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

test('view proofs are bounded, yield to queued input and cannot publish into another model',{timeout:2000},async()=>{
  const {session,events}=opened(true)
  const items=Array.from({length:60},(_,index)=>({revisionId:String(index),identifier:'uno-'+index,author:'A',type:'Delete',dateTime:'date',description:'summary',text:'full '+index,textAvailable:true}))
  session.review={revision:0,items,hydratedCount:60}
  const batches=[],order=[],completed=latch()
  session.engine.call=async()=>({documentEpoch:7,items})
  session.unoCall=async(method,params)=>{
    if(method==='capture_view_read')return {token:'proof'}
    if(method==='get_document_text'){
      for(let index=0;index<60;index++)session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:String(index)}})})
      return {success:true}
    }
    batches.push(params.targets.length);order.push('proof')
    if(batches.length===3)completed.resolve()
    return {total:60,entries:params.targets.map(({index})=>({...items[index],index}))}
  }
  const read=session.execute('get_document_text',{__agent:true})
  const queued=session.task(()=>order.push('input-ready'))
  await read;await queued;await completed.promise;await session.queue
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
    assert.deepEqual(calls,grouped?['input_undo_begin','input_text','input_undo_end','selected_text']:['input_undo_begin','input_text','selected_text'])
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

test('review suggestion refusal is nonfatal only with a verified unchanged receipt',async()=>{
  const {session}=opened();session.revision=4
  const result={success:false,reason:'stale',changed:false,textChanged:false,trackingChanged:false}
  session.unoCall=async()=>result
  let noops=0
  session.undo.edit=async(run,options)=>{const value=await run();assert.equal(options.isNoop(value),true);noops++;return value}
  assert.deepEqual(await session.execute('apply_review_edit',{revision:3}),{...result,revision:4})
  assert.equal(session.failure,undefined);assert.equal(noops,1);assert.equal(session.revision,4)
  result.changed=true
  await assert.rejects(session.execute('apply_review_edit',{revision:4}),/EDIT_OUTCOME_UNKNOWN/)
  assert.ok(session.failure)
})

test('review suggestion advances revision after a verified edit and enforces readonly and epoch',async()=>{
  const {session}=opened();session.revision=4
  session.unoCall=async()=>({success:true,changed:true,textChanged:true,trackingChanged:false,revision:4})
  const result=await session.execute('apply_review_edit',{revision:4})
  assert.equal(result.revision,5);assert.equal(session.revision,5)
  await assert.rejects(session.execute('apply_review_edit',{documentSeq:6}),/STALE_DOCUMENT/)
  const {session:readonly}=opened(true)
  await assert.rejects(readonly.execute('apply_review_edit'),{code:'READ_ONLY'})
})

test('non-agent review context uses the existing verified final-view callback guard',async()=>{
  const {session}=opened(true)
  const item={revisionId:'1',identifier:'uno-1',author:'A',type:'Delete',dateTime:'date',description:'deleted',text:'old',textAvailable:true}
  session.review={revision:0,items:[item],hydratedCount:1}
  session.engine.call=async()=>({documentEpoch:7,items:[item]})
  session.unoCall=async(method)=>{
    if(method==='check_revision_batch')return {entries:[{...item,index:0}],total:1}
    session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:'1'}})})
    return {success:true,revision:0}
  }
  for(const action of ['get_review_context','goto_review_range'])assert.equal((await session.execute(action)).revision,0)
  assert.equal(session.revision,0)
})

test('completion returns a continuation token only after authoritative post-edit proof',async()=>{
  const {session}=opened();const calls=[]
  session.listRevisions=async()=>{session.review={revision:session.revision,items:[],hydratedCount:0}}
  session.unoCall=async(action,params)=>{
    if(action==='capture_view_read')return {token:'proof'}
    calls.push({action,params,revision:session.revision})
    if(action==='accept_completion')return {success:true,changed:true,textChanged:true,trackingChanged:false,token:'pending',inserted:'后缀'}
    assert.equal(action,'get_completion_context');assert.equal(params.nativeAfterToken,'pending');assert.equal(params.nativeExpectedRevision,1)
    return {success:true,token:'fresh',revision:session.revision}
  }
  const result=await session.execute('accept_completion',{token:'old',prefix:'前',text:'前后缀'})
  assert.equal(result.token,'fresh');assert.equal(result.revision,1);assert.equal(result.inserted,'后缀')
  assert.deepEqual(calls.map(x=>[x.action,x.revision]),[['accept_completion',0],['get_completion_context',1]])
})

test('intervening input drops only the follow-up token without replaying a completed insertion',async()=>{
  const {session}=opened();let writes=0
  session.listRevisions=async()=>{session.changed();session.review={revision:session.revision,items:[],hydratedCount:0}}
  session.unoCall=async(action)=>{
    assert.equal(action,'accept_completion');writes++
    return {success:true,changed:true,textChanged:true,trackingChanged:false,token:'pending',inserted:'一次'}
  }
  const result=await session.execute('accept_completion',{token:'old',prefix:'前',text:'前一次'})
  assert.equal(result.success,true);assert.equal(result.token,null);assert.equal(result.inserted,'一次');assert.equal(writes,1)
})

test('completion write refusal is nonfatal, readonly gates all three writes and permission sequence is owned',async()=>{
  const {session}=opened();let proofReads=0
  session.listRevisions=async()=>{proofReads++;throw Error('not needed for refused write')}
  session.unoCall=async()=>({success:false,reason:'composing',changed:false,textChanged:false,trackingChanged:false})
  assert.equal((await session.execute('accept_writing_suggestion',{composing:true})).reason,'composing')
  assert.equal(session.failure,undefined);assert.equal(proofReads,0)
  const {session:readonly}=opened(true)
  for(const action of ['accept_completion','insert_completion_content','accept_writing_suggestion'])
    await assert.rejects(readonly.execute(action),{code:'READ_ONLY'})
  session.permissionSeq=8
  session.uno={call:async(action,params)=>{assert.equal(params.nativePermissionSeq,8);return {success:true}}}
  await NativeEditorSession.prototype.unoCall.call(session,'get_completion_context',{nativePermissionSeq:99})
})

test('final-text snapshots hydrate without the sidebar and reuse current complete proof',async()=>{
  const {session}=opened(true);let hydrated=0,reads=0
  session.listRevisions=async()=>{hydrated++;session.review={revision:session.revision,items:[],hydratedCount:0}}
  session.unoCall=async(method)=>{if(method==='capture_view_read')return {token:'proof'};reads++;return {success:true,revision:session.revision}}
  for(const [action,params] of [['get_document_text',{__agent:true}],['get_review_context',{}],['goto_review_range',{revision:0}]])
    assert.equal((await session.execute(action,params)).revision,0)
  assert.equal(hydrated,1);assert.equal(reads,3)
  session.changed()
  assert.equal((await session.execute('get_review_context')).revision,1)
  assert.equal(hydrated,2)
})

test('input queued while the final-text proof prepares invalidates it before UNO reads',async()=>{
  const {session}=opened(true);const entered=latch(),release=latch();let reads=0
  session.listRevisions=async()=>{session.review={revision:0,items:[],hydratedCount:0};entered.resolve();await release.promise}
  session.unoCall=async()=>{reads++;return {success:true}}
  const read=session.execute('get_review_context'),failed=assert.rejects(read,/STALE_REVIEW_BATCH/)
  await entered.promise;session.changed();release.resolve();await failed
  assert.equal(reads,0)
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


test('selection readback requires complete native proof; unknown navigation and proof errors remain ordinary',async()=>{
  const {session,events}=opened(true)
  session.review={revision:0,items:[],hydratedCount:0}
  let selectionUnchanged=true,contentUnchanged=true,broken=false,sequence=0
  const emit=()=>session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:2,payload:String(++sequence)})
  session.unoCall=async(method)=>{
    if(method==='capture_view_read')return {token:'owned-proof'}
    if(method==='check_view_read'){if(broken)throw Error('unreadable');return {selectionUnchanged,contentUnchanged}}
    if(method==='get_review_context'){emit();return {success:true,revision:session.revision}}
    throw Error(method)
  }
  await session.execute('get_review_context')
  assert.equal(events.filter(e=>e.type==='selection').at(-1).origin,'view-read')
  selectionUnchanged=false;emit();await new Promise(r=>setTimeout(r,10));await session.queue
  assert.equal(events.filter(e=>e.type==='selection').at(-1).origin,undefined)
  assert.equal(session.revision,0)
  selectionUnchanged=true;await session.execute('get_review_context')
  broken=true;emit();await new Promise(r=>setTimeout(r,10));await session.queue
  assert.equal(events.filter(e=>e.type==='selection').at(-1).origin,undefined)
  assert.equal(session.revision,1)
})

test('owned write callback burst invalidates once and still emits modified; later external edits invalidate again',async()=>{
  const {session,events}=opened()
  const callback={type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:1}})}
  session.unoCall=async()=>{for(let i=0;i<100;i++)session.event(callback);return {success:true,changed:true,textChanged:true,trackingChanged:false}}
  await session.execute('insert_at_cursor',{text:'once'})
  assert.equal(session.revision,1)
  assert.equal(events.filter(e=>e.type==='review-changed').length,1)
  assert.equal(events.filter(e=>e.type==='modified').length,1)
  session.event(callback);assert.equal(session.revision,2)
})

test('pointer and permission boundaries revoke readback provenance before native callbacks',async()=>{
  const {session,events}=opened(true)
  session.review={revision:0,items:[],hydratedCount:0}
  session.beginViewRead().selectionProof='old-proof'
  session.engine.call=async(action)=>{if(action==='input_mouse')session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:2,payload:'moved'});return {success:true}}
  await session.execute('native_input',{action:'input_mouse',params:{documentEpoch:7}})
  assert.equal(events.find(e=>e.type==='selection').origin,undefined)
  assert.equal(session.viewReadGuard,null)
})

test('replacing a review identity publishes pending unproven selections before another read',async()=>{
  const {session,events}=opened(true)
  session.review={revision:0,items:[],hydratedCount:0}
  const previous=session.beginViewRead();previous.selectionProof='previous-proof'
  session.engine.call=async action=>{
    if(action==='review_snapshot'){
      session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:2,payload:'new-selection'})
      return {documentEpoch:7,refreshEpoch:2,items:[]}
    }
    return {success:true}
  }
  await session.execute('list_revisions')
  assert.notEqual(session.review,previous.identity)
  assert.deepEqual(events.filter(e=>e.type==='selection'),[{type:'selection',documentEpoch:7}])
  assert.equal(previous.selections.length,0)
  assert.equal(session.viewReadGuard,null)
})

test('hydration cannot publish a new full text under an old revision while an unknown Modify is pending',async()=>{
  const {session,events}=opened(true)
  const item={revisionId:'1',identifier:'uno-1',author:'A',type:'Delete',dateTime:'date',description:'same short summary',text:'old full text',textAvailable:true}
  const previous={documentEpoch:7,revision:0,items:[item],hydratedCount:1}
  session.review=previous;session.beginViewRead()
  let snapshots=0
  session.engine.call=async()=>{
    if(++snapshots===3)session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:'1'}})})
    return {documentEpoch:7,refreshEpoch:2,items:[item]}
  }
  session.unoCall=async()=>({start:0,total:1,entries:[{...item,index:0,text:'different full text behind the same summary'}]})
  await assert.rejects(session.execute('list_revisions'),/STALE_REVIEW_BATCH/)
  assert.equal(session.review,previous);assert.equal(session.revision,1)
  assert.equal(events.filter(e=>e.type==='review-changed').length,1)
})

test('mouse, navigation and permission boundaries conservatively invalidate unverified Modify events',async()=>{
  for(const boundary of ['mouse','navigation','permission']){
    const {session,events}=opened(true)
    session.model.trackingInitialized=true
    const item={revisionId:'1',identifier:'uno-1',text:'old full text',textAvailable:true}
    session.review={revision:0,items:[item],hydratedCount:1};session.beginViewRead()
    session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:'1'}})})
    session.unoCall=async()=>({success:true})
    session.engine.call=async(action,params)=>({success:true,...params,lastInputSeq:0})
    if(boundary==='mouse')await session.execute('native_input',{action:'input_mouse',params:{documentEpoch:7}})
    else if(boundary==='navigation')await session.execute('goto_bookmark',{name:'anchor'})
    else await session.execute('set_read_only',{documentEpoch:7,permissionSeq:1,readOnly:true})
    assert.equal(session.revision,1,boundary);assert.equal(session.viewReadGuard,null)
    assert.equal(events.filter(e=>e.type==='review-changed').length,1,boundary)
  }
})

test('permission revocation also invalidates a Modify whose full-text proof is in flight',async()=>{
  const {session,events}=opened(true),entered=latch(),release=latch()
  session.model.trackingInitialized=true
  const item={revisionId:'1',identifier:'uno-1',text:'old full text',textAvailable:true}
  session.review={revision:0,items:[item],hydratedCount:1}
  const guard=session.beginViewRead();guard.pending.add(0)
  session.unoCall=async()=>{entered.resolve();await release.promise;return {total:1,entries:[{...item,index:0,text:'new full text'}]}}
  session.engine.call=async(action,params)=>({success:true,...params,lastInputSeq:0})
  const checking=session.verifyViewRead(guard);await entered.promise
  await session.execute('set_read_only',{documentEpoch:7,permissionSeq:1,readOnly:true})
  release.resolve();await checking
  assert.equal(session.revision,1);assert.equal(events.filter(e=>e.type==='review-changed').length,1)
})

test('explicit mutation invalidation absorbs pending proof exactly once without recursion',()=>{
  const {session,events}=opened()
  session.review={revision:0,items:[],hydratedCount:0}
  session.beginViewRead().pending.add(0)
  session.changed()
  assert.equal(session.revision,1);assert.equal(session.viewReadGuard,null)
  assert.deepEqual(events.map(e=>e.type),['modified'])
})

function pendingReviewAdoption() {
  const h=opened(),{session}=h
  const items=Array.from({length:60},(_,index)=>({revisionId:String(index),identifier:'uno-'+index,author:'A',type:'Delete',dateTime:'date',description:'summary',text:'full '+index,textAvailable:true}))
  session.review={revision:0,items,hydratedCount:items.length}
  const guard=session.beginViewRead()
  for(let index=0;index<items.length;index++)guard.pending.add(index)
  const batches=[],writes=[]
  session.engine.call=async()=>({documentEpoch:7,items})
  session.undo.edit=async run=>run()
  session.uno={call:async(method,params)=>{
    if(method==='check_revision_batch'){
      batches.push(params.targets.length)
      return {total:items.length,entries:params.targets.map(({index})=>({...items[index],index}))}
    }
    writes.push({method,params})
    const stale=params.revision!==params.nativeRevision
    return stale ? {success:false,reason:'stale',changed:false,textChanged:false,trackingChanged:false}
      : {success:true,changed:true,textChanged:true,trackingChanged:false}
  }}
  return {...h,items,guard,batches,writes}
}

test('adopting a captured suggestion verifies all pending read callbacks before clearing its proof',async()=>{
  for(const action of ['apply_review_edit','accept_completion']){
    const {session,batches,writes,events}=pendingReviewAdoption()
    const result=await session.executeQueued(action,{revision:0})
    assert.equal(result.success,true,action)
    assert.deepEqual(batches,[25,25,10]);assert.equal(writes.length,1)
    assert.equal(writes[0].params.nativeRevision,0);assert.equal(writes[0].params.revision,0)
    assert.equal(session.revision,1);assert.equal(events.filter(e=>e.type==='review-changed').length,0)
    assert.equal(events.filter(e=>e.type==='modified').length,1)
  }
})

test('adopting a suggestion still rejects a real full-text change hidden by the same summary',async()=>{
  const {session,writes,events}=pendingReviewAdoption(),call=session.uno.call
  session.uno.call=async(method,params)=>{
    const result=await call(method,params)
    if(method==='check_revision_batch')result.entries[0].text='external real edit'
    return result
  }
  const result=await session.executeQueued('apply_review_edit',{revision:0})
  assert.equal(result.success,false);assert.equal(result.reason,'stale')
  assert.equal(session.revision,1);assert.equal(events.filter(e=>e.type==='modified').length,0)
  assert.equal(writes[0].params.revision,0);assert.equal(writes[0].params.nativeRevision,1)
})

test('adoption proof has a full-list bound and cannot wait forever on repeating unknown callbacks',async()=>{
  const {session,batches,items}=pendingReviewAdoption(),call=session.uno.call
  session.uno.call=async(method,params)=>{
    const result=await call(method,params)
    if(method==='check_revision_batch')for(const {index} of params.targets)
      session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:items[index].revisionId}})})
    return result
  }
  const result=await session.executeQueued('apply_review_edit',{revision:0})
  assert.equal(result.reason,'stale');assert.equal(session.revision,1)
  assert.equal(batches.length,3);assert.equal(session.viewReadGuard,null)
})

test('permission revocation during the adoption proof rejects before entering the native write',async()=>{
  const {session,writes,events}=pendingReviewAdoption(),entered=latch(),release=latch(),call=session.uno.call
  session.model.trackingInitialized=true
  session.uno.call=async(method,params)=>{
    if(method==='check_revision_batch'){entered.resolve();await release.promise}
    return call(method,params)
  }
  const engine=session.engine.call
  session.engine.call=async(method,params)=>method==='set_read_only'?{...params,lastInputSeq:0}:engine(method,params)
  const adopting=session.executeQueued('apply_review_edit',{revision:0})
  const rejected=assert.rejects(adopting,{code:'READ_ONLY'})
  await entered.promise
  const revoked=session.execute('set_read_only',{documentEpoch:7,permissionSeq:1,readOnly:true})
  assert.equal(session.readOnly,true);release.resolve()
  await rejected;await revoked
  assert.equal(writes.length,0);assert.equal(session.revision,1)
  assert.equal(events.filter(e=>e.type==='modified').length,0)
})

test('an unknown revision event at the adoption worker barrier still expires the captured request',async()=>{
  const {session,writes,events}=pendingReviewAdoption(),engine=session.engine.call
  let sent=false
  session.engine.call=async(method,params)=>{
    if(method==='selected_text'&&!sent){sent=true;session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:30,payload:'{}'})}
    return engine(method,params)
  }
  const result=await session.executeQueued('apply_review_edit',{revision:0})
  assert.equal(result.reason,'stale');assert.equal(session.revision,1)
  assert.equal(writes[0].params.revision,0);assert.equal(writes[0].params.nativeRevision,1)
  assert.equal(events.filter(e=>e.type==='modified').length,0)
})

test('ruler drag verifies pending view callbacks without rebasing its captured revision',async()=>{
  const {session,guard,batches}=pendingReviewAdoption(),call=session.uno.call
  let captured,indent=0,writeRevision
  session.uno.call=async(method,params)=>{
    if(method==='get_ruler_state'){captured=params.nativeRevision;return {available:true,contextToken:'ruler-token',leftIndent:indent}}
    if(method==='set_ruler_state'){
      writeRevision=params.nativeRevision
      if(writeRevision!==captured)throw Error('STALE_RULER_CONTEXT')
      indent=params.patch.leftIndent;return {success:true,changed:true}
    }
    if(method==='view_metrics')return {pages:[],unit:'twip'}
    return call(method,params)
  }
  await session.verifyViewRead(guard);assert.equal(guard.pending.size,35)
  const state=await session.execute('get_ruler_state')
  const result=await session.execute('set_ruler_state',{contextToken:state.contextToken,patch:{leftIndent:180}})
  assert.equal(result.leftIndent,180);assert.equal(result.changed,true)
  assert.deepEqual(batches,[25,25,10]);assert.equal(writeRevision,0);assert.equal(session.revision,1)
})

function initializingViewRead() {
  const h=opened(),{session}=h,entered=latch(),release=latch()
  const items=Array.from({length:60},(_,index)=>({revisionId:String(index),identifier:'init-'+index,author:'A',type:'Delete',dateTime:'date',description:'summary '+index,text:'full '+index,textAvailable:true}))
  const calls=[];let first=true,changedText=false
  session.engine.call=async(action,params)=>{
    calls.push({action,params})
    if(action==='review_snapshot')return {documentEpoch:7,refreshEpoch:1,items:items.map(item=>({...item}))}
    return {success:true,...params,lastInputSeq:0}
  }
  session.unoCall=async(action,params)=>{
    calls.push({action,params})
    if(action==='snapshot_batch'){
      if(first){first=false;entered.resolve();await release.promise}
      return {start:params.start,total:items.length,entries:items.slice(params.start,params.start+params.limit).map((item,i)=>({...item,index:params.start+i}))}
    }
    if(action==='capture_view_read')return {token:'init-proof'}
    if(action==='get_document_text')return {success:true,text:'restored document'}
    if(action==='match_view_options')return {matches:false,view:{ruler:false}}
    if(action==='set_view_options'){
      for(const item of items)session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:item.revisionId}})})
      return {success:true}
    }
    if(action==='view_settings')return {ruler:false}
    if(action==='check_revision_batch')return {total:items.length,entries:params.targets.map(({index})=>({...items[index],index,...(changedText?{text:'external full text'}:{})}))}
    throw Error(action)
  }
  return {...h,items,calls,entered,release,changeText:()=>{changedText=true}}
}

test('late view initialization shares in-flight hydration instead of invalidating the first final reads',async()=>{
  const h=initializingViewRead(),{session}=h
  const first=session.execute('get_document_text',{__agent:true})
  await h.entered.promise
  const second=session.execute('get_document_text',{__agent:true})
  const view=session.execute('set_view_options',{formattingMarks:true,ruler:true})
  const completed=Promise.allSettled([first,second,view]);h.release.resolve()
  const results=await completed
  assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled','fulfilled'])
  assert.equal(session.revision,0)
  assert.equal(h.calls.filter(c=>c.action==='snapshot_batch').length,3,'only the already requested hydration')
  assert.equal(h.calls.filter(c=>c.action==='get_document_text').length,2,'neither final read retries')
  assert.equal(h.calls.filter(c=>c.action==='set_view_options').length,1)
  await new Promise(r=>setTimeout(r,15));await session.queue
  assert.equal(session.revision,0);assert.equal(h.events.filter(e=>e.type==='review-changed').length,0)
})

test('view initialization without a review reader stays light and fences worker callbacks',async()=>{
  const {session,calls}=opened();const uno=[]
  session.unoCall=async action=>{uno.push(action);return action==='match_view_options'?{matches:false,view:{ruler:false}}:action==='view_settings'?{ruler:false}:{success:true}}
  await session.execute('set_view_options',{formattingMarks:true})
  assert.deepEqual(uno,['match_view_options','set_view_options','view_settings'])
  assert.deepEqual(calls.map(c=>c.action),['selected_text'])
  assert.equal(session.review,null);assert.equal(session.reviewRead,undefined)
})

test('guarded view initialization still invalidates an actual full-text change',async()=>{
  const h=initializingViewRead(),{session}=h
  session.review={revision:0,items:h.items,hydratedCount:h.items.length};h.changeText()
  await session.execute('set_view_options',{formattingMarks:true})
  assert.equal(session.revision,1)
  assert.equal(h.events.filter(e=>e.type==='review-changed').length,1)
  assert.equal(h.calls.filter(c=>c.action==='snapshot_batch').length,0,'existing identity needs no hydration')
})

test('view initialization waiting for hydration rejects changed document, permission and close boundaries',async()=>{
  for(const boundary of ['edit','permission','retarget','close']){
    const h=initializingViewRead(),{session}=h
    const read=session.execute('get_document_text',{__agent:true})
    await h.entered.promise
    const view=session.execute('set_view_options',{formattingMarks:true})
    const completed=Promise.allSettled([read,view])
    if(boundary==='edit')session.changed()
    if(boundary==='permission'){session.permissionSeq++;session.readOnly=true}
    if(boundary==='retarget')session.model={...session.model,documentEpoch:8}
    if(boundary==='close')session.closed=true
    h.release.resolve();const results=await completed
    assert.equal(results[1].status,'rejected',boundary)
    assert.equal(h.calls.filter(c=>c.action==='set_view_options').length,0,boundary)
    assert.equal(h.calls.filter(c=>c.action==='snapshot_batch').length<=3,true,'no hydration retry')
  }
})

test('queued keyboard editing still cancels a view initialization waiting on revision hydration',async()=>{
  const h=initializingViewRead(),{session}=h
  session.undo.edit=async run=>run()
  const read=session.execute('get_document_text',{__agent:true});await h.entered.promise
  const view=session.execute('set_view_options',{formattingMarks:true})
  const input=session.execute('native_input',{action:'input_key',params:{documentEpoch:7,eventType:0,keyCode:65,charCode:65}})
  const completed=Promise.allSettled([read,view,input]);h.release.resolve()
  const results=await completed
  assert.deepEqual(results.map(r=>r.status),['rejected','rejected','fulfilled'])
  assert.equal(h.calls.filter(c=>c.action==='input_key').length,1)
  assert.equal(h.calls.filter(c=>c.action==='set_view_options').length,0)
  assert.equal(session.revision,1)
})

function pendingBalloonResolution() {
  const h=pendingReviewAdoption(),{session,items}=h
  session.review.documentEpoch=7;session.review.refreshEpoch=1
  const resolved=[],checked=[],call=session.uno.call
  session.uno.call=async(action,params)=>{
    if(action==='check_revision'){
      checked.push(params.identifier)
      return {...items.find(item=>item.identifier===params.identifier)}
    }
    return call(action,params)
  }
  session.engine.call=async(action,params)=>{
    if(action==='review_resolve'){resolved.push(params);return {success:true,applied:true,remainingCount:items.length-1}}
    return {documentEpoch:7,refreshEpoch:2,items}
  }
  session.undo.resolve=async run=>run({displayChanged:true})
  const expected={index:2,identifier:items[2].identifier,type:items[2].type,text:items[2].text,author:items[2].author,timestamp:items[2].dateTime}
  const params=action=>action==='resolve_revision'
    ? {documentSeq:7,revision:0,index:2,identifier:expected.identifier,action:'accept',expectedRevision:{...expected}}
    : {documentSeq:7,revision:0,indices:[2],action:'accept',expectedRevisions:[{...expected}]}
  return {...h,resolved,checked,params}
}

test('balloon accept and reject finish bounded pending proof before resolving the captured identity',async()=>{
  for(const action of ['resolve_revisions','resolve_revision'])for(const decision of ['accept','reject']){
    const {session,batches,resolved,checked,params,events}=pendingBalloonResolution()
    const result=await session.execute(action,{...params(action),action:decision})
    assert.equal(result.success,true,action+' '+decision)
    assert.deepEqual(batches,[25,25,10]);assert.equal(resolved.length,1)
    assert.equal(resolved[0].revisionId,'2');assert.equal(resolved[0].decision,decision)
    assert.deepEqual(checked,['uno-2'],'production target/full-text check still runs')
    assert.equal(session.revision,1);assert.equal(session.review,null)
    assert.equal(events.filter(e=>e.type==='modified').length,1)
  }
})

test('balloon resolution keeps actual-text, expected-target and repeated-callback refusals',async()=>{
  for(const reason of ['changed-text','expected-text','repeated-callbacks','new-revision']){
    const {session,items,batches,resolved,params}=pendingBalloonResolution(),call=session.uno.call,engine=session.engine.call
    session.uno.call=async(action,p)=>{
      const result=await call(action,p)
      if(action==='check_revision_batch'){
        if(reason==='changed-text')result.entries[0].text='real external edit'
        if(reason==='repeated-callbacks')for(const {index} of p.targets)
          session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:items[index].revisionId}})})
      }
      return result
    }
    if(reason==='new-revision')session.engine.call=async(action,p)=>{
      if(action==='selected_text')session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:30,payload:'{}'})
      return engine(action,p)
    }
    const request=params('resolve_revisions')
    if(reason==='expected-text')request.expectedRevisions[0].text='outdated rendered text'
    await assert.rejects(session.execute('resolve_revisions',request),/STALE_REVIEW/,reason)
    assert.equal(resolved.length,0,reason);assert.ok(batches.length<=3,'one full-list proof bound')
  }
})

test('balloon resolution cannot write after permission revocation or close during proof',async()=>{
  for(const boundary of ['permission','close']){
    const {session,resolved,params}=pendingBalloonResolution(),entered=latch(),release=latch(),call=session.uno.call
    session.uno.call=async(action,p)=>{if(action==='check_revision_batch'){entered.resolve();await release.promise}return call(action,p)}
    const resolving=session.execute('resolve_revisions',params('resolve_revisions'))
    const rejected=assert.rejects(resolving,/Read-only|STALE_REVIEW|closed/)
    await entered.promise
    if(boundary==='permission'){session.permissionSeq++;session.readOnly=true;session.clearViewRead()}
    else session.closed=true
    release.resolve();await rejected;assert.equal(resolved.length,0,boundary)
  }
})

test('balloon navigation shares the captured proof and preserves readonly and real selection events',async()=>{
  for(const readOnly of [false,true]){
    const {session,batches,params,resolved,checked,events}=pendingBalloonResolution(),call=session.uno.call,engine=session.engine.call
    session.readOnly=readOnly;const visited=[]
    session.uno.call=async(action,p)=>action==='verify_location'?{success:true}:call(action,p)
    session.engine.call=async(action,p)=>{
      if(action==='review_goto'){
        visited.push(p)
        session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:2,payload:'actual clicked revision range'})
        return {success:true,applied:true}
      }
      return engine(action,p)
    }
    const request=params('resolve_revision')
    const result=await session.execute('goto_revision',request)
    assert.equal(result.success,true);assert.equal(visited.length,1)
    assert.equal(visited[0].revisionId,'2');assert.deepEqual(checked,['uno-2'])
    assert.deepEqual(batches,[25,25,10]);assert.equal(session.revision,0)
    assert.equal(request.revision,0);assert.equal(resolved.length,0)
    assert.equal(events.filter(e=>e.type==='selection').at(-1).origin,undefined)
    assert.equal(events.filter(e=>e.type==='modified').length,0)
  }
})

test('all balloon target actions retain the original stale caller revision',async()=>{
  for(const action of ['goto_revision','resolve_revision','resolve_revisions']){
    const {session,params,resolved,checked}=pendingBalloonResolution()
    const request=params(action==='goto_revision'?'resolve_revision':action);request.revision=-1
    await assert.rejects(session.execute(action,request),/STALE_REVIEW/)
    assert.equal(request.revision,-1);assert.equal(session.revision,0)
    assert.equal(resolved.length,0);assert.equal(checked.length,0)
  }
})


test('view preference fast path reads actual UNO state without waiting for existing hydration',async()=>{
  const {session,calls}=opened(),view={ruler:true,verticalRuler:true,zoom:137},read=latch(),uno=[]
  session.model.view={ruler:false,zoom:100}
  session.reviewRead={owner:session.model,revision:0,promise:read.promise}
  session.unoCall=async(action,params)=>{uno.push({action,params});assert.equal(action,'match_view_options');return {matches:true,view}}
  const result=await Promise.race([session.execute('set_view_options',{ruler:true,documentEpoch:7}),new Promise((_,reject)=>setTimeout(()=>reject(Error('waited for hydration')),100))])
  assert.equal(result.success,true);assert.equal(result.unchanged,true);assert.deepEqual(result.nativeView,view)
  assert.deepEqual(uno,[{action:'match_view_options',params:{ruler:true}}]);assert.deepEqual(calls,[])
  assert.equal(session.review,null);assert.equal(session.revision,0);read.resolve()
})

test('view preference fast path refuses changed owner permission close or real edit during actual-state read',async()=>{
  for(const boundary of ['retarget','permission','close','edit']){
    const {session}=opened(),entered=latch(),release=latch();let writes=0
    session.unoCall=async action=>{if(action!=='match_view_options'){writes++;return {ruler:true}}
      entered.resolve();await release.promise;return {matches:true,view:{ruler:true,zoom:100}}}
    const result=session.execute('set_view_options',{ruler:true,documentEpoch:7}),done=assert.rejects(result,/STALE_|closed/)
    await entered.promise
    if(boundary==='retarget')session.model={...session.model,documentEpoch:8}
    if(boundary==='permission'){session.permissionSeq++;session.readOnly=true}
    if(boundary==='close')session.closed=true
    if(boundary==='edit')session.changed()
    release.resolve();await done;assert.equal(writes,0,boundary)
  }
})

test('view preference fast path never trusts cached options when actual UNO state differs',async()=>{
  const {session,calls}=opened(),uno=[]
  session.model.view={ruler:true,zoom:100}
  session.unoCall=async action=>{uno.push(action);return action==='match_view_options'?{matches:false,view:{ruler:false,zoom:100}}:{ruler:true,zoom:100}}
  const result=await session.execute('set_view_options',{ruler:true})
  assert.notEqual(result.unchanged,true)
  assert.deepEqual(uno,['match_view_options','set_view_options','view_settings','view_metrics'])
  assert.deepEqual(calls.map(c=>c.action),['selected_text']);assert.equal(session.review,null)
})

test('load view preferences are applied and worker callbacks drained before trackingReady',async()=>{
  for(const readOnly of [false,true]){
    const run=await fs.mkdtemp(path.join(os.tmpdir(),'awd-native-view-init-'))
    const session=new NativeEditorSession({config:{},run,readOnly}),calls=[],prefs={ruler:true,formattingMarks:true,textBoundaries:false}
    const callback=()=>session.event({type:'callback',documentEpoch:7,viewId:3,callbackType:31,payload:JSON.stringify({redline:{action:'Modify',index:1}})})
    session.start=async()=>{}
    session.engine={call:async(action)=>{calls.push(action);if(action==='open_blank')return {readOnly,documentEpoch:7,viewId:3}
      assert.equal(action,'selected_text');assert.equal(session.model.trackingReady,false);callback();return {success:true}}}
    session.unoCall=async(action,params)=>{calls.push(action);assert.equal(session.model.trackingReady,false)
      if(action==='tracking'||action==='tracking_state')return {enabled:true,modified:false}
      if(action==='set_view_options'){assert.deepEqual(params,prefs);callback();return {ruler:true,verticalRuler:true,zoom:100}}
      return action==='view_settings'?{ruler:true,verticalRuler:true,zoom:100}:{} }
    try{
      const result=await session.execute('load_document',{bytes:[],name:'blank.docx',authorName:'A',viewOptions:prefs})
      assert.deepEqual(calls,['open_blank','author',readOnly?'tracking_state':'tracking','set_view_options','view_settings','view_metrics','selected_text'])
      assert.equal(result.nativeModel.view.ruler,true);assert.equal(session.model.trackingReady,true);assert.equal(session.revision,1)
      callback();assert.equal(session.revision,2,'external post-ready change still invalidates')
    }finally{await fs.rm(run,{recursive:true,force:true})}
  }
})

test('load view preference validation and async ownership refuse invalid readiness',async()=>{
  for(const options of [null,[],true,'invalid']){
    const session=new NativeEditorSession({config:{},run:'/unused',readOnly:false});let starts=0
    session.start=async()=>{starts++;throw Error('must not start')}
    await assert.rejects(session.execute('load_document',{bytes:[],name:'blank.docx',authorName:'A',viewOptions:options}),/viewOptions/)
    assert.equal(starts,0)
  }
  for(const boundary of ['permission','close','retarget']){
    const session=new NativeEditorSession({config:{},run:'/unused',readOnly:false}),entered=latch(),release=latch()
    session.start=async()=>{}
    session.engine={call:async action=>{if(action==='open_blank')return {readOnly:false,documentEpoch:7,viewId:3}
      entered.resolve();await release.promise;return {success:true}}}
    session.unoCall=async action=>(action==='tracking'?{enabled:true,modified:false}:{})
    const loading=session.execute('load_document',{bytes:[],name:'blank.docx',authorName:'A',viewOptions:{ruler:true}})
    const done=assert.rejects(loading,/STALE_|closed/);await entered.promise
    if(boundary==='permission')session.permissionSeq++
    if(boundary==='close')session.closed=true
    if(boundary==='retarget')session.model={...session.model,documentEpoch:8}
    release.resolve();await done;assert.equal(session.model.trackingReady,false)
  }
})

test('view preference mismatch shares a new final reader started while actual-state matching is pending',async()=>{
  const h=initializingViewRead(),{session}=h,matching=latch(),releaseMatch=latch(),uno=session.unoCall
  session.unoCall=async(action,params)=>{if(action==='match_view_options'){matching.resolve();await releaseMatch.promise;return {matches:false,view:{ruler:false}}}return uno(action,params)}
  const view=session.execute('set_view_options',{formattingMarks:true,ruler:true})
  await matching.promise
  const read=session.execute('get_document_text',{__agent:true}),completed=Promise.allSettled([view,read])
  releaseMatch.resolve();await h.entered.promise
  assert.equal(h.calls.filter(c=>c.action==='set_view_options').length,0,'setter must wait for reader created during match')
  h.release.resolve();const results=await completed
  assert.deepEqual(results.map(r=>r.status),['fulfilled','fulfilled'])
  assert.equal(session.revision,0);assert.equal(h.calls.filter(c=>c.action==='snapshot_batch').length,3)
  await new Promise(r=>setTimeout(r,15));await session.queue;assert.equal(session.revision,0)
})

test('already-inline export saves real bytes without waiting for the review reader', async () => {
  const { session, calls } = opened(), waiting = latch()
  session.run = await fs.mkdtemp(path.join(os.tmpdir(), 'awd-inline-export-'))
  session.reviewRead = { owner: session.model, revision: session.revision, promise: waiting.promise }
  const views = []
  session.unoCall = async (action, params) => { views.push([action, params]); assert.equal(action, 'view'); assert.equal(params, undefined); return { mode: 'all' } }
  session.engine.call = async (action, params) => {
    calls.push({ action, params })
    if (action === 'save') await fs.writeFile(params.path, 'saved-current-docx')
    else assert.equal(action, 'selected_text')
    return { success: true }
  }
  try {
    const result = await Promise.race([session.execute('export_document'), new Promise((_, reject) => setTimeout(() => reject(Error('waited for review hydration')), 200))])
    assert.equal(Buffer.from(result.bytes).toString(), 'saved-current-docx')
    assert.deepEqual(calls.map(c => c.action), ['save', 'selected_text'])
    assert.equal(views.length, 2); assert.equal(session.review, null)
  } finally { waiting.resolve(); await fs.rm(session.run, { recursive: true, force: true }) }
})

test('inline export refuses permission owner content view and close changes before publishing bytes', async () => {
  for (const boundary of ['permission', 'permission-roundtrip', 'retarget', 'edit', 'callback', 'view', 'close', 'failed-save']) {
    const { session } = opened()
    session.run = await fs.mkdtemp(path.join(os.tmpdir(), 'awd-inline-fence-'))
    let views = 0
    session.unoCall = async action => { assert.equal(action, 'view'); return { mode: ++views > 1 && boundary === 'view' ? 'final' : 'all' } }
    session.engine.call = async (action, params) => {
      if (action === 'save') {
        await fs.writeFile(params.path, 'must-not-publish')
        if (boundary === 'permission') { session.readOnly = true; session.permissionSeq++ }
        if (boundary === 'permission-roundtrip') session.permissionSeq += 2
        if (boundary === 'callback') session.event({ type: 'callback', documentEpoch: 7, viewId: 3, callbackType: 31, payload: 'unknown' })
        if (boundary === 'retarget') session.model = { ...session.model, documentEpoch: 8 }
        if (boundary === 'edit') session.changed()
        if (boundary === 'close') session.closed = true
        if (boundary === 'failed-save') return { success: false }
      }
      return { success: true }
    }
    try { await assert.rejects(session.execute('export_document'), /STALE_|Read-only|closed|export failed/, boundary) }
    finally { await fs.rm(session.run, { recursive: true, force: true }) }
  }
})

test('non-inline export retains full preparation and restores the actual revision view', async () => {
  for (const initial of ['final', 'balloons', 'margin']) {
    const { session } = opened(), calls = []
    session.review = { revision: 0, items: [], hydratedCount: 0 }
    session.run = await fs.mkdtemp(path.join(os.tmpdir(), 'awd-transition-export-'))
    let mode = initial
    session.unoCall = async (action, params) => {
      assert.equal(action, 'view'); calls.push(params?.mode || 'read')
      if (params?.mode) mode = params.mode
      return { mode }
    }
    session.engine.call = async (action, params) => {
      if (action === 'save') { assert.equal(mode, 'all'); await fs.writeFile(params.path, 'all-layers') }
      return { success: true }
    }
    try {
      const result = await session.execute('export_document')
      assert.equal(Buffer.from(result.bytes).toString(), 'all-layers'); assert.equal(mode, initial)
      assert.deepEqual(calls, ['read', 'read', 'all', initial]); assert.ok(session.viewReadGuard)
    } finally { await fs.rm(session.run, { recursive: true, force: true }) }
  }
})


test('inline export rejects a stale caller revision before saving', async () => {
  const { session, calls } = opened()
  session.unoCall = async () => { throw Error('must not query view') }
  await assert.rejects(session.execute('export_document', { nativeExpectedRevision: -1 }), /STALE_DOCUMENT_EXPORT/)
  assert.deepEqual(calls, [])
})
