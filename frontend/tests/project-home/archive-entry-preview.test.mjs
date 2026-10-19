// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beginArchiveEntryDrag, readArchiveEntryDrag, endArchiveEntryDrag, isArchiveEntryDrag, ARCHIVE_ENTRY_MIME } from '../../src/utils/archiveEntryDrag.js'
import { installExternalDragCleanup } from '../../src/utils/fileLocalDrag.js'

function component(stubs = {}) {
  const source = readFileSync(new URL('../../src/components/ArchiveEntriesPane.vue', import.meta.url), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  const names = [...script.matchAll(/^import (.+) from .+$/gm)].flatMap(m => m[1].replace(/[{}]/g, '').split(',').map(s => s.trim()))
  const values = { defineAsyncComponent: () => ({}), ICONS: {}, host: {}, getArchiveEntryUrl: (p, f, path) => path, getAuthHeaders: () => ({}), ...stubs }
  const options = new Function(...names, script.replace(/^import .+$/gm, '').replace('export default', 'return'))(...names.map(n => values[n]))
  const vm = { ...options.data(), file: { projectId: 1, id: 2 }, $t: k => k }
  for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
  return { vm, options }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const entry = name => ({ path: name, name, size: 3, dir: false })
const response = bytes => ({ ok: true, headers: new Headers({ 'content-type': 'text/plain' }), arrayBuffer: async () => new TextEncoder().encode(bytes).buffer })

test('archive identity survives a native MIME reset but never becomes a movable project file', () => {
  global.document = {}
  const payload = { projectId: 1, fileId: 2, path: '照片/图.jpg' }
  const data = new Map()
  const dt = { setData: (k,v) => data.set(k,v), getData: k => data.get(k), types: [ARCHIVE_ENTRY_MIME] }
  assert.equal(beginArchiveEntryDrag(dt, payload), true)
  assert.equal(dt.effectAllowed, 'copy')
  assert.deepEqual(readArchiveEntryDrag(dt), payload)
  assert.equal(isArchiveEntryDrag({ types: ['Files'] }), true)
  assert.equal(document.__checkbaDraggedFile, undefined)
  endArchiveEntryDrag({ ...payload })
  assert.equal(readArchiveEntryDrag(null), payload, 'another component cannot clear the active owner')
  endArchiveEntryDrag(payload)
  assert.equal(readArchiveEntryDrag(null), null)
  delete global.document
})

test('rapid selection rejects a late file response, aborts previous read and revokes the previous blob', async () => {
  const originalFetch = global.fetch
  const reads = { A: deferred(), B: deferred() }
  global.fetch = path => reads[path].promise
  try {
    const { vm } = component()
    const a = vm.selectEntry(entry('A'))
    await new Promise(resolve => setTimeout(resolve, 140)) // A is already in flight before switching.
    const aController = vm._request
    const b = vm.selectEntry(entry('B'))
    assert.equal(aController.signal.aborted, true)
    reads.B.resolve(response('BBB')); await b
    const blobUrl = vm.previewUrl
    assert.equal(await (await originalFetch(blobUrl)).text(), 'BBB')
    reads.A.resolve(response('AAA')); await a
    assert.equal(vm.previewUrl, blobUrl)
    await vm.selectEntry({ path: 'folder', dir: true })
    assert.equal(vm.previewUrl, '')
    await assert.rejects(originalFetch(blobUrl))
  } finally { global.fetch = originalFetch }
})

test('native cache failure preserves preview and gives a retryable drag error', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => response('OK')
  try {
    const { vm } = component({ host: { fs: { cacheArchiveEntry: async () => ({ ok: false, reason: 'size-limit' }) } } })
    await vm.selectEntry(entry('test.txt'))
    assert.ok(vm.previewUrl)
    assert.equal(vm.error, '')
    assert.equal(vm.dragError, 'files.archiveDragFailed')
    assert.equal(vm.localPath, '')
    vm.releasePreview()
  } finally { global.fetch = originalFetch }
})

test('keyboard selects the actual next entry and keeps focus on its row', () => {
  const { vm } = component()
  vm.entries = [entry('a'), entry('b')]
  vm.selected = vm.entries[0]
  vm.selectEntry = e => { vm.selected = e }
  let focused = -1, prevented = false
  vm.onKeyDown({ key: 'ArrowDown', preventDefault: () => { prevented = true }, currentTarget: { children: [{focus:()=>{focused=0}},{focus:()=>{focused=1}}] } })
  assert.equal(vm.selected, vm.entries[1]); assert.equal(focused, 1); assert.ok(prevented)
})

test('cancelled and lost native dragend clean the archive identity and every global listener', async () => {
  for (const [event, detail] of [['keydown', {key:'Escape'}], ['focus', {}], ['mouseup', {}], ['mousemove', {buttons:0}], ['drop', {}]]) {
    global.document = {}
    const listeners = new Map()
    const win = { addEventListener: (k,fn) => listeners.set(k,fn), removeEventListener: k => listeners.delete(k) }
    const payload = { projectId:1,fileId:2,path:'a.txt' }
    beginArchiveEntryDrag(null,payload)
    let calls = 0
    const cleanup = installExternalDragCleanup(() => { calls++; endArchiveEntryDrag(payload) }, win)
    listeners.get(event)(detail)
    await new Promise(r=>setTimeout(r,5))
    cleanup()
    assert.equal(calls,1,event); assert.equal(readArchiveEntryDrag(null),null,event); assert.equal(listeners.size,0,event)
    delete global.document
  }
})

test('holding navigation keys coalesces reads to the final selected entry', async () => {
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async path => { calls.push(path); return response(path) }
  try {
    const { vm } = component()
    const reads = ['a','b','c','d'].map(name => vm.selectEntry(entry(name)))
    await Promise.all(reads)
    assert.deepEqual(calls, ['d'])
    vm.releasePreview()
  } finally { global.fetch = originalFetch }
})
