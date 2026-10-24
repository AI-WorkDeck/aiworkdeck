// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board#1474: catalog reads and duplicate previews must not delay editing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function component(name, overrides = {}) {
  const script = readFileSync(new URL(`../../src/components/${name}.vue`, import.meta.url), 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)[1]
  const imports = [...script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)]
  const names = imports.flatMap(([, clause]) => {
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1].split(',').map(s => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean) || []
    const defaultName = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, '').trim()
    return defaultName ? [...named, defaultName] : named
  })
  const body = script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '')
    .replace("import('docx-preview')", 'previewModule()')
    .replace('export default', 'return')
  return new Function(...names, 'previewModule', body)(...names.map(n => overrides[n] || (() => {})), overrides.previewModule)
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
  }
  return { vm, events, options }
}

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
