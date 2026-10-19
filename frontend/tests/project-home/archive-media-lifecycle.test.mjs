// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beginArchiveEntryDrag, endArchiveEntryDrag } from '../../src/utils/archiveEntryDrag.js'
import { installExternalDragCleanup, startExternalFileDrag } from '../../src/utils/fileLocalDrag.js'

const PREVIEW = readFileSync(new URL('../../src/components/FilePreview.vue', import.meta.url), 'utf8')
const ARCHIVE = readFileSync(new URL('../../src/components/ArchiveEntriesPane.vue', import.meta.url), 'utf8')

function between(source, start, end) {
  const offset = source.indexOf(start)
  assert.ok(offset >= 0, `missing lifecycle method: ${start}`)
  const boundary = source.indexOf(end, offset)
  assert.ok(boundary > offset, `missing next method: ${end}`)
  return source.slice(offset, boundary)
}

function mediaHarness() {
  const calls = { created: [], revoked: [], toasts: [], logs: [], requests: [], textLoads: 0 }
  const URL = {
    createObjectURL(blob) { const value = `blob:preview-${calls.created.length}`; calls.created.push({ value, blob }); return value },
    revokeObjectURL(value) { calls.revoked.push(value) },
  }
  class XMLHttpRequest {
    constructor() { calls.requests.push(this); this.aborted = false }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() { this.aborted = true }
  }
  // Execute the production methods, including the actual lifecycle hook. An aborted
  // XHR may already have queued a callback, so the tests explicitly fire it anyway.
  const body = between(PREVIEW, '    async loadMediaResource()', '    fetchAuthedBlob()')
    + between(PREVIEW, '    reloadPreview(newFile)', '    resetImageViewState()')
    + between(PREVIEW, '  beforeUnmount()', '  mounted()')
  const methods = new Function('XMLHttpRequest', 'getAuthHeaders', 'URL', 'console', 'uni', 'window', `return ({${body}})`)(
    XMLHttpRequest, () => ({}), URL,
    { log: (...args) => calls.logs.push(args), error: (...args) => calls.logs.push(args) },
    { showToast: value => calls.toasts.push(value) }, { removeEventListener() {} },
  )
  const vm = {
    file: { name: '照片.jpg', fileType: 'jpg' }, fileUrl: 'blob:archive-entry', blobUrl: '', loading: false,
    getMimeType: () => 'image/jpeg', $t: key => key,
    clearEvidenceRectTimers() {}, unbindImageViewportListeners() {}, resetImageViewState() {},
    loadTextContent() { calls.textLoads++ },
  }
  for (const [name, fn] of Object.entries(methods)) vm[name] = fn.bind(vm)
  return { vm, calls }
}

function completeImage(xhr) {
  xhr.status = 200
  xhr.response = new Blob(['synthetic-photo'], { type: 'image/jpeg' })
  xhr.onload()
}

for (const leave of ['unmount', 'switch-to-text']) {
  test(`archive image ${leave}: late load, error and progress cannot retain bytes or disturb the next preview`, async () => {
    const { vm, calls } = mediaHarness()
    await vm.loadMediaResource()
    const xhr = calls.requests[0]
    if (leave === 'unmount') vm.beforeUnmount()
    else {
      vm.isText = true
      vm.reloadPreview({ name: '说明.txt', fileType: 'txt' })
      assert.equal(calls.textLoads, 1)
    }
    assert.equal(xhr.aborted, true, 'leaving the image must cancel its pending byte request')
    vm.loading = true // A new preview/request owns this state now.
    const logCount = calls.logs.length
    completeImage(xhr)
    xhr.onerror()
    xhr.onprogress({ lengthComputable: true, loaded: 1, total: 2 })
    assert.deepEqual(calls.created, [], 'queued completion must not create an unreachable Blob URL')
    assert.deepEqual(calls.toasts, [], 'an old image must not show a network error over the new preview')
    assert.equal(calls.logs.length, logCount, 'old progress must also be ignored')
    assert.equal(vm.loading, true)
  })
}

test('a successfully displayed archive image releases its Blob URL when its child preview unmounts', async () => {
  const { vm, calls } = mediaHarness()
  await vm.loadMediaResource()
  completeImage(calls.requests[0])
  assert.equal(calls.created.length, 1)
  assert.equal(vm.blobUrl, calls.created[0].value)
  assert.equal(vm.loading, false)
  vm.beforeUnmount()
  assert.deepEqual(calls.revoked, [calls.created[0].value])
})

function dragWindow() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
      if (!listeners.get(type)?.size) listeners.delete(type)
    },
    fire(type, event = {}) { for (const fn of [...(listeners.get(type) || [])]) fn(event) },
  }
}

for (const nativeResult of ['success', 'throw', 'reject', 'not-ready']) {
  test(`archive pane unmount removes every drag listener and payload after native ${nativeResult}`, async t => {
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const win = dragWindow()
    globalThis.window = win
    globalThis.document = {}
    t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument })
    const calls = { starts: [], events: [], revoked: [], aborted: 0, primes: 0, toasts: [] }
    const host = { fs: { startDrag(path) {
      calls.starts.push(path)
      if (nativeResult === 'throw') throw new Error('synthetic native error')
      if (nativeResult === 'reject') return Promise.reject(new Error('synthetic native error'))
      return { ok: true }
    } } }
    const stubs = {
      defineAsyncComponent: () => ({}), host,
      beginArchiveEntryDrag, endArchiveEntryDrag, installExternalDragCleanup, startExternalFileDrag,
      applyDragImage() {},
      uni: { $emit: name => calls.events.push(name), showToast: value => calls.toasts.push(value) },
      URL: { revokeObjectURL: value => calls.revoked.push(value) },
    }
    const body = ARCHIVE.match(/<script>([\s\S]*?)<\/script>/)[1]
      .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
      .replace('export default {', 'return {')
    const options = new Function(...Object.keys(stubs), body)(...Object.values(stubs))
    const entry = { path: '照片/现场.jpg', name: '现场.jpg', dir: false }
    const vm = { ...options.data(), selected: entry, file: { id: 10, projectId: 20 },
      localPath: nativeResult === 'not-ready' ? '' : '/synthetic/现场.jpg', previewUrl: 'blob:outer-preview',
      $t: key => key, _request: { abort() { calls.aborted++ } } }
    for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
    vm.primeEntry = () => { calls.primes++ }
    const dt = { effectAllowed: 'all', setData() {} }
    vm.onDragStart({ dataTransfer: dt }, entry)
    assert.ok(win.listeners.size > 0)
    assert.equal(document.__checkbaDraggedArchiveEntry?.path, entry.path)
    assert.equal(document.__checkbaDraggedFile, undefined, 'archive entries must not impersonate project files')
    assert.equal(calls.events.includes('file-drag-start'), false, 'archive drag must not arm the LOWA overlay')
    options.beforeUnmount.call(vm)
    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(win.listeners.size, 0, 'all completion/focus/pointer listeners must detach immediately on unmount')
    assert.equal(document.__checkbaDraggedArchiveEntry, null)
    assert.equal(vm._dragEntry, null)
    assert.equal(vm._cleanupDrag, null)
    assert.equal(calls.aborted, 1)
    assert.deepEqual(calls.revoked, ['blob:outer-preview'])
    assert.equal(calls.events.filter(name => name === 'archive-drag-end').length, 1)
    win.fire('focus')
    win.fire('mousemove', { buttons: 0 })
    assert.equal(calls.events.filter(name => name === 'archive-drag-end').length, 1)
    assert.equal(calls.starts.length, nativeResult === 'not-ready' ? 0 : 1)
    assert.equal(calls.primes, nativeResult === 'not-ready' ? 1 : 0)
  })
}
