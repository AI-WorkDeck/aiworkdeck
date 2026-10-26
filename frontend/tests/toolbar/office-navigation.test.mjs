// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDocMutatingAction } from '../../src/utils/docEvents.js'

const source = readFileSync(new URL('../../src/components/OfficeNavigation.vue', import.meta.url), 'utf8')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function harness(kind = 'calc', handler = () => {}) {
  const revoked = [], calls = [], events = []
  let url = 0
  const component = new Function('URL', source.match(/<script>([\s\S]*?)<\/script>/)[1].replace('export default', 'return'))({
    createObjectURL: () => 'blob:' + ++url, revokeObjectURL: value => revoked.push(value),
  })
  const vm = { ...component.data(), kind, active: true, _generation: 0, _readSeq: 0, _rendered: {}, _disposed: false,
    $refs: {}, $nextTick: async () => {}, $t: key => key,
    $emit: (...args) => events.push(args), executor: { executeCommand: async (action, params) => { calls.push({ action, params }); return handler(action, params) } },
  }
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  return { vm, component, calls, events, revoked }
}
const navigation = (activeId = 'Sheet1', documentSeq = 1) => ({ success: true, kind: 'calc', documentSeq, activeId, items: ['Sheet1','Sheet2'].map(id => ({ id, name: id })) })

test('navigation updates selected identity from the engine and never emits document changes', async () => {
  let selected = 'Sheet1'
  const h = harness('calc', (action, params) => {
    if (action === 'office_activate_item') selected = params.id
    return navigation(selected)
  })
  await h.vm.refresh()
  await h.vm.activate({ id: 'Sheet2' })
  assert.equal(h.vm.activeId, 'Sheet2')
  assert.deepEqual(h.calls.find(c => c.action === 'office_activate_item').params, { id: 'Sheet2', documentSeq: 1 })
  assert.deepEqual(h.events, [['navigate']])
  for (const action of ['office_get_navigation', 'office_activate_item', 'slide_get_thumbnail']) assert.equal(isDocMutatingAction(action), false)
})

test('failed navigation retains the selected tab and presents a persistent error', async () => {
  const h = harness('calc', action => action === 'office_activate_item' ? { success: false } : navigation())
  await h.vm.refresh()
  await h.vm.activate({ id: 'Sheet2' })
  assert.equal(h.vm.activeId, 'Sheet1')
  assert.match(h.vm.error, /switchFailed/)
  assert.deepEqual(h.events, [])
})

test('a late read cannot overwrite a newer document manifest', async () => {
  const old = deferred()
  let reads = 0
  const h = harness('calc', () => ++reads === 1 ? old.promise : navigation('Sheet2', 2))
  const first = h.vm.refresh()
  await h.vm.refresh()
  old.resolve(navigation())
  await first
  assert.equal(h.vm.documentSeq, 2)
  assert.equal(h.vm.activeId, 'Sheet2')
})

test('arrow and end keys activate actual tabs and focus them', async () => {
  let selected = 'Sheet1', focused = -1, prevented = 0
  const h = harness('calc', (action, params) => { if (action === 'office_activate_item') selected = params.id; return navigation(selected) })
  await h.vm.refresh()
  h.vm.$refs.list = { querySelector: () => null, querySelectorAll: () => [0,1].map(i => ({ focus: () => { focused = i } })) }
  await h.vm.onKey({ key: 'End', preventDefault: () => prevented++ }, 0)
  assert.equal(h.vm.activeId, 'Sheet2')
  assert.equal(focused, 1)
  assert.equal(prevented, 1)
})

test('thumbnail requests are limited to visible rows plus one adjacent item and do not run in background tabs', async () => {
  const h = harness('impress', () => ({ success: true, documentSeq: 1, bytes: [137,80,78,71] }))
  h.vm.documentSeq = 1
  h.vm.items = Array.from({ length: 60 }, (_, i) => ({ id: i + 1 }))
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 0, querySelectorAll: () => h.vm.items.map((_, i) => ({ offsetTop: i * 100, offsetHeight: 100 })) }
  await h.vm.loadVisibleThumbnails()
  assert.deepEqual(h.calls.map(c => c.params.slideNumber), [1,2])
  h.vm.active = false
  h.vm.$refs.list.scrollTop = 500
  await h.vm.loadVisibleThumbnails()
  assert.equal(h.calls.length, 2)
})

test('edits keep the previous image visible until a fresh preview replaces it, then release its URL', async () => {
  const h = harness('impress', () => ({ success: true, documentSeq: 1, bytes: [137,80,78,71] }))
  Object.assign(h.vm, { documentSeq: 1, items: [{ id: 1 }] })
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 0, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }] }
  await h.vm.loadVisibleThumbnails()
  assert.equal(h.vm.thumbnails[1], 'blob:1')
  h.vm.invalidateThumbnails()
  assert.equal(h.vm.thumbnails[1], 'blob:1')
  await h.vm.loadVisibleThumbnails()
  assert.equal(h.vm.thumbnails[1], 'blob:2')
  assert.deepEqual(h.revoked, ['blob:1'])
  h.vm.clearThumbnails()
  assert.deepEqual(h.revoked, ['blob:1','blob:2'])
})

test('late images after destruction are discarded without allocating blob URLs', async () => {
  const pending = deferred()
  const h = harness('impress', () => pending.promise)
  Object.assign(h.vm, { documentSeq: 1, items: [{ id: 1 }] })
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 0, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }] }
  const drawing = h.vm.loadVisibleThumbnails()
  h.vm._disposed = true
  h.vm.clearThumbnails()
  pending.resolve({ success: true, documentSeq: 1, bytes: [137,80,78,71] })
  await drawing
  assert.deepEqual(h.vm.thumbnails, {})
})

test('old executor rejection cannot mark or focus the replacement document', async () => {
  const pending = deferred()
  let focused = false
  const h = harness('calc', action => action === 'office_activate_item' ? pending.promise : navigation())
  await h.vm.refresh()
  h.vm.$refs.list = { querySelector: () => null, querySelectorAll: () => [{}, { focus: () => { focused = true } }] }
  const activating = h.vm.onKey({ key: 'End', preventDefault() {} }, 0)
  h.vm.executor = { executeCommand: async () => navigation('Sheet1', 2) }
  h.component.watch.executor.call(h.vm)
  clearTimeout(h.vm._refreshTimer)
  await h.vm.refresh()
  pending.resolve(Promise.reject(new Error('old executor disposed')))
  await activating
  assert.equal(h.vm.error, '')
  assert.equal(h.vm.activeId, 'Sheet1')
  assert.equal(focused, false)
})

test('scrolling back during an image request queues the newly visible rows', async () => {
  const pending = deferred()
  let first = true
  const image = { success: true, documentSeq: 1, bytes: [137,80,78,71] }
  const h = harness('impress', () => { if (first) { first = false; return pending.promise } return image })
  h.vm.documentSeq = 1
  h.vm.items = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }))
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 600, querySelectorAll: () => h.vm.items.map((_, i) => ({ offsetTop: i * 100, offsetHeight: 100 })) }
  const drawing = h.vm.loadVisibleThumbnails()
  h.vm.$refs.list.scrollTop = 0
  await h.vm.loadVisibleThumbnails()
  pending.resolve(image)
  await drawing
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(h.vm.thumbnails[1], 'first slide must load without requiring another scroll event')
})

test('clicking a failed preview retries it explicitly', async () => {
  let fail = true
  const h = harness('impress', action => action === 'slide_get_thumbnail'
    ? fail ? { success: false } : { success: true, documentSeq: 1, bytes: [137,80,78,71] }
    : { success: true, kind: 'impress', documentSeq: 1, activeId: 1, items: [{ id: 1 }] })
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 0, querySelector: () => null, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }] }
  await h.vm.refresh()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(h.vm.thumbnailErrors[1], true)
  fail = false
  await h.vm.activate(h.vm.items[0])
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(h.vm.thumbnails[1])
})

test('Enter and Space explicitly activate Uni tab buttons and secondary actions', async () => {
  let selected = 'Sheet1', prevented = 0
  const h = harness('calc', (action, params) => { if (action === 'office_activate_item') selected = params.id; return navigation(selected) })
  await h.vm.refresh()
  h.vm.$refs.list = { querySelector: () => null, querySelectorAll: () => [{ focus() {} }, { focus() {} }] }
  await h.vm.onKey({ key: 'Enter', preventDefault: () => prevented++ }, 1)
  assert.equal(h.vm.activeId, 'Sheet2')
  await h.vm.onKey({ key: ' ', preventDefault: () => prevented++ }, 0)
  assert.equal(h.vm.activeId, 'Sheet1')
  h.vm.onActionKey({ key: ' ', preventDefault: () => prevented++ }, 'add-sheet')
  assert.deepEqual(h.events.at(-1), ['add-sheet'])
  h.vm.error = 'failed'
  h.vm.onActionKey({ key: 'Enter', preventDefault: () => prevented++ }, 'retry')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(h.vm.error, '')
  assert.equal(prevented, 4)
})
