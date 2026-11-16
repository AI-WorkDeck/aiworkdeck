// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1474: catalog reads and duplicate previews must not delay editing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function component(name, overrides = {}) {
  const script = ((s) => s.slice(s.indexOf('<script>') + 8, s.indexOf('</script>')))(readFileSync(new URL(`../../src/components/${name}.vue`, import.meta.url), 'utf8'))
  const imports = [...script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)]
  const names = imports.flatMap(([, clause]) => {
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1].split(',').map(s => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean) || []
    const defaultName = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim()
    return defaultName ? [...named, defaultName] : named
  })
  const body = script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '')
    .replace("import('docx-preview')", 'previewModule()')
    .replace(/import\('@\/composables\/xlsxQuickPreview\.js'\)/g, 'xlsxPreviewModule()')
    .replace('export default', 'return')
  return new Function(...names, 'previewModule', 'xlsxPreviewModule', body)(...names.map(n => overrides[n] || (() => {})), overrides.previewModule, overrides.xlsxPreviewModule)
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

for (const docKind of ['writer', 'calc', 'impress']) {
  test(`${docKind}: editing layout and view state finish before slow font/style catalogs`, async () => {
    const options = component('EditorToolbar')
    const catalogs = deferred(), calls = []
    const vm = { ...options.data(), ...options.methods, docKind, isWriter: docKind === 'writer', $emit() {},
      executor: { async executeCommand(action) {
        calls.push(action)
        if (action === 'list_fonts' || action === 'list_styles') return catalogs.promise
        return { success: true, character: {}, paragraph: {}, selection: {}, view: { ruler: true } }
      } },
    }
    const boot = vm.bootstrap()
    await tick()
    assert.equal(vm.chromeHidden, true)
    assert.equal(vm.viewPrefsReady, true, 'catalog latency must not disable view controls')
    assert.equal(vm.state.view.ruler, true, 'state is read after view preferences')
    assert.deepEqual(calls.slice(0, docKind === 'writer' ? 3 : 2), docKind === 'writer'
      ? ['set_chrome', 'set_view_options', 'get_ui_state']
      : ['set_chrome', 'get_ui_state'])
    assert.equal(calls.filter(a => a === 'get_ui_state').length, 1)
    assert.equal(calls.filter(a => a === 'list_styles').length, docKind === 'writer' ? 1 : 0)
    catalogs.resolve({ success: true, styles: [{ name: 'Heading 1' }], families: ['测试字体'] })
    await boot
    assert.deepEqual(vm.fontList, ['测试字体'])
    assert.deepEqual(vm.styleList, docKind === 'writer' ? [{ name: 'Heading 1' }] : [])
  })
}

test('failed view preference application still reads the actual toolbar state', async () => {
  const options = component('EditorToolbar')
  const calls = []
  const vm = { ...options.data(), ...options.methods, docKind: 'writer', isWriter: true, $emit() {},
    executor: { async executeCommand(action) {
      calls.push(action)
      if (action === 'set_view_options') throw new Error('view unavailable')
      return { success: true, view: { ruler: false } }
    } },
  }
  await vm.bootstrap()
  assert.equal(vm.state.view.ruler, false)
  assert.equal(calls.filter(a => a === 'get_ui_state').length, 1)
})

function previewVm({ endpointUp = false, module } = {}) {
  const events = []
  const options = component('LibreOfficeEditor', { documentCheckpointGeneration: () => 0,
    host: { zetaoffice: { getEditor: async () => ({ kind: 'iframe', url: 'about:blank' }) } }, previewModule: async () => {
    events.push('import')
    return module ? module.promise : { renderAsync: async () => { events.push('render') } }
  } })
  const vm = { _endpointUp: endpointUp, ready: false, previewReady: false, previewFailed: false,
    projectId: 1, file: { id: 7, fileType: 'docx' }, $nextTick: async () => {}, $refs: { docxPreviewHost: { innerHTML: '' } }, appendLog() {},
    tryDocxPreview: options.methods.tryDocxPreview,
    fetchDocumentBytes: options.methods.fetchDocumentBytes,
  }
  return { vm, events, options }
}

test('cold engine boot shows cached engine renders for PPTX, and nothing (not a wrong picture) without a cache', async () => {
  const cached = { total: 7, slides: [{ bytes: new Uint8Array([1]), width: 960, height: 540 }] }
  for (const hit of [true, false]) {
    const events = []
    const options = component('LibreOfficeEditor', { documentCheckpointGeneration: () => 0,
      createSlidePreviewCache: () => ({ load: async (key) => { events.push('load:' + key); return hit ? cached : null } }),
      previewFingerprint: async () => 'sha-of-bytes',
      previewModule: async (kind) => { events.push('import:' + (kind || 'docx')); return {} } })
    const vm = { _endpointUp: false, ready: false, previewReady: false, previewFailed: false,
      projectId: 1, file: { id: 7, fileType: 'pptx' }, $nextTick: async () => {}, $refs: { docxPreviewHost: { innerHTML: '' } }, appendLog() {},
      renderCachedSlides: (_c, entry) => events.push('cards:' + entry.slides.length + '/' + entry.total),
      tryDocxPreview: options.methods.tryDocxPreview }
    await vm.tryDocxPreview(new ArrayBuffer(16))
    assert.deepEqual(events, hit ? ['load:sha-of-bytes', 'cards:1/7'] : ['load:sha-of-bytes'])
    assert.equal(vm.previewReady, hit)
    assert.ok(!events.some(e => e.startsWith('import:')), 'no front-end pptx parsing')
  }
})

test('a warm engine opens DOCX without importing or rendering a duplicate preview', async () => {
  const { vm, events } = previewVm({ endpointUp: true })
  await vm.tryDocxPreview(new ArrayBuffer(16))
  assert.deepEqual(events, [])
  assert.equal(vm.previewReady, false)
})

test('cold engine boot retains the automatic readable preview', async () => {
  const { vm, events } = previewVm()
  await vm.tryDocxPreview(new ArrayBuffer(16))
  assert.deepEqual(events, ['import', 'render'])
  assert.equal(vm.previewReady, true)
})

test('engine ready during preview import prevents the later duplicate parse', async () => {
  const module = deferred(), { vm, events } = previewVm({ module })
  const pending = vm.tryDocxPreview(new ArrayBuffer(16))
  vm._endpointUp = true
  module.resolve({ renderAsync: async () => { events.push('render') } })
  await pending
  assert.deepEqual(events, ['import'])
  assert.equal(vm.previewReady, false)
})

test('explicit read-only fallback still renders after the engine rejected a document', async () => {
  const { vm, events } = previewVm({ endpointUp: true })
  vm.ready = true
  vm.previewFailed = true
  await vm.tryDocxPreview(new ArrayBuffer(16), true)
  assert.deepEqual(events, ['import', 'render'])
  assert.equal(vm.previewReady, true)
})

test('a dead warm spare restores the cold-boot preview from its one cached download', async () => {
  const { vm, events, options } = previewVm({ endpointUp: true })
  let downloads = 0
  Object.assign(vm, {
    prefetchBytes: options.methods.prefetchBytes, adoptAndLoad: options.methods.adoptAndLoad,
    remountEditor: options.methods.remountEditor, probeGuestAlive: async () => false,
    startBootTrickle() {}, mountEditor() {}, fetchArrayBuffer: async () => { downloads++; return new ArrayBuffer(16) },
  })
  vm.prefetchBytes()
  const downloaded = vm._bytesPromise
  await tick()
  assert.deepEqual(events, [], 'warm skip happens before the failed liveness probe')
  await vm.adoptAndLoad()
  await tick()
  assert.equal(vm._bytesPromise, downloaded)
  assert.equal(downloads, 1)
  assert.deepEqual(events, ['import', 'render'])
  assert.equal(vm.previewReady, true)
})

test('cold fallback does not replay a preview invalidated by a newer load', async () => {
  const module = deferred(), { vm, events, options } = previewVm({ endpointUp: true, module })
  Object.assign(vm, {
    prefetchBytes: options.methods.prefetchBytes, adoptAndLoad: options.methods.adoptAndLoad,
    remountEditor: options.methods.remountEditor, probeGuestAlive: async () => false,
    startBootTrickle() {}, mountEditor() {}, fetchArrayBuffer: async () => new ArrayBuffer(16),
  })
  vm.prefetchBytes()
  await tick()
  await vm.adoptAndLoad()
  assert.deepEqual(events, ['import'])
  vm._docLoadSeq++
  module.resolve({ renderAsync: async () => { events.push('render') } })
  await tick()
  assert.deepEqual(events, ['import'])
  assert.equal(vm.previewReady, false)
})

test('a download still pending when the spare dies starts only one cold preview', async () => {
  const download = deferred(), { vm, events, options } = previewVm({ endpointUp: true })
  Object.assign(vm, {
    prefetchBytes: options.methods.prefetchBytes, adoptAndLoad: options.methods.adoptAndLoad,
    remountEditor: options.methods.remountEditor, probeGuestAlive: async () => false,
    startBootTrickle() {}, mountEditor() {}, fetchArrayBuffer: () => download.promise,
  })
  vm.prefetchBytes()
  await vm.adoptAndLoad()
  download.resolve(new ArrayBuffer(16))
  await tick()
  assert.deepEqual(events, ['import', 'render'])
  assert.equal(vm.previewReady, true)
})

for (const [name, file, expected] of [
  ['nonempty cold file', { id: 1, fileSize: 500 }, '1'],
  ['spare', null, null], ['new blank file', { id: 1, fileSize: 0 }, null],
  ['unknown size', { id: 1 }, null],
]) {
  test(`${name}: guest initial-model intent is fixed when the instance is mounted`, () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    globalThis.document = { getElementById: () => ({ appendChild() {} }) }
    try {
      const options = component('LibreOfficeEditor', { getResolvedTheme: () => 'light' })
      let url
      const vm = { file, hostId: 'test', createIframe(info) { url = info.url; return { style: {} } } }
      options.methods.mountEditor.call(vm, { kind: 'iframe', url: 'http://127.0.0.1/editor.html?lowa=/lowa/' })
      assert.equal(new URL(url).searchParams.get('initialDocument'), expected)
      assert.equal(new URL(url).searchParams.get('theme'), 'light')
    } finally { descriptor ? Object.defineProperty(globalThis, 'document', descriptor) : delete globalThis.document }
  })
}

for (const action of ['get_ui_state', 'office_get_navigation', 'slide_get_thumbnail']) {
  test(`${action} cannot postpone a pending normal autosave`, async () => {
    const flight = deferred()
    const options = component('LibreOfficeEditor', { createRelayExecutor: () => ({ executeCommand: () => flight.promise }) })
    let saves = 0
    const vm = { ...options.methods, file: { id: 1 }, dirty: true, _dirtySince: Date.now() - 2500,
      appendLog() {}, saveDocument: async () => { saves++; return true }, scheduleAutoSave() {} }
    vm.wireExecutor({}, 'test')
    const pending = vm.executor.executeCommand(action, {})
    assert.equal(vm._cmdBusy, 0)
    await vm.autoSave()
    assert.equal(saves, 1)
    flight.resolve({ success: true }); await pending
    assert.equal(vm._lastCmdAt, 0)
  })
}
test('an actual edit in flight or recent user interaction still postpones export', async () => {
  const flight = deferred()
  const options = component('LibreOfficeEditor', { createRelayExecutor: () => ({ executeCommand: () => flight.promise }) })
  let saves = 0
  const vm = { ...options.methods, file: { id: 1 }, dirty: true, _dirtySince: Date.now() - 2500,
    appendLog() {}, saveDocument: async () => { saves++; return true } }
  vm.wireExecutor({}, 'test')
  const pending = vm.executor.executeCommand('sheet_write_cells', {})
  await vm.autoSave(); clearTimeout(vm._saveTimer); assert.equal(saves, 0)
  flight.resolve({ success: true }); await pending
  vm._lastCmdAt = 0; vm._lastInteractionAt = Date.now()
  await vm.autoSave(); clearTimeout(vm._saveTimer); assert.equal(saves, 0)
})

test('xlsx cold open: the first screen read from the file is shown; a sheet with pictures on screen keeps the progress card (O10)', async () => {
  for (const screen of [{ sheets: ['台账'], active: 0, columns: [], rows: [], merges: [] }, null]) {
    const events = []
    const options = component('LibreOfficeEditor', { documentCheckpointGeneration: () => 0,
      previewModule: async () => { events.push('import:docx-preview'); return {} },
      xlsxPreviewModule: async () => ({
        readXlsxFirstScreen: async () => { events.push('read'); return screen },
        renderSheetPreview: () => events.push('render'),
      }) })
    const vm = { _endpointUp: false, ready: false, previewReady: false, previewFailed: false,
      projectId: 1, file: { id: 8, fileType: 'xlsx' }, $nextTick: async () => {}, $refs: { docxPreviewHost: { innerHTML: '' } }, appendLog() {},
      tryDocxPreview: options.methods.tryDocxPreview }
    await vm.tryDocxPreview(new ArrayBuffer(16))
    assert.deepEqual(events, screen ? ['read', 'render'] : ['read'])
    assert.equal(vm.previewReady, !!screen)
  }
  // warm engine: no parsing at all
  const events = []
  const options = component('LibreOfficeEditor', { documentCheckpointGeneration: () => 0,
    xlsxPreviewModule: async () => { events.push('import'); return {} } })
  const vm = { _endpointUp: true, ready: false, previewReady: false, previewFailed: false, file: { id: 8, fileType: 'xlsx' },
    tryDocxPreview: options.methods.tryDocxPreview }
  await vm.tryDocxPreview(new ArrayBuffer(16))
  assert.deepEqual(events, [])
})
