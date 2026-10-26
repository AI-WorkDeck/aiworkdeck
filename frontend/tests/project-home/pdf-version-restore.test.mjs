// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { createRenderer, h, nextTick, ref } = require('vue')
const { parse } = require('@babel/parser')
const locator = await import('../../src/utils/evidenceLocator.js')
const zoom = await import('../../src/utils/imageWheelZoom.js')
const paths = {
  preview: 'frontend/src/components/FilePreview.vue',
  tabs: 'frontend/src/pages/project-overview/fileOpenTabs.js',
  actions: 'frontend/src/pages/project-overview/agentClientActions.js',
  overview: 'frontend/src/pages/project-overview/project-overview.vue',
}
const readSource = file => process.env.PDF_TEST_BASELINE
  ? execFileSync('git', ['show', `7c9a5d2b1:${file}`], { cwd: path.resolve('.'), encoding: 'utf8' })
  : readFileSync(new URL('../../../' + file, import.meta.url), 'utf8')
const sources = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, readSource(file)]))
const scripts = Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || source]))

function method(key, name, values = {}) {
  const source = scripts[key]
  const ast = parse(source, { sourceType: 'module' })
  const found = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'ObjectMethod' && node.key.name === name) found.push(node)
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(ast)
  assert.equal(found.length, 1, `must extract exactly one actual ${name}`)
  const body = source.slice(found[0].start, found[0].end)
  return new Function(...Object.keys(values), `return ({${body}}).${name}`)(...Object.values(values))
}

const quiet = { log() {}, warn() {}, error() {} }
const uni = { showToast() {} }
const methods = {
  onVersionReloadFiles: method('tabs', 'onVersionReloadFiles', { uni }),
  isEditorOpenableFile: method('tabs', 'isEditorOpenableFile', { PLAIN_TEXT_TYPES: JSON.parse(scripts.tabs.match(/const PLAIN_TEXT_TYPES = (\[[^\n]+\])/)[1].replaceAll("'", '"')) }),
  useLibreEditor: method('tabs', 'useLibreEditor'),
  reloadPlainTextInstances: method('tabs', 'reloadPlainTextInstances', { console: quiet }),
  syncOpenTabsFromFileTree: method('overview', 'syncOpenTabsFromFileTree'),
}
const renderer = createRenderer({
  createElement: type => ({ type, children: [] }),
  createText: text => ({ text }), createComment: text => ({ text }),
  insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
  remove: node => { const i = node.parent.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1) },
  setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text },
  patchProp() {}, parentNode: node => node.parent, nextSibling: () => null,
})

async function fixture({ stream = false } = {}) {
  const backend = { bytes: 'SYNTHETIC PDF ORIGINAL BYTES', metadata: { id: 17, fileType: 'pdf', name: 'same-name.pdf', wpsFileId: 'v-original', fileSize: 1234 } }
  const file = ref({ ...backend.metadata })
  const requests = [], urls = new Map(), revoked = [], treeLoads = [], detailReads = []
  let sequence = 0
  class Xhr {
    open(method, url) { this.method = method; this.url = url }
    getResponseHeader() { return 'inline; filename="synthetic.pdf"' }
    setRequestHeader() {}
    send() {
      this.bytes = backend.bytes
      requests.push(this)
      queueMicrotask(() => {
        if (this.aborted) return
        this.status = 200
        this.response = new Blob([this.bytes], { type: 'application/pdf' })
        this.onload()
      })
    }
    abort() { this.aborted = true; this.onabort?.() }
  }
  const values = {
    getFileBytesUrl: id => `/synthetic/${id}/download`, getAuthHeaders: () => ({}), getSessionId: () => '', buildStreamUrl: url => url,
    host: {}, MediaPlayer: {}, ArchiveEntriesPane: {}, previewKindOf: () => '', shouldGrabMediaFocus: () => false,
    ...locator, ...zoom, console: quiet, XMLHttpRequest: Xhr,
    URL: { createObjectURL: blob => { const url = `blob:synthetic-${++sequence}`; urls.set(url, blob); return url }, revokeObjectURL: url => revoked.push(url) },
    window: { addEventListener() {}, removeEventListener() {} }, uni,
  }
  let script = scripts.preview.replace(/\/\/ #ifndef H5[\s\S]*?\/\/ #endif/g, '')
  const imports = [...script.matchAll(/^import ([\s\S]*?) from ['"][^'"]+['"]\s*$/gm)]
    .flatMap(match => match[1].replace(/[{}]/g, '').split(',').map(name => name.trim()).filter(Boolean))
  script = script.replace(/^import [\s\S]*? from ['"][^'"]+['"]\s*$/gm, '').replace('export default', 'return')
  const names = [...new Set([...imports, 'console', 'XMLHttpRequest', 'URL', 'window', 'uni'])]
  const options = new Function(...names, script)(...names.map(name => values[name]))
  options.render = () => h('iframe', { ref: 'pdfViewer' })
  let vm
  const app = renderer.createApp({ render: () => h(options, { file: file.value, sourceUrl: stream ? '' : '/synthetic/17/download', ref: value => { if (value) vm = value } }) })
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = () => {}
  app.mount({ children: [] })
  const host = {
    projectId: 8, leftFiles: [file.value], rightFiles: [], libreOfficePreferred: true, _plainTextRefs: {},
    _projectVersionReload: null, $t: key => key, updateWindowTitle() {}, syncFileTreeSelectionWithActiveTab() {},
    unloadInactiveLibreInstances() {}, async reloadActiveLibreInstances() { return true },
    isPdfPreviewFile: target => target?.fileType === 'pdf',
    evictPdfKeepAlive() {},
    $nextTick: nextTick,
    async reloadPdfInstances(id, force = true) { return String(id) === '17' ? vm.reloadFromBackend(force) : true },
    openFile() { throw new Error('already-open PDF must not open a new tab') },
  }
  for (const [name, fn] of Object.entries(methods)) host[name] = fn.bind(host)
  host.handleEditorReloadFile = method('actions', 'handleEditorReloadFile', {
    console: quiet, uni, getFileDetail: async (projectId, id) => {
      detailReads.push({ projectId, id }); return { ...backend.metadata }
    },
  }).bind(host)
  host.$refs = { fileTree: { allFiles: [{ ...backend.metadata }], loadFiles() {
    const pending = Promise.resolve().then(() => {
      this.allFiles = [{ ...backend.metadata }]
      host.syncOpenTabsFromFileTree()
    })
    treeLoads.push(pending)
    return pending
  } } }
  const drain = async () => { await Promise.all(treeLoads); await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }
  await drain()
  if (!stream) assert.equal(await urls.get(vm.blobUrl).text(), backend.bytes)
  vm.onPdfViewerLoad()
  await vm._mediaLoadPromise
  return {
    file, host, requests, revoked, backend, drain, vm,
    changeBackend() { backend.bytes = 'SYNTHETIC PDF RESTORED BYTES'; backend.metadata = { ...backend.metadata, wpsFileId: 'v-restored', fileSize: 5678 } },
    async acceptViewer() { vm.onPdfViewerLoad(); await vm._mediaLoadPromise },
    async previewBytes() { return urls.get(vm.blobUrl)?.text() },
    stop: () => app.unmount(),
  }
}

test('version restore refreshes an already-visible PDF after the file tree finishes', async () => {
  const f = await fixture()
  try {
    f.changeBackend()
    const pending = f.host.onVersionReloadFiles([17])
    await f.drain()
    assert.equal(f.host.$refs.fileTree.allFiles[0].wpsFileId, 'v-restored')
    assert.equal(f.file.value.fileSize, 5678)
    assert.equal(f.requests.length, 2)
    await f.acceptViewer()
    assert.equal(await pending, true)
    assert.equal(await f.previewBytes(), f.backend.bytes)
  } finally { f.stop() }
})

test('AI PDF reload keeps its original metadata and watcher path', async () => {
  const f = await fixture()
  try {
    f.changeBackend()
    const pending = f.host.handleEditorReloadFile({ fileId: 17 })
    await f.drain()
    await f.acceptViewer()
    assert.equal(await pending, true)
    assert.equal(f.requests.length, 2)
    assert.equal(f.file.value.wpsFileId, 'v-restored')
    assert.equal(await f.previewBytes(), f.backend.bytes)
    assert.equal(f.revoked.length, 1)
  } finally { f.stop() }
})

test('changed-version AI reload waits for the viewer and propagates rejection', async () => {
  const f = await fixture()
  try {
    f.changeBackend()
    let settled = false
    const pending = f.host.handleEditorReloadFile({ fileId: 17 }).then(value => { settled = true; return value })
    await f.drain()
    assert.equal(settled, false)
    assert.equal(f.requests.length, 2, 'join the version watcher without a second download')
    f.vm.onPdfViewerError()
    assert.equal(await pending, false)
  } finally { f.stop() }
})

test('same-object content version change still triggers the atomic watcher', async () => {
  const f = await fixture()
  try {
    f.changeBackend()
    f.file.value.wpsFileId = f.backend.metadata.wpsFileId
    await f.drain()
    await f.acceptViewer()
    assert.equal(f.requests.length, 2)
    assert.equal(await f.previewBytes(), f.backend.bytes)
    assert.equal(f.revoked.length, 1)
  } finally { f.stop() }
})

test('explicit reload succeeds only after the viewer accepts the new bytes', async () => {
  const f = await fixture()
  try {
    f.changeBackend()
    let settled = false
    const pending = f.host.reloadPdfInstances(17).then(value => { settled = true; return value })
    await f.drain()
    assert.equal(settled, false)
    assert.equal(await f.previewBytes(), f.backend.bytes)
    await f.acceptViewer()
    assert.equal(await pending, true)
  } finally { f.stop() }
})

if (!process.env.PDF_TEST_BASELINE) {
  test('viewer rejection or absence returns false instead of a hollow success', async () => {
    const f = await fixture()
    try {
      f.changeBackend()
      const pending = f.host.reloadPdfInstances(17)
      await f.drain()
      f.vm.onPdfViewerError()
      assert.equal(await pending, false)
    } finally { f.stop() }
  })
}

test('restore with an unchanged version id still replaces bytes, including the protected version workflow', async () => {
  const f = await fixture()
  try {
    f.backend.bytes = 'RESTORED WITHOUT METADATA CHANGE'
    f.host._projectVersionReload = async () => true
    const pending = f.host.onVersionReloadFiles([17])
    await f.drain(); await f.acceptViewer()
    assert.equal(await pending, true)
    assert.equal(await f.previewBytes(), f.backend.bytes)
  } finally { f.stop() }
})

test('PDF retention is limited to two visited files independently in each pane', () => {
  const host = { pdfKeepAliveKeys: [], pdfPreviewEpoch: 0 }
  for (const name of ['isPdfPreviewFile', 'touchPdfKeepAlive', 'evictPdfKeepAlive', 'resetPdfPreviewPool']) host[name] = method('tabs', name).bind(host)
  for (const pane of ['left', 'right']) for (const id of [1, 2, 3]) host.touchPdfKeepAlive(pane, { id, fileType: 'pdf' })
  assert.deepEqual(new Set(host.pdfKeepAliveKeys), new Set(['left:3','left:2','right:3','right:2']))
  host.evictPdfKeepAlive('left', 2)
  assert.equal(host.pdfKeepAliveKeys.includes('left:2'), false)
  host.resetPdfPreviewPool()
  assert.deepEqual(host.pdfKeepAliveKeys, []); assert.equal(host.pdfPreviewEpoch, 1)
})

test('PDF starts with an authenticated HEAD then hands its URL to the native viewer without a full Blob download', async () => {
  const f = await fixture({ stream: true })
  try {
    assert.equal(f.requests.length, 1)
    assert.equal(f.requests[0].method, 'HEAD')
    assert.match(f.vm.pdfStreamUrl, /inline=true/)
    assert.equal(f.vm.blobUrl, '')
    assert.equal(f.vm.loading, false)
  } finally { f.stop() }
})

test('a new restore supersedes a still-pending PDF load even when the version id is unchanged', async () => {
  const f = await fixture()
  try {
    const old = f.vm.reloadFromBackend()
    f.backend.bytes = 'LATEST RESTORE'
    const latest = f.vm.reloadFromBackend()
    await f.drain()
    assert.equal(await old, false)
    await f.acceptViewer()
    assert.equal(await latest, true)
    assert.equal(await f.previewBytes(), 'LATEST RESTORE')
  } finally { f.stop() }
})

test('an inline viewer failure falls back once to authenticated Blob loading', async () => {
  const f = await fixture({ stream: true })
  try {
    const pending = f.vm.reloadFromBackend()
    await f.drain(); f.vm.onPdfViewerError(); await f.drain()
    assert.equal(f.requests.at(-1).method, 'GET')
    assert.equal(f.vm.pdfStreamUrl, '')
    assert.ok(f.vm.blobUrl.startsWith('blob:'))
    await f.acceptViewer(); assert.equal(await pending, true)
  } finally { f.stop() }
})


test('permission reset rebuilds viewers and retains the current PDF across the next switch', () => {
  const host = { pdfKeepAliveKeys: ['left:9', 'left:17', 'right:20'], pdfPreviewEpoch: 3, activeFileLeft: { id: 17, fileType: 'pdf' }, activeFileRight: null }
  for (const name of ['isPdfPreviewFile', 'touchPdfKeepAlive', 'resetPdfPreviewPool']) host[name] = method('tabs', name).bind(host)
  host.resetPdfPreviewPool()
  assert.equal(host.pdfPreviewEpoch, 4)
  assert.deepEqual(host.pdfKeepAliveKeys, ['left:17'])
  host.touchPdfKeepAlive('left', { id: 18, fileType: 'pdf' })
  assert.deepEqual(host.pdfKeepAliveKeys, ['left:18', 'left:17'])
  host.touchPdfKeepAlive('left', { id: 19, fileType: 'pdf' })
  assert.deepEqual(host.pdfKeepAliveKeys, ['left:19', 'left:18'])
})


test('identical permission polling preserves PDF viewers, role changes invalidate them', async () => {
  const source = scripts.overview
  const start = source.indexOf('    pdfPermissionIdentity() {')
  const end = source.indexOf('    leftPdfFiles() {', start)
  const identity = new Function('return ({' + source.slice(start, end) + '}).pdfPermissionIdentity')()
  const user = ref({ id: 1, role: 'USER' }), members = ref([{ userId: 1, role: 'PARTICIPANT' }])
  let resets = 0
  const app = renderer.createApp({
    computed: { pdfPermissionIdentity() { return identity.call({ currentUser: user.value, project: { userId: 2 }, localProjectMembers: members.value }) } },
    watch: { pdfPermissionIdentity() { resets++ } },
    render: () => h('view'),
  })
  app.mount({ children: [] })
  members.value = [{ userId: 1, role: 'PARTICIPANT' }]
  await nextTick(); assert.equal(resets, 0)
  members.value[0].role = 'CLIENT'
  await nextTick(); assert.equal(resets, 1)
  user.value.role = 'CLIENT'
  await nextTick(); assert.equal(resets, 2)
  app.unmount()
})
