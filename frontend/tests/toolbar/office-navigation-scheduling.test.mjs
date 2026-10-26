// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/OfficeNavigation.vue', import.meta.url), 'utf8')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function harness(kind = 'calc', handler = () => {}) {
  let url = 0
  const calls = [], events = []
  const component = new Function('URL', source.match(/<script>([\s\S]*?)<\/script>/)[1].replace('export default', 'return'))({
    createObjectURL: () => 'blob:' + ++url, revokeObjectURL: () => {},
  })
  const vm = { ...component.data(), kind, active: true, _generation: 0, _readSeq: 0, _rendered: {}, _disposed: false,
    $refs: {}, $nextTick: async () => {}, $t: key => key,
    $emit: (...args) => events.push(args), executor: { executeCommand: async (action, params, opts) => { calls.push({ action, params, opts }); return handler(action, params, opts) } },
  }
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  return { vm, component, calls, events }
}
const calcNavigation = (activeId = 'Sheet1', documentSeq = 1) => ({ success: true, kind: 'calc', documentSeq, activeId, items: ['Sheet1','Sheet2'].map(id => ({ id, name: id })) })
const impressNavigation = (activeId = 1, items = [1,2]) => ({ success: true, kind: 'impress', documentSeq: 1, activeId, items: items.map(id => ({ id })) })
const image = { success: true, kind: 'impress', documentSeq: 1, bytes: [137,80,78,71] }

test('eight rapid refreshes produce a single in-flight read plus one trailing re-read', async () => {
  const first = deferred()
  let reads = 0
  const h = harness('calc', () => ++reads === 1 ? first.promise : calcNavigation('Sheet2', 2))
  const pending = h.vm.refresh()
  for (let i = 0; i < 7; i++) h.vm.refresh()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.filter(c => c.action === 'office_get_navigation').length, 1, 'only one read may be in flight')
  first.resolve(calcNavigation())
  await pending
  assert.equal(h.calls.filter(c => c.action === 'office_get_navigation').length, 2, 'coalesced refreshes collapse into one trailing read')
})

test('activate consumes the manifest returned by the switch command without a second read', async () => {
  let selected = 1
  const h = harness('impress', action => action === 'office_activate_item' ? impressNavigation(selected) : impressNavigation(selected))
  await h.vm.refresh()
  selected = 2
  const readsBefore = h.calls.filter(c => c.action === 'office_get_navigation').length
  assert.equal(await h.vm.activate({ id: 2 }), true)
  assert.equal(h.vm.activeId, 2)
  assert.equal(h.calls.filter(c => c.action === 'office_get_navigation').length, readsBefore)
  assert.deepEqual(h.events, [['navigate']])
})

test('activate falls back to a merged read when the switch reply carries no manifest', async () => {
  let reads = 0
  const h = harness('calc', action => {
    if (action === 'office_activate_item') return { success: true }
    return calcNavigation(++reads === 1 ? 'Sheet1' : 'Sheet2')
  })
  await h.vm.refresh()
  assert.equal(await h.vm.activate({ id: 'Sheet2' }), true)
  assert.equal(h.vm.activeId, 'Sheet2')
  assert.equal(h.calls.filter(c => c.action === 'office_get_navigation').length, 2)
})

test('currentItem selection change only updates the active tab; itemCount change re-reads the manifest', async () => {
  const h = harness('calc', () => calcNavigation())
  await h.vm.refresh()
  const reads = h.calls.filter(c => c.action === 'office_get_navigation').length
  h.component.watch.currentItem.call(h.vm, { activeId: 'Sheet2', itemCount: 2 }, { activeId: 'Sheet1', itemCount: 2 })
  assert.equal(h.vm.activeId, 'Sheet2')
  assert.equal(h.calls.filter(c => c.action === 'office_get_navigation').length, reads, 'selection update must not read')
  h.component.watch.currentItem.call(h.vm, { activeId: 'Sheet2', itemCount: 3 }, { activeId: 'Sheet2', itemCount: 2 })
  clearTimeout(h.vm._refreshTimer)
  await h.vm.refresh()
  assert.ok(h.calls.filter(c => c.action === 'office_get_navigation').length > reads, 'itemCount change re-pulls the manifest')
})

test('contentKey invalidates only the current page; other thumbnails and their URLs survive', async () => {
  const h = harness('impress', action => action === 'slide_get_thumbnail' ? image : impressNavigation())
  h.vm.$refs.list = { clientHeight: 200, scrollTop: 0, querySelector: () => null, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }, { offsetTop: 100, offsetHeight: 100 }] }
  await h.vm.refresh()
  await new Promise(resolve => setTimeout(resolve, 10))
  const secondUrl = h.vm.thumbnails[2]
  const thumbnailsBefore = { ...h.vm.thumbnails }
  h.vm.currentItem = { activeId: 1, itemCount: 2 }
  h.component.watch.contentKey.call(h.vm)
  await new Promise(resolve => setTimeout(resolve, 250))
  const slideNumbers = h.calls.filter(c => c.action === 'slide_get_thumbnail').map(c => c.params.slideNumber)
  assert.deepEqual(slideNumbers, [1, 2, 1], 'only page 1 is re-rendered after its content changes')
  assert.equal(h.vm.thumbnails[2], secondUrl, 'untouched page keeps its blob URL')
  assert.notEqual(h.vm.thumbnails[1], thumbnailsBefore[1])
})

test('contentKey with an unknown active page falls back to full invalidation', async () => {
  const h = harness('impress', action => action === 'slide_get_thumbnail' ? image : impressNavigation())
  h.vm.$refs.list = { clientHeight: 200, scrollTop: 0, querySelector: () => null, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }, { offsetTop: 100, offsetHeight: 100 }] }
  await h.vm.refresh()
  await new Promise(resolve => setTimeout(resolve, 10))
  const generation = h.vm._generation
  h.vm.currentItem = { activeId: 99, itemCount: 2 }
  h.component.watch.contentKey.call(h.vm)
  clearTimeout(h.vm._refreshTimer)
  assert.ok(h.vm._generation > generation, 'unknown target invalidates every page')
})

for (const activeId of [1, 2]) {
  test(`editing slide 2 before its toolbar snapshot arrives refreshes its thumbnail (navigation still names ${activeId})`, async () => {
    const h = harness('impress', action => action === 'slide_get_thumbnail' ? image : impressNavigation(2, [1, 2, 3]))
    h.vm.documentSeq = 1
    h.vm.items = [{ id: 1 }, { id: 2 }, { id: 3 }]
    h.vm.activeId = activeId
    h.vm.currentItem = { activeId: 1, itemCount: 3 }
    h.vm._rendered = { 1: 0, 2: 0, 3: 0 }
    h.vm.thumbnails = { 1: 'blob:old1', 2: 'blob:old2', 3: 'blob:old3' }
    h.vm.canBackgroundWork = () => false
    h.vm.$refs.list = { clientHeight: 300, scrollTop: 0, querySelector: () => null,
      querySelectorAll: () => h.vm.items.map((_, i) => ({ offsetTop: i * 100, offsetHeight: 100 })) }
    // The worker has switched and modified slide 2; get_ui_state still describes slide 1.
    h.component.watch.contentKey.call(h.vm)
    clearTimeout(h.vm._refreshTimer)
    await h.vm.refresh()
    clearTimeout(h.vm._thumbRetryTimer)
    h.vm._thumbRetryTimer = null
    h.vm.canBackgroundWork = () => true
    await h.vm.loadVisibleThumbnails()
    assert.equal(h.vm.activeId, 2)
    assert.notEqual(h.vm.thumbnails[2], 'blob:old2', 'the edited page cannot keep its pre-edit image')
    assert.equal(h.vm.thumbnails[3], 'blob:old3', 'an unrelated cached page survives')
    assert.deepEqual(h.calls.filter(c => c.action === 'slide_get_thumbnail').map(c => c.params.slideNumber), [1, 2])
  })
}

test('a manifest requested before an edit cannot consume its pending thumbnail invalidation', async () => {
  const pending = deferred()
  let reads = 0
  const h = harness('impress', () => ++reads === 1 ? pending.promise : impressNavigation(2))
  h.vm.documentSeq = 1
  h.vm.items = [{ id: 1 }, { id: 2 }]
  h.vm.activeId = 1
  h.vm.currentItem = { activeId: 1, itemCount: 2 }
  h.vm._rendered = { 1: 0, 2: 0 }
  const oldRead = h.vm.refresh()
  h.component.watch.contentKey.call(h.vm)
  clearTimeout(h.vm._refreshTimer)
  h.vm.refresh()
  pending.resolve(impressNavigation(1))
  await oldRead
  assert.equal(reads, 2)
  assert.equal(h.vm.activeId, 2)
  assert.equal(h.vm._rendered[2], undefined, 'the fresh trailing manifest invalidates the actual edited page')
})

test('a changed structure manifest invalidates all thumbnails even when contentKey targeted one page', async () => {
  const pending = deferred()
  let items = [1, 2]
  const h = harness('impress', action => action === 'slide_get_thumbnail' ? pending.promise : impressNavigation(1, items))
  h.vm.$refs.list = { clientHeight: 200, scrollTop: 0, querySelector: () => null, querySelectorAll: () => items.map((_, i) => ({ offsetTop: i * 100, offsetHeight: 100 })) }
  await h.vm.refresh()
  h.vm.thumbnails = { 1: 'blob:old1', 2: 'blob:old2' }
  h.vm._rendered = { 1: h.vm._generation, 2: h.vm._generation }
  items = [1, 2, 3]
  await h.vm.refresh()
  assert.deepEqual(h.vm.thumbnails, {}, 'a structure change releases and clears every page')
  assert.deepEqual(h.vm._rendered, {})
  pending.resolve({ success: false })
  await new Promise(resolve => setTimeout(resolve, 10))
})

test('busy engine defers thumbnails with one retry instead of issuing commands or spinning', async () => {
  let busy = true
  const h = harness('impress', () => image)
  h.vm.canBackgroundWork = () => !busy
  h.vm.documentSeq = 1
  h.vm.items = [{ id: 1 }]
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 0, querySelector: () => null, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }] }
  h.vm.loadVisibleThumbnails()
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(h.calls.length, 0, 'no thumbnail command while background work is disallowed')
  busy = false
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(h.calls.map(c => c.params.slideNumber), [1], 'the 250ms retry resumes the batch')
  assert.deepEqual(h.calls[0].opts, { background: true }, 'allowed thumbnails are sent as background commands')
})

test('only one retry timer exists across repeated busy checks', async () => {
  let busy = true
  const h = harness('impress', () => image)
  h.vm.canBackgroundWork = () => !busy
  h.vm.documentSeq = 1
  h.vm.items = [{ id: 1 }]
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 0, querySelector: () => null, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }] }
  h.vm.loadVisibleThumbnails()
  await new Promise(resolve => setTimeout(resolve, 10))
  h.vm.loadVisibleThumbnails()
  await new Promise(resolve => setTimeout(resolve, 10))
  h.vm.loadVisibleThumbnails()
  await new Promise(resolve => setTimeout(resolve, 10))
  busy = false
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.deepEqual(h.calls.map(c => c.params.slideNumber), [1], 'retry collapse yields exactly one resumed batch')
})

test('visible detection uses geometry, not image-inflated rows, and prefetches one adjacent item', async () => {
  const h = harness('impress', () => image)
  h.vm.documentSeq = 1
  h.vm.items = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }))
  // Row heights are inflated the way an unsized img would do; the loop must still
  // trust viewport geometry and render only visible rows plus one.
  h.vm.$refs.list = { clientHeight: 100, scrollTop: 250, querySelectorAll: () => h.vm.items.map((_, i) => ({ offsetTop: i * 100, offsetHeight: 100 })) }
  h.vm.loadVisibleThumbnails()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(h.calls.map(c => c.params.slideNumber), [3,4,5], 'only rows overlapping the viewport plus one adjacent item render')
})

test('a stale generation cannot pollute a newer batch', async () => {
  const pending = deferred()
  let first = true
  const h = harness('impress', () => { if (first) { first = false; return pending.promise } return image })
  h.vm.documentSeq = 1
  h.vm.items = [{ id: 1 }, { id: 2 }]
  h.vm.$refs.list = { clientHeight: 200, scrollTop: 0, querySelector: () => null, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }, { offsetTop: 100, offsetHeight: 100 }] }
  const drawing = h.vm.loadVisibleThumbnails()
  h.vm.invalidateThumbnails()
  h.vm.active = false
  pending.resolve(image)
  await drawing
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(h.vm.thumbnails, {}, 'a late response from the old generation allocates nothing')
})

test('preview CSS pins the aspect box so image natural size cannot stretch rows', () => {
  const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1]
  const preview = style.match(/\.office-nav-preview \{[^}]*\}/)[0]
  const img = style.match(/\.office-nav-preview img \{[^}]*\}/)[0]
  assert.match(preview, /aspect-ratio:/)
  assert.match(preview, /overflow: hidden/)
  assert.match(img, /position: absolute/)
  assert.match(img, /inset: 0/)
})

test('editing a page during its thumbnail render discards the stale image and re-renders that page', async () => {
  const pending = deferred(); let draws = 0
  const h = harness('impress', () => ++draws === 1 ? pending.promise : image)
  h.vm.items = [{ id: 1 }]; h.vm.documentSeq = 1
  h.vm.$refs.list = { clientHeight: 200, scrollTop: 0, querySelectorAll: () => [{ offsetTop: 0, offsetHeight: 100 }] }
  const first = h.vm.loadVisibleThumbnails()
  h.vm.invalidateItem(1)
  pending.resolve(image); await first
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(draws, 2)
  assert.equal(h.vm.thumbnails[1], 'blob:1', 'the stale image must not allocate an object URL')
})
