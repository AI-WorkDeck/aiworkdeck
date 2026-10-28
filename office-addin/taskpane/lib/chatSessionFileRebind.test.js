// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
const store=new Map()
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}
globalThis.Office={context:{document:{url:'file:///source.docx'},requirements:{isSetSupported:()=>true}}}
let saves=0, propertyWrites=0, separateWindow=false
const change=()=>{globalThis.Office.context.document.url='file:///destination.docx'}
globalThis.Word={run:async cb=>cb({document:{body:{load(){},text:'Synthetic'},properties:{set title(v){propertyWrites++}},save(){saves++}},application:{createDocument:()=>({open:()=>{if(!separateWindow)change()}})},sync:async()=>{}})}
const {activateSession,send,stop,streaming,syncActiveDocument,newConversation}=await import('./chatSession.js')
const settings={serverUrl:'https://cloud.example',token:'test-token'}
const json=body=>({ok:true,status:200,json:async()=>body})
function stream(){const queue=[];let waiting;return {push(event,data){const chunk={done:false,value:new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)};if(waiting){const cb=waiting;waiting=null;cb(chunk)}else queue.push(chunk)},reader:{read:()=>queue.length?Promise.resolve(queue.shift()):new Promise(r=>waiting=r)}}}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}assert.fail('condition not reached')}

for (const replacementKind of ['project', 'conversation']) test(`${replacementKind}: closed connection cannot deliver late commands or terminal events into the replacement session`, async () => {
  const originalFetch = globalThis.fetch
  let connection, issued = 0
  const replies = []
  propertyWrites = 0
  globalThis.Office.context.document.url = 'file:///late-connection.docx'
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/api/ai/history')) return json([])
    if (url.endsWith('/api/agent/conversations')) return json({ conversationId: 'late-' + (++issued) })
    if (url.includes('/api/agent/connect/')) { connection = stream(); return { ok: true, status: 200, body: { getReader: () => connection.reader } } }
    if (url.endsWith('/api/agent/office/result')) replies.push(JSON.parse(options.body))
    return json([])
  }
  try {
    await activateSession({ settings, projectId: 'late-old-' + replacementKind }); await send('Old turn')
    const old = connection
    if (replacementKind === 'project') await activateSession({ settings, projectId: 'late-new' })
    else newConversation()
    await send('New turn')
    const replacement = connection
    old.push('client_action', { tool: 'office_command', requestId: 'late-write', command: 'set_document_properties', args: { title: 'Old turn' } })
    old.push('bubble_end', { status: 'finished' })
    await new Promise(r => setTimeout(r, 25))
    assert.equal(propertyWrites, 0)
    assert.equal(replies.length, 0)
    assert.equal(streaming.value, true, 'old terminal event cannot finish the replacement turn')
    replacement.push('client_action', { tool: 'office_command', requestId: 'current-write', command: 'set_document_properties', args: { title: 'Current turn' } })
    await until(() => replies.length === 1)
    assert.equal(replies[0].requestId, 'current-write')
    assert.equal(propertyWrites, 1)
    replacement.push('bubble_end', { status: 'finished' })
    await until(() => !streaming.value)
  } finally { await stop(); globalThis.fetch = originalFetch }
})

for(const command of ['file_create','file_open','file_save','manual-switch-back','file_create_separate_window','file_open_separate_window'])test(`${command}: post old result before rebind and enforce file lifecycle boundaries`,async()=>{
  const originalFetch=globalThis.fetch;let issued=0,connection,release
  separateWindow=command.endsWith('_separate_window')
  const actionCommand=command.replace('_separate_window','')
  const replies=[];const resultGate=new Promise(r=>release=r)
  globalThis.Office.context.document.url='file:///source-'+command+'.docx';saves=0;propertyWrites=0
  globalThis.fetch=async(url,options={})=>{
    if(url.includes('/api/ai/history'))return json([])
    if(url.endsWith('/api/agent/conversations'))return json({conversationId:'file-'+command+'-'+(++issued)})
    if(url.includes('/api/agent/connect/')){connection=stream();return {ok:true,status:200,body:{getReader:()=>connection.reader}}}
    if(url.endsWith('/api/agent/office/result')){const body=JSON.parse(options.body);replies.push(body);if(body.requestId==='first')await resultGate;return json({})}
    if(url.endsWith('/api/agent/chat')||url.includes('/api/agent/cancel/'))return json({})
    return json([])
  }
  try{
    await activateSession({settings,projectId:'file-'+command});await send('Synthetic file operation')
    const old=connection
    old.push('client_action',{tool:'office_command',requestId:'first',command:command==='manual-switch-back'?'file_save':actionCommand,args:actionCommand==='file_open'?{base64:btoa('PK\x03\x04test')}:{}})
    await until(()=>replies.length===1)
    assert.equal(replies[0].ok,true)
    if(command==='manual-switch-back')change()
    await syncActiveDocument();assert.equal(issued,1,'in-flight result must retain its old conversation')
    if(command==='manual-switch-back')globalThis.Office.context.document.url='file:///source-'+command+'.docx'
    old.push('client_action',{tool:'office_command',requestId:'second',command:'set_document_properties',args:{title:'New title'}})
    old.push('text_delta',{content:'<final>Done.</final>'})
    old.push('bubble_end',{status:'finished'})
    await until(()=>!streaming.value)
    assert.equal(issued,1,'terminal event cannot rebind before pending result POST finishes')
    release();await until(()=>replies.length===2)
    if(command==='file_save'){
      assert.equal(replies[1].ok,true);assert.equal(saves,1);assert.equal(propertyWrites,1);assert.equal(issued,1)
    }else if(command==='manual-switch-back'){
      assert.equal(replies[1].ok,false);assert.equal(propertyWrites,0,'switching back must not resume the old tool stream');assert.equal(issued,1)
    }else if(separateWindow){
      assert.equal(replies[1].ok,false);assert.equal(propertyWrites,0,'opening another window must not permit edits to the source')
      assert.equal(globalThis.Office.context.document.url,'file:///source-'+command+'.docx')
      assert.equal(issued,1,'the source pane must not invent a destination session')
      await new Promise(r=>setTimeout(r,0))
      await send('New explicit request for the source document')
      old.push('client_action',{tool:'office_command',requestId:'third',command:'set_document_properties',args:{title:'Explicit source edit'}})
      await until(()=>replies.length===3)
      assert.equal(replies[2].ok,true);assert.equal(propertyWrites,1)
      old.push('text_delta',{content:'<final>Done.</final>'});old.push('bubble_end',{status:'finished'})
      await until(()=>!streaming.value)
    }else{
      assert.equal(replies[1].ok,false);assert.equal(propertyWrites,0,'old stream cannot edit the newly opened document')
      await until(()=>issued===2)
    }
  }finally{release();await stop();globalThis.fetch=originalFetch}
})

for (const phase of ['result-post', 'native-command']) test(`${phase}: project/account switch rejects queued old commands and posts receipts with original settings`, async () => {
  const originalFetch = globalThis.fetch
  let connection, issued = 0, release, nativeStarted = false
  const originalWordRun = globalThis.Word.run
  const replies = [], gate = new Promise(r => { release = r })
  separateWindow = true; propertyWrites = 0
  if (phase === 'native-command') globalThis.Word.run = async cb => {
    let created = false
    const result = await originalWordRun(context => {
      const originalCreate = context.application.createDocument
      context.application.createDocument = (...args) => { created = true; return originalCreate(...args) }
      return cb(context)
    })
    if (created) { nativeStarted = true; await gate }
    return result
  }
  globalThis.Office.context.document.url = 'file:///project-switch.docx'
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/api/ai/history')) return json([])
    if (url.endsWith('/api/agent/conversations')) return json({ conversationId: 'project-switch-' + (++issued) })
    if (url.includes('/api/agent/connect/')) { connection = stream(); return { ok: true, status: 200, body: { getReader: () => connection.reader } } }
    if (url.endsWith('/api/agent/office/result')) {
      const body = JSON.parse(options.body); replies.push({ url, body })
      if (phase === 'result-post' && body.requestId === 'switch-first') await gate
      return json({})
    }
    return json([])
  }
  try {
    await activateSession({ settings, projectId: 'old-project' }); await send('Synthetic')
    const old = connection
    old.push('client_action', { tool: 'office_command', requestId: 'switch-first', command: 'file_create', args: {} })
    await until(() => phase === 'result-post' ? replies.length === 1 : nativeStarted)
    old.push('client_action', { tool: 'office_command', requestId: 'switch-second', command: 'set_document_properties', args: { title: 'Old request' } })
    await new Promise(r => setTimeout(r, 15))
    await activateSession({ settings: { ...settings, serverUrl: 'https://new-account.example', token: 'new-token' }, projectId: 'new-project' })
    release(); await until(() => replies.length === 2)
    assert.equal(propertyWrites, 0, 'old queue must not resume editing after activateSession resets turn flags')
    assert.equal(replies[1].body.ok, false)
    assert.ok(replies.every(reply => reply.url.startsWith(settings.serverUrl)), 'all old request receipts use original server/account')
  } finally { release(); await stop(); globalThis.fetch = originalFetch; globalThis.Word.run = originalWordRun }
})

test('cross-document queue retains its receiving session and original result destination', async () => {
  const originalFetch = globalThis.fetch
  let connection, issued = 0, release
  const replies = [], gate = new Promise(r => { release = r })
  globalThis.Office.context.document.url = 'file:///cross-project-switch.docx'
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/api/ai/history')) return json([])
    if (url.endsWith('/api/agent/conversations')) return json({ conversationId: 'cross-project-switch-' + (++issued) })
    if (url.includes('/api/agent/connect/')) { connection = stream(); return { ok: true, status: 200, body: { getReader: () => connection.reader } } }
    if (url.endsWith('/api/agent/office/result')) {
      const body = JSON.parse(options.body); replies.push({ url, body })
      if (body.requestId === 'cross-first') await gate
      return json({})
    }
    return json([])
  }
  try {
    await activateSession({ settings, projectId: 'cross-old-project' }); await send('Synthetic')
    const old = connection, origin = { docName: 'Reference.docx', conversationId: 'origin-old', paneId: 'origin' }
    old.push('client_action', { tool: 'office_command', requestId: 'cross-first', command: 'get_text', args: {}, origin })
    await until(() => replies.length === 1)
    assert.equal(replies[0].body.ok, true)
    old.push('client_action', { tool: 'office_command', requestId: 'cross-second', command: 'get_text', args: {}, origin })
    await new Promise(r => setTimeout(r, 15))
    await activateSession({ settings: { ...settings, serverUrl: 'https://new-cross-account.example', token: 'new-cross-token' }, projectId: 'cross-new-project' })
    release(); await until(() => replies.length === 2)
    assert.equal(replies[1].body.ok, false, 'queued cross-document requests must not execute in a replacement session')
    assert.ok(replies.every(reply => reply.url.startsWith(settings.serverUrl)), 'cross-document receipts retain their original account')
  } finally { release(); await stop(); globalThis.fetch = originalFetch }
})

test('cross-document write rechecks session after awaiting the before-state capture', async () => {
  const originalFetch = globalThis.fetch, originalExcel = globalThis.Excel, oldHost = globalThis.Office.context.host, oldTypes = globalThis.Office.HostType
  let connection, release, captureWaiting = false, writes = 0, syncCount = 0
  const replies = [], gate = new Promise(r => { release = r })
  globalThis.Office.context.document.url = 'file:///capture-switch.xlsx'
  const range = { load() {}, rowCount: 1, columnCount: 1, rowIndex: 0, columnIndex: 0, address: 'Sheet1!A1', formulas: [['before']], set values(v) { writes++ } }
  const sheet = { name: 'Sheet1', load() {}, getRange: () => range }
  globalThis.Excel = { run: cb => cb({ workbook: { worksheets: { getActiveWorksheet: () => sheet, getItem: () => sheet } }, sync: async () => { if (++syncCount === 1) { captureWaiting = true; await gate } } }) }
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/api/ai/history')) return json([])
    if (url.endsWith('/api/agent/conversations')) return json({ conversationId: 'capture-switch-' + Math.random() })
    if (url.includes('/api/agent/connect/')) { connection = stream(); return { ok: true, status: 200, body: { getReader: () => connection.reader } } }
    if (url.endsWith('/api/agent/office/result')) { replies.push({ url, body: JSON.parse(options.body) }); return json({}) }
    return json([])
  }
  try {
    await activateSession({ settings, projectId: 'capture-old' }); await send('Synthetic')
    globalThis.Office.HostType = { Word: 'Word', Excel: 'Excel', PowerPoint: 'PowerPoint' }; globalThis.Office.context.host = 'Excel'
    connection.push('client_action', { tool: 'office_command', requestId: 'capturing', command: 'excel_set_values', args: { rangeAddress: 'A1', values: [['new']], inheritFormat: false }, origin: { docName: 'Reference.xlsx', conversationId: 'origin-old', paneId: 'origin' } })
    await until(() => captureWaiting)
    await activateSession({ settings: { ...settings, serverUrl: 'https://capture-new.example' }, projectId: 'capture-new' })
    release(); await until(() => replies.length === 1)
    assert.equal(writes, 0, 'switching while capturing must not write into the replacement session')
    assert.equal(replies[0].body.ok, false)
    assert.ok(replies[0].url.startsWith(settings.serverUrl))
  } finally { release(); await stop(); globalThis.fetch = originalFetch; globalThis.Excel = originalExcel; globalThis.Office.context.host = oldHost; globalThis.Office.HostType = oldTypes }
})
