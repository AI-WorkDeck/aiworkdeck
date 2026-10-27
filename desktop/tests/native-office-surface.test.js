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
  let resizeCallback
  globalThis.ResizeObserver = class { constructor(callback) { resizeCallback = callback } observe() {} disconnect() {} }
  globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } }
  const dom = options.dom || new JSDOM('<main></main>', { pretendToBeVisual: true })
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
  const surface = factory({ api, info: { sessionId: options.sessionId || 'one', initialBlank: options.initialBlank }, document: dom.window.document })
  dom.window.document.querySelector('main').append(surface.element)
  Object.defineProperties(surface.element, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } })
  surface.transport.subscribe(message => { events.push(message); if (message.type === 'result') resultWaiters.get(message.reqId)?.(message.result) })
  let seq = 0
  function execute(action, params) {
    const reqId = ++seq
    return new Promise(resolve => { resultWaiters.set(reqId, resolve); surface.transport.send({ type: 'exec', reqId, action, params }) })
  }
  return { surface, dom, calls, events, execute, event: value => event(value),
    resize: () => resizeCallback(),
    deferText: () => (pendingText = deferred()), deferPaint: () => (pendingPaint = deferred()), isClosed: () => closed && off,
    async close() { await surface.dispose(); if (!options.dom) dom.window.close() } }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const writingConfig = session => ({ __lo: 'lo-relay', type: 'writing-config', config: { session, writable: true, enabled: false, learning: false, hints: false,
  items: [{ id: 'local-company', text: '北京测试有限公司', kind: 'COMPANY', source: 'project' }] } })
const key = (h, name, options = {}) => h.surface.element.querySelector('input').dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }))
test('surface enables the real ruler asynchronously and retires its handles on a new document', async () => {
  let token = 0
  const h = await surfaceHarness({ nativeRequest: action => action === 'get_ruler_state' ? { success: true, available: true, contextToken: 'ruler-' + ++token,
    pageIndex: 0, pageWidth: 11600, pageHeight: 17600, leftMargin: 1000, rightMargin: 1000, topMargin: 1000, bottomMargin: 1000,
    leftIndent: 100, rightIndent: 100, firstLineIndent: 200 } : action === 'set_ruler_state' ? { success: true } : undefined })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    assert.equal(h.calls.some(call => call.action === 'get_ruler_state'), false)
    await h.execute('set_view_options', { ruler: true }); await new Promise(resolve => setTimeout(resolve, 120))
    const handle = h.surface.element.querySelector('[data-ruler-handle="leftIndent"]')
    assert.ok(handle)
    handle.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await tick(); await tick()
    const write = h.calls.find(call => call.action === 'set_ruler_state')
    assert.deepEqual(write.params.patch, { leftIndent: 157 }); assert.equal(write.params.documentEpoch, 1)
    await h.execute('load_document', { bytes: [2], name: 'b.docx' })
    assert.equal(h.surface.element.querySelectorAll('[data-ruler-handle]').length, 0)
    assert.equal(h.surface.element.querySelectorAll('[data-native-ruler-notice]').length, 1)
  } finally { await h.close() }
})
test('two native document guests isolate menus, candidates, semantic composition, and destruction', async () => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const nativeRequest = action => action === 'get_completion_context'
    ? { success: true, available: true, token: 'cursor-one', before: '北京测试', after: '', paragraph: '北京测试', hasSelection: false }
    : action === 'accept_completion' ? { success: true, token: 'cursor-two' } : undefined
  const a = await surfaceHarness({ dom, sessionId: 'a', nativeRequest }), b = await surfaceHarness({ dom, sessionId: 'b', nativeRequest })
  try {
    await a.execute('load_document', { bytes: [1], name: 'a.docx' }); await b.execute('load_document', { bytes: [2], name: 'b.docx' })
    a.surface.transport.send(writingConfig('session-a')); b.surface.transport.send(writingConfig('session-b'))
    a.surface.transport.send({ __lo: 'lo-relay', type: 'writing-assistance-panel', open: true })
    assert.equal(a.surface.element.querySelector('.awd-wa-panel').hidden, false)
    assert.equal(b.surface.element.querySelector('.awd-wa-panel').hidden, true)
    b.surface.transport.send({ __lo: 'lo-relay', type: 'semantic-writing-panel', open: true })
    assert.equal(a.surface.element.querySelector('.awd-semantic-sheet').hidden, true)
    assert.equal(b.surface.element.querySelector('.awd-semantic-sheet').hidden, false)
    const settings = b.events.find(event => event.type === 'writing-request' && event.action === 'semantic-settings')
    b.surface.transport.send({ __lo: 'lo-relay', type: 'writing-response', session: settings.session, id: settings.id, result: { files: [], stance: 'B 专属项目立场' } })
    await tick()
    assert.equal(a.surface.element.textContent.includes('B 专属项目立场'), false)
    assert.equal(b.surface.element.querySelector('[data-semantic-stance]').value, 'B 专属项目立场')
    const inputA = a.surface.element.querySelector('input'), inputB = b.surface.element.querySelector('input')
    inputA.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    const generateB = [...b.surface.element.querySelectorAll('button')].find(button => button.textContent === '续写一句')
    generateB.click(); await tick()
    assert.ok(b.events.some(event => event.type === 'writing-request' && event.action === 'semantic-generate' && event.session === 'session-b'))
    key(a, ' ', { ctrlKey: true }); await tick()
    assert.equal(a.calls.some(call => call.action === 'get_completion_context'), false, 'IME owns the composing document keyboard')
    inputA.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '' }))
    key(a, ' ', { ctrlKey: true }); await new Promise(resolve => setTimeout(resolve, 210))
    assert.equal(inputA.getAttribute('aria-expanded'), 'true')
    assert.notEqual(inputB.getAttribute('aria-expanded'), 'true')
    assert.equal(b.calls.some(call => call.action === 'get_completion_context'), false)
    key(a, 'Tab'); await tick(); await tick()
    assert.ok(a.calls.some(call => call.action === 'accept_completion'))
    assert.equal(a.calls.some(call => call.action === 'native_input' && call.params.action === 'input_key' && call.params.params.keyCode === 1282), false)
    // Partial config updates retain the instance session and local permission.
    a.surface.transport.send({ __lo: 'lo-relay', type: 'writing-config', config: { enabled: true } })
    inputA.focus(); inputA.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: '这是只属于甲文档的二十个以上字符的确定性合成输入。' }))
    await new Promise(resolve => setTimeout(resolve, 1900))
    const automatic = a.events.find(event => event.type === 'writing-request' && event.action === 'semantic-auto-generate')
    assert.ok(automatic, 'another document semantic sheet cannot suppress this document automatic suggestions')
    assert.equal(automatic.session, 'session-a')
    a.surface.transport.send({ __lo: 'lo-relay', type: 'writing-response', session: automatic.session, id: automatic.id, result: { view: { status: 'READY', advice: [{ text: '只属于甲文档的合成建议' }] } } })
    await tick(); assert.equal(inputA.getAttribute('aria-expanded'), 'true'); assert.notEqual(inputB.getAttribute('aria-expanded'), 'true')
    assert.equal(b.surface.element.textContent.includes('只属于甲文档的合成建议'), false)
    a.surface.transport.send({ __lo: 'lo-relay', type: 'inline-review-state', session: 'review-a', status: 'stale', findings: [], ai: false })
    b.surface.transport.send({ __lo: 'lo-relay', type: 'inline-review-state', session: 'review-b', status: 'stale', findings: [], ai: false })
    a.surface.element.querySelector('.awd-ir-open').click(); await tick()
    assert.ok(a.events.some(event => event.type === 'inline-review-request' && event.session === 'review-a'))
    assert.equal(b.events.some(event => event.type === 'inline-review-request'), false)
    const pending = b.events.find(event => event.type === 'writing-request' && event.action === 'semantic-generate')
    await b.execute('load_document', { bytes: [3], name: 'c.docx' })
    b.surface.transport.send({ __lo: 'lo-relay', type: 'writing-response', session: pending.session, id: pending.id, result: { view: { status: 'READY', advice: [{ text: '旧文档建议不得出现' }] } } })
    await tick(); assert.equal(b.surface.element.textContent.includes('旧文档建议不得出现'), false)
    await a.close()
    assert.equal(dom.window.document.querySelectorAll('[data-native-assistance]').length, 1)
    b.surface.transport.send(writingConfig('session-c')); b.surface.transport.send({ __lo: 'lo-relay', type: 'writing-assistance-panel', open: true })
    assert.equal(b.surface.element.querySelector('.awd-wa-panel').hidden, false)
  } finally { await a.close(); await b.close(); dom.window.close() }
})
test('native writing availability waits for permission acknowledgement and overlays stay in editor bounds', async () => {
  let gate
  const h = await surfaceHarness({ nativeRequest: (action, params) => action === 'set_read_only'
    ? (async () => { if (gate) await gate.promise; return { success: true, ...params, lastInputSeq: 0 } })() : undefined })
  try {
    h.surface.element.getBoundingClientRect = () => ({ left: 200, top: 100, right: 800, bottom: 600, width: 600, height: 500 })
    await h.execute('load_document', { bytes: [1], name: 'a.docx' }); h.surface.transport.send(writingConfig('session-a'))
    h.surface.transport.send({ __lo: 'lo-relay', type: 'writing-assistance-panel', open: true })
    const panel = h.surface.element.querySelector('.awd-wa-panel')
    assert.ok(parseFloat(panel.style.left) >= 208); assert.ok(parseFloat(panel.style.top) >= 108)
    assert.equal(panel.style.maxWidth, '576px')
    h.surface.transport.send({ __lo: 'lo-relay', type: 'semantic-writing-panel', open: true })
    assert.equal(h.surface.element.querySelector('.awd-semantic').style.top, '114px')
    assert.equal(h.surface.element.querySelector('.awd-semantic-sheet').style.maxHeight, '472px')
    assert.equal(h.surface.element.querySelector('[data-native-assistance]').style.clipPath, 'inset(100px 224px 168px 200px)')
    gate = deferred(); const revoke = h.surface.setReadOnly(true)
    h.surface.transport.send(writingConfig('session-a'))
    assert.equal(h.events.filter(event => event.type === 'writing-assistance-state').at(-1).available, false)
    assert.equal(h.events.filter(event => event.type === 'semantic-writing-state').at(-1).available, false)
    gate.resolve(); await revoke
    gate = deferred(); const grant = h.surface.setReadOnly(false)
    h.surface.transport.send(writingConfig('session-a'))
    assert.equal(h.events.filter(event => event.type === 'writing-assistance-state').at(-1).available, false)
    gate.resolve(); await grant
    assert.equal(h.events.filter(event => event.type === 'writing-assistance-state').at(-1).available, true)
  } finally { gate?.resolve(); await h.close() }
})
test('native writing and review guests receive host state and report their actual panel state', async () => {
  const h = await surfaceHarness()
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    h.surface.transport.send({ __lo: 'lo-relay', type: 'writing-config', config: { session: 'writing-one', writable: true, enabled: false, items: [] } })
    assert.ok(h.events.some(event => event.type === 'writing-assistance-state' && event.available && !event.open))
    assert.ok(h.events.some(event => event.type === 'semantic-writing-state' && event.available && !event.open))
    h.surface.transport.send({ __lo: 'lo-relay', type: 'writing-assistance-panel', open: true })
    assert.equal(h.surface.element.querySelector('.awd-wa-panel').hidden, false)
    assert.ok(h.events.some(event => event.type === 'writing-assistance-state' && event.open))
    h.surface.transport.send({ __lo: 'lo-relay', type: 'inline-review-state', session: 'review-one', status: 'stale', findings: [], ai: false })
    h.surface.element.querySelector('.awd-ir-open').click(); await tick()
    assert.ok(h.events.some(event => event.type === 'inline-review-request' && event.session === 'review-one' && event.action === 'open-panel'))
    await h.execute('load_document', { bytes: [2], name: 'b.docx' })
    assert.equal(h.surface.element.querySelectorAll('.awd-writing-assistance').length, 1)
    assert.equal(h.surface.element.querySelectorAll('.awd-inline-review').length, 1)
    assert.equal(h.surface.element.querySelector('.awd-wa-panel').hidden, true)
    await h.surface.dispose()
    assert.equal(h.dom.window.document.querySelectorAll('.awd-writing-assistance, .awd-inline-review, .awd-semantic').length, 0)
  } finally { await h.close() }
})
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
    assert.equal((await h.execute('get_document_text', { __agent: true })).code, 'COMPOSITION_ACTIVE')
    assert.equal(h.calls.filter(call => call.action === 'get_document_text').length, 1, 'final-text read must not commit or bypass active composition')
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


test('assistance context waits for all confirmed input and retires a delayed old-model read', async () => {
  const h = await surfaceHarness({ nativeRequest: action => action === 'get_completion_context'
    ? { success: true, available: true, token: 'fresh', before: '北京测试', hasSelection: false } : undefined })
  let held
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' }); h.surface.transport.send(writingConfig('s'))
    const input = h.surface.element.querySelector('input'); held = h.deferText()
    for (const data of ['甲', '乙']) input.dispatchEvent(new h.dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data }))
    await tick(); key(h, ' ', { ctrlKey: true }); await tick()
    assert.equal(h.calls.some(call => call.action === 'get_completion_context'), false, 'context must not overtake queued input')
    held.resolve(); await tick(); await tick(); await tick()
    const actions = h.calls.map(call => call.action === 'native_input' ? call.params.action + ':' + (call.params.params.text || '') : call.action)
    assert.ok(actions.indexOf('get_completion_context') > actions.indexOf('input_text:乙'))
    held = h.deferText(); input.dispatchEvent(new h.dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: '丙' }))
    key(h, ' ', { ctrlKey: true }); const before = h.calls.filter(c => c.action === 'get_completion_context').length
    const retarget = h.execute('load_document', { bytes: [2], name: 'b.docx' }); held.resolve(); await retarget; await tick()
    assert.equal(h.calls.filter(c => c.action === 'get_completion_context' && c.params.documentEpoch === 2).length, 0)
    assert.ok(h.calls.filter(c => c.action === 'get_completion_context').length <= before + 1)
  } finally { held?.resolve(); await h.close() }
})

test('completion-owned notifications preserve related details only with a fresh uncontested receipt', async () => {
  for (const variant of ['fresh', 'no-token', 'external', 'external-blur', 'permission', 'retarget']) {
    let h, accepted = 0
    h = await surfaceHarness({ nativeRequest: async (action, params) => {
      if (action === 'get_completion_context') return { success: true, available: true, token: 'cursor', before: '北京测试', hasSelection: false }
      if (action === 'accept_completion' || action === 'insert_completion_content') {
        accepted++
        if (variant === 'external-blur') h.surface.element.querySelector('input').dispatchEvent(new h.dom.window.FocusEvent('blur', { relatedTarget: null }))
        h.event({ type: 'modified', documentEpoch: 1 }); h.event({ type: 'selection', documentEpoch: 1 })
        if (variant === 'external') await h.execute('format_selection', { bold: true })
        if (variant === 'permission') await h.surface.setReadOnly(true)
        if (variant === 'retarget') await h.execute('load_document', { bytes: [2], name: 'b.docx' })
        return { success: true, changed: true, revision: accepted, token: variant === 'no-token' ? null : 'fresh-continuation' }
      }
      if (action === 'format_selection') return { success: true }
      if (action === 'set_read_only') return { success: true, ...params, lastInputSeq: 0 }
    } })
    try {
      await h.execute('load_document', { bytes: [1], name: 'a.docx' })
      const entry = h.surface.element.querySelector('input'); let disabled = entry.disabled
      Object.defineProperty(entry, 'disabled', { get: () => disabled, set(value) {
        const changed = value && !disabled; disabled = value
        if (changed) entry.dispatchEvent(new h.dom.window.FocusEvent('blur', { relatedTarget: null }))
      } })
      const config = writingConfig('session'); config.config.hints = true; config.config.items[0].entityId = 1; h.surface.transport.send(config)
      key(h, ' ', { ctrlKey: true }); await tick(); await tick(); key(h, 'Tab'); await tick(); await tick()
      const panel = h.surface.element.querySelector('.awd-wa-panel')
      assert.equal(accepted, 1); assert.equal(panel.hidden, variant !== 'fresh', variant)
      if (variant !== 'fresh') continue
      assert.ok(panel.textContent.includes('查看已有资料'))
      ;[...panel.querySelectorAll('button')].find(b => b.textContent === '查看已有资料').click(); await tick()
      const detail = h.events.find(e => e.type === 'writing-request' && e.action === 'detail')
      h.surface.transport.send({ __lo: 'lo-relay', type: 'writing-response', id: detail.id, session: detail.session, result: { variants: [{ text: '可插入资料', rows: [['列一'], ['资料']] }] } }); await tick()
      const insert = [...panel.querySelectorAll('button')].find(b => b.textContent.includes('插入'))
      assert.ok(insert); insert.click(); await tick(); await tick()
      assert.equal(accepted, 2); assert.equal(panel.hidden, false); assert.ok(panel.textContent.includes('已插入'))
    } finally { await h.close() }
  }
})


test('readback selections do not reschedule inline review or discard completion, but fresh input still does', async () => {
  let h
  h = await surfaceHarness({ nativeRequest: action => {
    if (action === 'get_review_layout') return { success: true, available: false }
    if (action === 'get_review_context' || action === 'get_completion_context') {
      h.event({ type: 'selection', documentEpoch: 1, origin: 'view-read' })
      return { success: true, available: true, revision: 1, token: 'cursor', before: '北京测试', hasSelection: false }
    }
    if (action === 'format_selection') return { success: true }
  } })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' }); h.surface.transport.send(writingConfig('s'))
    h.surface.transport.send({ __lo: 'lo-relay', type: 'inline-review-state', session: 'r', status: 'ready', revision: 1, findings: [], ai: false })
    await new Promise(resolve => setTimeout(resolve, 650))
    assert.equal(h.calls.filter(c => c.action === 'get_review_context').length, 1, 'a read callback cannot schedule the same read forever')
    key(h, ' ', { ctrlKey: true }); await tick(); await tick(); await tick()
    const panel = h.surface.element.querySelector('.awd-wa-panel'); assert.equal(panel.hidden, false, 'own readback must preserve its candidate result')
    key(h, 'ArrowLeft'); await tick(); h.event({ type: 'selection', documentEpoch: 1 }); await new Promise(resolve => setTimeout(resolve, 230))
    assert.equal(panel.hidden, true); assert.equal(h.calls.filter(c => c.action === 'get_review_context').length, 2, 'real input must schedule a fresh context')
    await h.execute('format_selection', { bold: true }); h.event({ type: 'selection', documentEpoch: 1 }); await new Promise(resolve => setTimeout(resolve, 230))
    assert.equal(h.calls.filter(c => c.action === 'get_review_context').length, 3, 'external command must schedule a fresh context')
  } finally { await h.close() }
})

test('readback coalescing preserves genuine pointer IME permission and retarget invalidation', async () => {
  for (const kind of ['pointer', 'ime', 'permission', 'retarget', 'native-selection']) {
    let h; const held = deferred()
    h = await surfaceHarness({ nativeRequest: async (action, params) => {
      if (action === 'get_review_layout') return { success: true, available: false }
      if (action === 'get_completion_context') { await held.promise; h.event({ type: 'selection', documentEpoch: 1, origin: 'view-read' }); return { success: true, available: true, token: 'late', before: '北京测试', hasSelection: false } }
      if (action === 'set_read_only') return { success: true, ...params, lastInputSeq: 0 }
    } })
    try {
      await h.execute('load_document', { bytes: [1], name: 'a.docx' }); h.surface.transport.send(writingConfig('s')); key(h, ' ', { ctrlKey: true }); await tick(); await tick()
      if (kind === 'pointer') h.surface.element.querySelector('canvas').dispatchEvent(new h.dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))
      if (kind === 'native-selection') h.event({ type: 'selection', documentEpoch: 1 })
      if (kind === 'ime') h.surface.element.querySelector('input').dispatchEvent(new h.dom.window.CompositionEvent('compositionstart', { bubbles: true }))
      if (kind === 'permission') await h.surface.setReadOnly(true)
      if (kind === 'retarget') await h.execute('load_document', { bytes: [2], name: 'b.docx' })
      held.resolve(); await tick(); await tick()
      assert.equal(h.surface.element.querySelector('.awd-wa-panel').hidden, true, kind)
    } finally { held.resolve(); await h.close() }
  }
})


test('host semantic capture also waits for queued native input', async () => {
  const h = await surfaceHarness({ nativeRequest: action => action === 'capture_writing_context' ? { success: true, available: true } : undefined })
  let held
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' }); held = h.deferText()
    h.surface.element.querySelector('input').dispatchEvent(new h.dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: '输入' }))
    const captured = h.execute('capture_writing_context'); await tick()
    assert.equal(h.calls.some(c => c.action === 'capture_writing_context'), false)
    held.resolve(); assert.equal((await captured).success, true)
  } finally { held?.resolve(); await h.close() }
})


for (const change of ['fresh', 'retarget', 'permission', 'permission-roundtrip']) {
  test(`generic context results reject stale document or permission: ${change}`, async () => {
    for (const action of ['capture_writing_context', 'get_completion_context', 'get_context_menu_context', 'get_review_context', 'get_ruler_state', 'get_document_text']) {
      const held = deferred(), started = deferred()
      const h = await surfaceHarness({ nativeRequest: async (name, params) => {
        if (name === action) {
          started.resolve(); await held.promise
          return { success: true, available: true, token: 'old-context', documentEpoch: params.documentEpoch }
        }
        if (name === 'set_read_only') return { success: true, ...params, lastInputSeq: 0 }
      } })
      try {
        await h.execute('load_document', { bytes: [1], name: 'a.docx' }); await h.surface.setReadOnly(false)
        const pending = h.execute(action, action === 'get_document_text' ? { __agent: true } : undefined); await started.promise
        if (change === 'retarget') await h.execute('load_document', { bytes: [2], name: 'b.docx' })
        if (change.startsWith('permission')) await h.surface.setReadOnly(true)
        if (change === 'permission-roundtrip') await h.surface.setReadOnly(false)
        held.resolve(); const result = await pending
        assert.equal(result.success, change === 'fresh', `${action}: ${change}`)
        if (change === 'fresh') assert.equal(result.token, 'old-context')
        else {
          assert.equal(result.token, undefined, 'stale context must not reach the host')
          assert.equal(result.message, 'STALE_DOCUMENT_ASSISTANCE')
        }
      } finally { held.resolve(); await h.close() }
    }
  })
}


test('document text waits for queued Escape and the native input barrier acknowledgement', async () => {
  const keyHeld = deferred(), keyStarted = deferred(), barrierHeld = deferred(), barrierStarted = deferred()
  const h = await surfaceHarness({ nativeRequest: async (action, params) => {
    if (action === 'native_input' && params.action === 'input_key' && params.params.eventType === 0) {
      keyStarted.resolve(); await keyHeld.promise
    }
    if (action === 'native_input' && params.action === 'input_barrier') {
      barrierStarted.resolve(); await barrierHeld.promise
    }
    if (action === 'get_document_text') return { success: true, revision: 1, paragraphs: [{ index: 0, text: '确认后的正文' }] }
  } })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    key(h, 'Escape'); await keyStarted.promise
    const pending = h.execute('get_document_text', { __agent: true }); await tick()
    assert.equal(h.calls.some(call => call.action === 'get_document_text'), false, 'body read must wait for queued input')
    keyHeld.resolve(); await barrierStarted.promise; await tick()
    assert.equal(h.calls.some(call => call.action === 'get_document_text'), false, 'body read must wait for the barrier ACK')
    barrierHeld.resolve()
    const result = await pending
    assert.equal(result.success, true); assert.equal(result.paragraphs[0].text, '确认后的正文')
    assert.equal(h.calls.filter(call => call.action === 'get_document_text').length, 1, 'the read is not retried')
  } finally { keyHeld.resolve(); barrierHeld.resolve(); await h.close() }
})

// Save must not wait behind optional reads just to obtain an unchanged tile.
test('save returns ready bytes without waiting for another same-viewport paint', async () => {
  const h = await surfaceHarness()
  let held, pending
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    held = h.deferPaint()
    let finished = false
    pending = h.execute('export_document').then(result => { finished = true; return result })
    await new Promise(resolve => setTimeout(resolve, 35))
    assert.equal(finished, true)
    assert.deepEqual((await pending).bytes, new Uint8Array([1, 2, 3]))
    assert.equal(h.surface.element.querySelector('input').disabled, false)
  } finally { held?.resolve(); await pending; await h.close() }
})

test('save presents new input once and coalesces repeated automatic readback paints', async () => {
  const held = deferred(), started = deferred()
  const h = await surfaceHarness({ nativeRequest: async action => {
    if (action === 'export_document') { started.resolve(); await held.promise }
  } })
  let pending
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    pending = h.execute('export_document'); await started.promise
    const before = h.calls.filter(call => call.action === 'native_paint').length
    for (let i = 0; i < 3; i++) {
      h.event({ type: 'callback', callbackType: 0, payload: 'EMPTY', documentEpoch: 1, viewId: 0 })
      await new Promise(resolve => setTimeout(resolve, 35))
    }
    assert.equal(h.calls.filter(call => call.action === 'native_paint').length - before, 1)
    assert.equal(h.surface.element.querySelector('input').disabled, true)
    held.resolve(); assert.equal((await pending).success, true)
    await new Promise(resolve => setTimeout(resolve, 35))
    assert.equal(h.calls.filter(call => call.action === 'native_paint').length - before, 2, 'latest pending content is repainted after save')
  } finally { held.resolve(); await pending; await h.close() }
})

test('save keeps real scroll and resize paints active', async () => {
  const held = deferred(), started = deferred()
  const h = await surfaceHarness({ nativeRequest: async action => {
    if (action === 'export_document') { started.resolve(); await held.promise }
  } })
  let pending
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    pending = h.execute('export_document'); await started.promise
    h.event({ type: 'callback', callbackType: 0, payload: 'EMPTY', documentEpoch: 1, viewId: 0 })
    await new Promise(resolve => setTimeout(resolve, 35))
    const before = h.calls.filter(call => call.action === 'native_paint').length
    h.surface.element.scrollTop = 200; h.surface.element.dispatchEvent(new h.dom.window.Event('scroll'))
    await new Promise(resolve => setTimeout(resolve, 35))
    Object.defineProperty(h.surface.element, 'clientWidth', { value: 650 }); h.resize()
    await new Promise(resolve => setTimeout(resolve, 35))
    const paints = h.calls.filter(call => call.action === 'native_paint').slice(before)
    assert.equal(paints.length, 2); assert.equal(paints[0].params.yTwips, 3000); assert.equal(paints[1].params.width, 650)
    held.resolve(); assert.equal((await pending).success, true)
  } finally { held.resolve(); await pending; await h.close() }
})

test('save waits for resized pixels and viewport ACK, then rechecks a second resize', async () => {
  const exported = deferred(), started = deferred(), ack = deferred(), ackStarted = deferred()
  let gateAck = false, changedAgain = false, h
  h = await surfaceHarness({ nativeRequest: async (action, params) => {
    if (action === 'export_document') { started.resolve(); await exported.promise }
    if (gateAck && action === 'native_input' && params.action === 'set_viewport') {
      ackStarted.resolve(); await ack.promise
      if (!changedAgain) { changedAgain = true; Object.defineProperty(h.surface.element, 'clientWidth', { value: 600 }); h.resize() }
    }
  } })
  let pending
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    let finished = false
    pending = h.execute('export_document').then(result => { finished = true; return result }); await started.promise
    gateAck = true; Object.defineProperty(h.surface.element, 'clientWidth', { value: 650 }); h.resize()
    exported.resolve(); await ackStarted.promise; await tick()
    assert.equal(finished, false); assert.equal(h.surface.element.querySelector('input').disabled, true)
    ack.resolve(); assert.equal((await pending).success, true)
    assert.equal(h.surface.element.querySelector('canvas').style.width, '600px', 'returning bytes must not reopen input over old-sized pixels')
    const viewport = h.calls.filter(call => call.action === 'native_input' && call.params.action === 'set_viewport').at(-1)
    assert.equal(viewport.params.params.cssWidth, 600)
  } finally { exported.resolve(); ack.resolve(); await pending; await h.close() }
})

for (const change of ['retarget', 'permission', 'permission-roundtrip']) {
  test(`save cannot return old-owner bytes after ${change}`, async () => {
    const held = deferred(), started = deferred()
    const h = await surfaceHarness({ nativeRequest: async (action, params) => {
      if (action === 'export_document') { started.resolve(); await held.promise }
      if (action === 'set_read_only') return { success: true, ...params, lastInputSeq: 0 }
    } })
    let pending
    try {
      await h.execute('load_document', { bytes: [1], name: 'a.docx' }); await h.surface.setReadOnly(false)
      pending = h.execute('export_document'); await started.promise
      if (change === 'retarget') await h.execute('load_document', { bytes: [2], name: 'b.docx' })
      else await h.surface.setReadOnly(true)
      if (change === 'permission-roundtrip') await h.surface.setReadOnly(false)
      held.resolve(); const result = await pending
      assert.equal(result.success, false); assert.equal(result.message, 'STALE_DOCUMENT_EXPORT'); assert.equal(result.bytes, undefined)
      if (change === 'permission') assert.equal(h.surface.element.querySelector('input').readOnly, true)
    } finally { held.resolve(); await pending; await h.close() }
  })
}

test('save required viewport paint failure closes the current input without publishing bytes', async () => {
  let failPaint = false, h
  h = await surfaceHarness({ nativeRequest: action => {
    if (action === 'export_document') { Object.defineProperty(h.surface.element, 'clientWidth', { value: 650 }); failPaint = true }
    if (action === 'native_paint' && failPaint) throw Error('REQUIRED_SAVE_PAINT_FAILURE')
  } })
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    const result = await h.execute('export_document')
    assert.equal(result.success, false); assert.equal(result.bytes, undefined)
    assert.equal(result.message, 'REQUIRED_SAVE_PAINT_FAILURE')
    assert.equal(h.surface.element.querySelector('input'), null, 'failed geometry cannot remain editable')
    assert.equal(h.events.filter(event => event.type === 'engine-failed').length, 1)
    assert.equal((await h.execute('export_document')).success, false)
  } finally { await h.close() }
})

test('save settling during pending retarget neither resumes old input nor queues old-epoch paint', async () => {
  const saveHeld = deferred(), saveStarted = deferred(), loadHeld = deferred(), loadStarted = deferred()
  let loads = 0, loading = false
  const h = await surfaceHarness({ nativeRequest: async (action, params) => {
    if (action === 'export_document') { saveStarted.resolve(); await saveHeld.promise }
    if (action === 'load_document' && ++loads > 1) { loading = true; loadStarted.resolve(); await loadHeld.promise; loading = false }
    if (loading && action === 'native_paint' && params.documentEpoch === 1) throw Error('OLD_EPOCH_PAINT_DURING_LOAD')
  } })
  let saving, retarget
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    const oldInput = h.surface.element.querySelector('input')
    saving = h.execute('export_document'); await saveStarted.promise
    retarget = h.execute('load_document', { bytes: [2], name: 'b.docx' }); await loadStarted.promise
    const before = h.calls.filter(call => call.action === 'native_paint').length
    saveHeld.resolve(); assert.equal((await saving).success, false)
    assert.equal(oldInput.disabled, true, 'old input remains suspended while modelLoads is nonzero')
    await new Promise(resolve => setTimeout(resolve, 35))
    assert.equal(h.calls.filter(call => call.action === 'native_paint').length, before)
    loadHeld.resolve(); assert.equal((await retarget).success, true)
    assert.notEqual(h.surface.element.querySelector('input'), oldInput)
    assert.equal(h.surface.element.querySelector('input').disabled, false)
    assert.equal(h.events.some(event => event.type === 'engine-failed'), false)
  } finally { saveHeld.resolve(); loadHeld.resolve(); await saving; await retarget; await h.close() }
})

test('save required old-viewport paint failing during retarget does not poison the new document', async () => {
  const paintHeld = deferred(), paintStarted = deferred(), loadHeld = deferred(), loadStarted = deferred()
  let loads = 0, failPaint = false, h
  h = await surfaceHarness({ nativeRequest: async (action, params) => {
    if (action === 'export_document') { Object.defineProperty(h.surface.element, 'clientWidth', { value: 650 }); failPaint = true }
    if (action === 'native_paint' && failPaint && params.documentEpoch === 1) { paintStarted.resolve(); await paintHeld.promise; throw Error('OLD_REQUIRED_PAINT_FAILURE') }
    if (action === 'load_document' && ++loads > 1) { loadStarted.resolve(); await loadHeld.promise }
  } })
  let saving, retarget
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    saving = h.execute('export_document'); await paintStarted.promise
    retarget = h.execute('load_document', { bytes: [2], name: 'b.docx' }); await loadStarted.promise
    paintHeld.resolve(); assert.equal((await saving).success, false)
    loadHeld.resolve(); assert.equal((await retarget).success, true)
    assert.equal(h.events.some(event => event.type === 'engine-failed'), false)
    assert.equal(h.surface.element.querySelector('input').disabled, false)
  } finally { paintHeld.resolve(); loadHeld.resolve(); await saving; await retarget; await h.close() }
})

test('native byte loads including initial blank read the latest shared toolbar view preferences', async () => {
  const previousUni = globalThis.uni
  let stored = JSON.stringify({ formattingMarks: false, ruler: false, spaces: false })
  globalThis.uni = { getStorageSync: key => { assert.equal(key, 'awd_editor_view_prefs'); return stored } }
  const h = await surfaceHarness({ initialBlank: true })
  try {
    h.surface.start()
    for (let count = 0; count < 20 && !h.events.some(event => event.type === 'ready'); count++) await tick()
    assert.equal(h.events.some(event => event.type === 'ready'), true)
    const first = h.calls.find(call => call.action === 'load_document')
    assert.equal(first.params.bytes.length, 0)
    assert.deepEqual(first.params.viewOptions, { formattingMarks: false, ruler: false, paragraphMarks: true, lineBreaks: true, spaces: false, tabs: true, textBoundaries: false })
    stored = { formattingMarks: true, ruler: true, tabs: false }
    await h.execute('load_document', { bytes: [1], name: 'reload.docx' })
    const reloaded = h.calls.filter(call => call.action === 'load_document').at(-1)
    assert.deepEqual(reloaded.params.viewOptions, { formattingMarks: true, ruler: true, paragraphMarks: true, lineBreaks: true, spaces: true, tabs: false, textBoundaries: false })
    await h.execute('load_document', { authorName: 'author only' })
    assert.equal(Object.hasOwn(h.calls.filter(call => call.action === 'load_document').at(-1).params, 'viewOptions'), false)
  } finally { globalThis.uni = previousUni; await h.close() }
})

for (const unchanged of [true, false, undefined, 'true']) {
  test(`view options skip a same-viewport paint only with exact authoritative unchanged: ${unchanged}`, async () => {
    const h = await surfaceHarness({ nativeRequest: action => action === 'set_view_options'
      ? { success: true, unchanged, nativeView: { zoom: 100, ruler: false } } : undefined })
    let held, pending
    try {
      await h.execute('load_document', { bytes: [1], name: 'a.docx' })
      held = h.deferPaint()
      let finished = false
      pending = h.execute('set_view_options', { ruler: false }).then(result => { finished = true; return result })
      await new Promise(resolve => setTimeout(resolve, 35))
      assert.equal(finished, unchanged === true)
      held.resolve(); assert.equal((await pending).success, true)
    } finally { held?.resolve(); await pending; await h.close() }
  })
}

test('unchanged view options still await resized pixels and viewport ACK before enabling input', async () => {
  const ack = deferred(), ackStarted = deferred()
  let gate = false, h
  h = await surfaceHarness({ nativeRequest: async (action, params) => {
    if (action === 'set_view_options') {
      Object.defineProperty(h.surface.element, 'clientWidth', { value: 650 }); gate = true
      return { success: true, unchanged: true, nativeView: { zoom: 100, ruler: false } }
    }
    if (gate && action === 'native_input' && params.action === 'set_viewport') { ackStarted.resolve(); await ack.promise }
  } })
  let pending
  try {
    await h.execute('load_document', { bytes: [1], name: 'a.docx' })
    let finished = false
    pending = h.execute('set_view_options', { ruler: false }).then(result => { finished = true; return result })
    await ackStarted.promise; await tick()
    assert.equal(finished, false); assert.equal(h.surface.element.querySelector('input').disabled, true)
    ack.resolve(); assert.equal((await pending).success, true)
    assert.equal(h.surface.element.querySelector('canvas').style.width, '650px')
  } finally { ack.resolve(); await pending; await h.close() }
})

for (const change of ['retarget', 'permission', 'permission-roundtrip']) {
  test(`unchanged view result must not update a different owner or permission: ${change}`, async () => {
    const held = deferred(), started = deferred()
    const h = await surfaceHarness({ nativeRequest: async (action, params) => {
      if (action === 'set_view_options') { started.resolve(); await held.promise; return { success: true, unchanged: true, nativeView: { zoom: 175, ruler: false } } }
      if (action === 'set_read_only') return { success: true, ...params, lastInputSeq: 0 }
    } })
    let pending
    try {
      await h.execute('load_document', { bytes: [1], name: 'a.docx' }); await h.surface.setReadOnly(false)
      pending = h.execute('set_view_options', { ruler: false }); await started.promise
      if (change === 'retarget') await h.execute('load_document', { bytes: [2], name: 'b.docx' })
      else await h.surface.setReadOnly(true)
      if (change === 'permission-roundtrip') await h.surface.setReadOnly(false)
      const before = h.surface.element.querySelector('canvas').style.width
      held.resolve(); const result = await pending
      assert.equal(result.success, false); assert.equal(result.message, 'STALE_DOCUMENT_VIEW_OPTIONS')
      assert.equal(h.surface.element.querySelector('canvas').style.width, before)
    } finally { held.resolve(); await pending; await h.close() }
  })
}
