// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { JSDOM } = require('../../frontend/node_modules/jsdom')
const input = require('../../frontend/src/composables/nativeDocumentInput.js')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
let factory, mask
async function surfaceHarness(options = {}) {
  if (!factory) {
    const source = (await fs.readFile(path.join(__dirname, '../../frontend/src/composables/nativeOfficeSurface.js'), 'utf8')).replace("import './nativeDocumentInput.js'", '')
      .replace(/from '(\.\.?\/[^']+)'/g, (_, specifier) => `from '${pathToFileURL(path.resolve(__dirname, '../../frontend/src/composables', specifier)).href}'`)
    const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
    factory = module.createNativeOfficeSurface; mask = module.transparentPageExterior
  }
  globalThis.AWDDocumentInput = input
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } }
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ putImageData() {} })
  const calls = [], events = [], resultWaiters = new Map()
  let event, off = false, closed = false, nextEpoch = 0, pendingText, pendingPaint
  const api = {
    async nativeRequest(id, action, params) {
      calls.push({ id, action, params })
      const custom = await options.nativeRequest?.(action, params)
      if (custom !== undefined) return custom
      if (action === 'load_document') {
        const documentEpoch = ++nextEpoch
        return { success: true, nativeModel: { documentEpoch, viewId: 0, widthTwips: 12000, heightTwips: 18000, readOnly: false, view: {zoom:100,ruler:false}, layout: {unit:'twip',pages:[{x:200,y:200,width:11600,height:17600}]} },
          callbacks: [{ type: 'callback', callbackType: 1, payload: '100,100,0,50', documentEpoch, viewId: 0 }] }
      }
      if (action === 'native_paint') { const gate = pendingPaint; pendingPaint = null; if (gate) await gate.promise; return { ...params, heightTwips: Math.round(params.widthTwips * params.height / params.width), width: 1, height: 1, pixels: new Uint8Array(4) } }
      if (action === 'native_input') {
        if (params.action === 'input_text' && pendingText) await pendingText.promise
        return { applied: true, documentEpoch: params.documentEpoch, viewId: 0, lastInputSeq: params.params.inputSeq }
      }
      if (action === 'set_zoom') return {success:true,nativeView:{zoom:params.value,ruler:false}}
      if (action === 'set_view_options') return {success:true,nativeView:{zoom:100,ruler:params.ruler,verticalRuler:params.ruler},nativeLayout:{unit:'twip',pages:[{x:200,y:200,width:11600,height:17600}]}}
      if (action === 'export_document') return { success: true, bytes: new Uint8Array([1, 2, 3]) }
      if (['get_document_text', 'get_paragraph', 'get_outline', 'find_text_locations', 'get_bookmark_context', 'check_link_anchors', 'get_selection_hyperlink'].includes(action)) return { success: true }
      if (action === 'get_cursor_context') return { success: true, before: '前文', after: '后文', paragraph: '前文后文', selectedText: '', hasSelection: false }
      if (action === 'get_hyperlink_at_cursor') return { success: true, url: 'https://example.com/reference', target: null }
      return { success: false, code: 'UNSUPPORTED_NATIVE_ACTION', message: action }
    },
    onNativeEvent(id, cb) { event = cb; return () => { off = true } },
    async nativeClose() { closed = true }
  }
  const surface = factory({ api, info: { sessionId: 'one', initialBlank: options.initialBlank }, document: dom.window.document })
  dom.window.document.querySelector('main').append(surface.element)
  Object.defineProperties(surface.element, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  surface.transport.subscribe(message => { events.push(message); if (message.type === 'result') resultWaiters.get(message.reqId)?.(message.result) })
  let seq = 0
  function execute(action, params) {
    const reqId = ++seq
    return new Promise(resolve => { resultWaiters.set(reqId, resolve); surface.transport.send({ type: 'exec', reqId, action, params }) })
  }
  return { surface, dom, calls, events, execute, event: value => event(value),
    deferText: () => (pendingText = deferred()), deferPaint: () => (pendingPaint = deferred()), isClosed: () => closed && off,
    async close() { await surface.dispose(); dom.window.close() } }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
test('review layout follows the visible native tile and its overlay retires with the document', async () => {
  const h = await surfaceHarness({ nativeRequest: action => action === 'get_review_layout'
    ? { success: true, available: true, items: [], pages: [], mode: 'all', pending: 0, unread: 0 } : undefined })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    assert.equal(h.dom.window.document.querySelectorAll('.awd-review-balloons').length, 1)
    h.surface.element.scrollTop = 200
    const result = await h.execute('get_review_layout')
    assert.equal(result.view.top, 3000)
    assert.equal(result.view.bottom - result.view.top, 9000)
    assert.deepEqual(result.view.viewport, { x: 0, y: 0, width: 800, height: 600 })
    await h.execute('load_document', { bytes: [2], name: 'b.docx' })
    assert.equal(h.dom.window.document.querySelectorAll('.awd-review-balloons').length, 1)
    await h.surface.dispose()
    assert.equal(h.dom.window.document.querySelectorAll('.awd-review-balloons').length, 0)
  } finally { await h.close() }
})
test('page width changing while a paint is queued redraws before load completes', async () => {
  let paints = 0
  const h = await surfaceHarness({ nativeRequest: (action, params) => {
    if (action === 'native_paint' && ++paints === 1)
      return { stale: true, documentEpoch: params.documentEpoch, widthTwips: 11600, heightTwips: 18000 }
  } })
  try {
    assert.equal((await h.execute('load_document', { bytes: [1], name: 'a.docx' })).success, true)
    const attempts = h.calls.filter(call => call.action === 'native_paint')
    assert.equal(attempts.length, 2)
    assert.deepEqual(attempts.map(call => call.params.documentWidthTwips), [12000, 11600])
    assert.equal(attempts[1].params.widthTwips, 11600)
    assert.equal(h.events.some(event => event.type === 'engine-failed'), false)
    assert.equal(h.surface.element.querySelector('canvas').width, 1)
  } finally { await h.close() }
})
const settleClick = () => new Promise(resolve => setTimeout(resolve, 200))
function clickCanvas(h, modifiers = {}) {
  const canvas = h.surface.element.querySelector('canvas')
  for (const type of ['mousedown', 'mouseup']) canvas.dispatchEvent(new h.dom.window.MouseEvent(type,
    { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100, ...modifiers }))
}
test('cursor context is opt-in, throttled, and disabled subscription drops late results', async () => {
  const held = deferred()
  const h = await surfaceHarness({ nativeRequest: action => action === 'get_cursor_context' ? held.promise : undefined })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    h.event({ type: 'selection', documentEpoch: 1 }); await tick()
    assert.equal(h.calls.filter(c => c.action === 'get_cursor_context').length, 0)
    h.surface.transport.send({ type: 'insight-sub', enabled: true })
    h.event({ type: 'selection', documentEpoch: 1 }); await tick(); await tick()
    assert.equal(h.calls.filter(c => c.action === 'get_cursor_context').length, 1)
    for (let i = 0; i < 20; i++) h.event({ type: 'selection', documentEpoch: 1 })
    await tick(); assert.equal(h.calls.filter(c => c.action === 'get_cursor_context').length, 1)
    h.surface.transport.send({ type: 'insight-sub', enabled: false })
    held.resolve({ success: true, before: '旧上下文', after: '' }); await tick(); await tick()
    assert.equal(h.events.filter(e => e.type === 'cursor-context').length, 0)
  } finally { held.resolve({ success: true }); await h.close() }
})
test('modified click waits for actual mouse input and opens one existing host preview', async () => {
  const held = deferred()
  const h = await surfaceHarness({ nativeRequest: async (action, params) => {
    if (action === 'native_input' && params.action === 'input_mouse') await held.promise
  } })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    h.surface.element.getBoundingClientRect = () => ({ left: 40, top: 25 })
    clickCanvas(h, { metaKey: true }); await settleClick()
    assert.equal(h.calls.filter(c => c.action === 'get_hyperlink_at_cursor').length, 0)
    held.resolve(); await settleClick()
    const links = h.events.filter(e => e.type === 'open-url')
    assert.equal(links.length, 1); assert.equal(links[0].url, 'https://example.com/reference')
    assert.equal(links[0].meta.metaKey, true)
    assert.equal(links[0].meta.clientX, 60); assert.equal(links[0].meta.clientY, 75)
    assert.ok(h.calls.filter(c => c.action === 'native_input' && c.params.action === 'input_mouse').every(c => c.params.params.modifier === 0))
    clickCanvas(h); await settleClick(); assert.equal(h.events.filter(e => e.type === 'open-url').length, 1)
  } finally { held.resolve(); await h.close() }
})
test('retarget discards pending hyperlink and cursor context from the old model', async () => {
  const held = deferred(), loading = deferred()
  const h = await surfaceHarness({ nativeRequest: async (action, params) => {
    if (['get_hyperlink_at_cursor', 'get_cursor_context'].includes(action)) return held.promise
    if (action === 'load_document' && params.name === 'b.docx') await loading.promise
  } })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    h.surface.transport.send({ type: 'insight-sub', enabled: true })
    clickCanvas(h, { ctrlKey: true }); await settleClick()
    assert.ok(h.calls.some(c => c.action === 'get_hyperlink_at_cursor'))
    const retarget = h.execute('load_document', { bytes: [2], name: 'b.docx' }); await tick(); await tick()
    held.resolve({ success: true, url: '#old-document', before: '旧文档' }); await settleClick()
    assert.equal(h.events.filter(e => ['open-url', 'cursor-context'].includes(e.type)).length, 0)
    h.surface.transport.send({ type: 'insight-sub', enabled: false }); loading.resolve(); await retarget
  } finally { held.resolve({ success: true }); loading.resolve(); await h.close() }
})
test('latest explicit context click is retained while a background read is in flight', async () => {
  const held = deferred(); let contextCount = 0
  const h = await surfaceHarness({ nativeRequest: action => {
    if (action === 'get_hyperlink_at_cursor') return { success: true, url: '' }
    if (action === 'get_cursor_context' && ++contextCount === 1) return held.promise
  } })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    h.surface.transport.send({ type: 'insight-sub', enabled: true })
    h.event({ type: 'selection', documentEpoch: 1 }); await tick(); await tick()
    clickCanvas(h, { ctrlKey: true }); await settleClick()
    assert.equal(h.calls.filter(c => c.action === 'get_cursor_context').length, 1)
    held.resolve({ success: true, before: '过时邻域' }); await settleClick()
    assert.equal(h.calls.filter(c => c.action === 'get_cursor_context').length, 2)
    const contexts = h.events.filter(e => e.type === 'cursor-context')
    assert.equal(contexts.length, 1); assert.equal(contexts[0].payload.meta.ctrlKey, true)
    assert.equal(contexts[0].payload.before, '前文')
  } finally { held.resolve({ success: true }); await h.close() }
})
test('relay readiness is explicit and load paints before returning; unsupported does not fall back', async () => {
  const h = await surfaceHarness()
  try {
    h.surface.start(); await tick(); assert.equal(h.events[0].type, 'ready'); assert.equal(h.events[0].engine, 'lok')
    const loaded = await h.execute('load_document', { bytes: new Uint8Array([1]), name: 'a.docx' })
    assert.equal(loaded.success, true)
    assert.ok(h.calls.some(call => call.action === 'native_paint'))
    assert.equal(h.calls.at(-1).params.action, 'set_viewport')
    const unsupported = await h.execute('insert_image', {})
    assert.equal(unsupported.code, 'UNSUPPORTED_NATIVE_ACTION')
  } finally { await h.close() }
  assert.equal(h.isClosed(), true)
})
test('save refuses active composition; confirmed text and barrier precede export bytes', async () => {
  const h = await surfaceHarness()
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    const input = h.surface.element.querySelector('input'), w = h.dom.window
    input.dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true }))
    assert.equal((await h.execute('export_document', {})).code, 'COMPOSITION_ACTIVE')
    assert.equal(h.calls.filter(call => call.action === 'export_document').length, 0)
    const held = h.deferText()
    input.dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '正式输入' }))
    let saved = false
    const save = h.execute('export_document', {}).then(result => { saved = true; return result })
    await tick(); assert.equal(saved, false)
    held.resolve(); const result = await save
    assert.deepEqual([...result.bytes], [1, 2, 3])
    const actions = h.calls.map(call => call.action === 'native_input' ? call.params.action : call.action)
    assert.ok(actions.indexOf('input_text') < actions.indexOf('input_barrier'))
    assert.ok(actions.indexOf('input_barrier') < actions.indexOf('export_document'))
  } finally { await h.close() }
})
test('old document events cannot dirty a retargeted instance, and close unsubscribes', async () => {
  const h = await surfaceHarness()
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    await h.execute('load_document', { bytes: [2], name: 'b.docx' })
    h.event({ type: 'modified', documentEpoch: 1 })
    assert.equal(h.events.filter(event => event.type === 'modified').length, 0)
    h.event({ type: 'modified', documentEpoch: 2 })
    assert.equal(h.events.filter(event => event.type === 'modified').length, 1)
  } finally { await h.close() }
  h.event({ type: 'modified', documentEpoch: 2 })
  assert.equal(h.events.filter(event => event.type === 'modified').length, 1)
})

test('document reads leave an active composition intact while selection changes remain blocked', async () => {
  const h = await surfaceHarness()
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    const entry = h.surface.element.querySelector('input'), w = h.dom.window
    entry.dispatchEvent(new w.CompositionEvent('compositionstart', { bubbles: true }))
    const before = h.calls.length
    for (const action of ['get_document_text', 'get_paragraph', 'get_outline', 'find_text_locations', 'get_cursor_context',
      'get_hyperlink_at_cursor', 'get_bookmark_context', 'check_link_anchors', 'get_selection_hyperlink']) {
      assert.equal((await h.execute(action, {})).success, true, action)
    }
    assert.equal(h.calls.slice(before).filter(call => ['native_input', 'native_paint'].includes(call.action)).length, 0)
    assert.equal((await h.execute('set_selection', {})).code, 'COMPOSITION_ACTIVE')
    assert.equal((await h.execute('goto_bookmark', { name: 'EVID_TEST' })).code, 'COMPOSITION_ACTIVE')
    assert.equal((await h.execute('collapse_selection', {})).code, 'COMPOSITION_ACTIVE')
    assert.equal(h.calls.filter(call => call.action === 'set_selection').length, 0)
    entry.dispatchEvent(new w.CompositionEvent('compositionend', { bubbles: true, data: '读取期间输入' }))
    await h.execute('export_document', {})
    assert.deepEqual(h.calls.filter(call => call.action === 'native_input' && call.params.action === 'input_text').map(call => call.params.params.text), ['读取期间输入'])
  } finally { await h.close() }
})

test('retarget waits for its own model paint when an old frame is in flight', async () => {
  const h = await surfaceHarness()
  let gate
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    gate = h.deferPaint()
    h.event({ type: 'callback', callbackType: 0, payload: '', documentEpoch: 1, viewId: 0 })
    await new Promise(resolve => setTimeout(resolve, 25))
    let done = false
    const next = h.execute('load_document', { bytes: [2], name: 'b.docx' }).then(result => { done = true; return result })
    await tick()
    const completedBeforeNewPaint = done
    gate.resolve(); await next
    assert.equal(completedBeforeNewPaint, false)
    assert.equal(h.calls.filter(call => call.action === 'native_paint').at(-1).params.documentEpoch, 2)
  } finally { gate?.resolve(); await h.close() }
})

test('spare becomes ready only after a real blank load and adopts without replacing the surface', async () => {
  const h = await surfaceHarness({ initialBlank: true })
  try {
    const element = h.surface.element
    h.surface.start()
    await tick(); await tick()
    assert.equal(h.calls[0].action, 'load_document')
    assert.equal(h.calls[0].params.bytes.length, 0)
    assert.equal(h.events.find(event => event.type === 'ready').engine, 'lok')
    assert.ok(h.calls.some(call => call.action === 'native_paint'))
    const loaded = await h.execute('load_document', { bytes: [2], name: 'adopted.docx' })
    assert.equal(loaded.nativeModel.documentEpoch, 2)
    assert.equal(h.surface.element, element)
  } finally { await h.close() }
})


test('actual zoom changes native twip viewport and horizontal scrolling without resizing document pixels', async () => {
  const h = await surfaceHarness()
  try {
    await h.execute('load_document', {bytes:[1],name:'zoom.docx'})
    assert.equal(h.calls.filter(c=>c.action==='native_paint').at(-1).params.widthTwips, 12000)
    await h.execute('set_zoom', {value:200})
    const paint = h.calls.filter(c=>c.action==='native_paint').at(-1)
    assert.equal(paint.params.widthTwips, 6000)
    assert.equal(h.surface.element.querySelector('canvas').parentElement.style.width, '1600px')
    h.surface.element.scrollLeft = 400
    h.surface.element.dispatchEvent(new h.dom.window.Event('scroll'))
    await new Promise(r=>setTimeout(r,30))
    assert.equal(h.calls.filter(c=>c.action==='native_paint').at(-1).params.xTwips, 3000)
    const inputViewport=h.calls.filter(c=>c.action==='native_input'&&c.params.action==='set_viewport').at(-1)
    assert.equal(inputViewport.params.params.xTwips,3000)
  } finally {await h.close()}
})

test('ruler uses native page origin and mm scale and follows the actual preference', async () => {
  const h=await surfaceHarness()
  try {
    await h.execute('load_document',{bytes:[1],name:'ruler.docx'})
    await h.execute('set_view_options',{ruler:true})
    const ruler=h.surface.element.querySelector('[data-native-ruler="horizontal"]')
    assert.equal(ruler.hidden,false)
    assert.ok(Math.abs(parseFloat(ruler.querySelector('[data-mm="10"]').style.left)-(200+1440/2.54)/15)<.01)
    await h.execute('set_view_options',{ruler:false})
    assert.equal(ruler.hidden,true)
  } finally {await h.close()}
})

test('page exterior transparency uses geometry and preserves every byte of inside black and white pixels',async()=>{
  const h=await surfaceHarness()
  try {
    const pixels=Uint8Array.from([0,0,0,255, 0,0,0,255, 255,255,255,255, 12,34,56,255])
    const tile={width:4,height:1,xTwips:0,yTwips:0,widthTwips:40,heightTwips:10,pixels}
    const result=mask(tile,[{x:10,y:0,width:20,height:10}])
    assert.deepEqual([...result],[0,0,0,0, 0,0,0,255, 255,255,255,255, 12,34,56,0])
    assert.equal(pixels[3],255)
    assert.throws(()=>mask(tile,[]),/geometry missing/)
    assert.deepEqual([...mask({...tile,xTwips:10,widthTwips:40},[{x:10,y:0,width:20,height:10}]).slice(0,8)], [...pixels.slice(0,8)])
  } finally {await h.close()}
})
