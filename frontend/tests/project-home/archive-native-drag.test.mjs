// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beginArchiveEntryDrag, endArchiveEntryDrag, ARCHIVE_ENTRY_MIME } from '../../src/utils/archiveEntryDrag.js'
import { installExternalDragCleanup } from '../../src/utils/fileLocalDrag.js'
import { nativeEvent } from '../../src/utils/fileTreeExternalDrop.js'

const source = readFileSync(new URL('../../src/components/ArchiveEntriesPane.vue', import.meta.url), 'utf8')
function harness(t, startDrag = () => ({ ok: true })) {
  const oldWindow = globalThis.window, oldDocument = globalThis.document
  const listeners = new Map(), order = [], events = [], toasts = [], data = new Map()
  globalThis.document = {}
  globalThis.window = {
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
  }
  const stubs = {
    defineAsyncComponent: () => ({}), host: { fs: { startDrag(path) { order.push('start'); return startDrag(path) } } },
    beginArchiveEntryDrag, endArchiveEntryDrag, installExternalDragCleanup, nativeEvent,
    applyDragImage() {}, uni: { $emit: name => events.push(name), showToast: value => toasts.push(value) },
  }
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^import .+$/gm, '').replace('export default', 'return')
  const options = new Function(...Object.keys(stubs), script)(...Object.values(stubs))
  const entry = { path: '合成/说明.txt', name: '说明.txt', dir: false }
  const vm = { ...options.data(), file: { id: 1, projectId: 2 }, selected: entry, localPath: '/synthetic/说明.txt', $t: key => key }
  for (const [name, fn] of Object.entries(options.methods)) vm[name] = fn.bind(vm)
  vm.primeEntry = () => {}
  t.after(() => { vm.finishDrag(); globalThis.window = oldWindow; globalThis.document = oldDocument })
  const event = { dataTransfer: { setData(k, v) { data.set(k, v) } }, preventDefault() { order.push('cancel') } }
  return { vm, entry, event, listeners, order, events, toasts, data, host: stubs.host }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('archive native handoff cancels the real dragstart before IPC and retains archive-only identity until completion', async t => {
  const h = harness(t)
  window.event = h.event
  h.vm.onDragStart({}, h.entry) // uni-h5 wrapper omits dataTransfer
  assert.deepEqual(h.order, ['cancel', 'start'])
  assert.equal(JSON.parse(h.data.get(ARCHIVE_ENTRY_MIME)).path, h.entry.path)
  await tick()
  assert.equal(document.__checkbaDraggedArchiveEntry, h.vm._dragEntry)
  assert.ok(h.vm._dragEntry)
  assert.equal(document.__checkbaDraggedFile, undefined)
  assert.deepEqual(h.events, ['archive-drag-start'])
  h.listeners.get('mousemove')({ buttons: 0 })
  assert.equal(h.vm._dragEntry, null)
  assert.equal(h.listeners.size, 0)
  assert.deepEqual(h.events, ['archive-drag-start', 'archive-drag-end'])
})

for (const [name, start] of [
  ['false result', () => ({ ok: false })], ['throw', () => { throw new Error('synthetic') }],
  ['async false', () => Promise.resolve({ ok: false })], ['rejection', () => Promise.reject(new Error('synthetic'))],
]) {
  test(`archive native ${name} clears cancelled gesture and reports failure once`, async t => {
    const h = harness(t, start)
    h.vm.onDragStart(h.event, h.entry)
    await tick()
    assert.deepEqual(h.order, ['cancel', 'start'])
    assert.equal(document.__checkbaDraggedArchiveEntry, null)
    assert.equal(h.vm._dragEntry, null)
    assert.equal(h.listeners.size, 0)
    assert.deepEqual(h.events, ['archive-drag-start', 'archive-drag-end'])
    assert.equal(h.toasts.length, 1)
  })
}

test('late native failure does not finish or warn over a newer archive gesture', async t => {
  let reject
  let calls = 0
  const h = harness(t, () => ++calls === 1 ? new Promise((_, no) => { reject = no }) : { ok: true })
  h.vm.onDragStart(h.event, h.entry)
  h.vm.onDragStart(h.event, h.entry)
  const current = h.vm._dragEntry
  reject(new Error('old synthetic failure'))
  await tick()
  assert.equal(h.vm._dragEntry, current)
  assert.equal(document.__checkbaDraggedArchiveEntry, current)
  assert.ok(h.listeners.size)
  assert.equal(h.toasts.length, 0)
})

for (const mode of ['not-ready', 'no-native-host']) {
  test(`archive ${mode} keeps HTML copy available`, t => {
    const h = harness(t)
    if (mode === 'not-ready') h.vm.localPath = ''
    else delete h.host.fs.startDrag
    h.vm.onDragStart(h.event, h.entry)
    assert.deepEqual(h.order, [])
    assert.ok(h.data.has(ARCHIVE_ENTRY_MIME))
    assert.ok(h.vm._dragEntry)
  })
}
