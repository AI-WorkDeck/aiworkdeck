// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 演示文稿冷启动预览缓存：按字节指纹命中；抓取后台只读、可被打断；只留最近 40 份。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSlidePreviewCache, fingerprint, PREVIEW_SLIDES } from '../../src/composables/slidePreviewCache.js'

function mapStore() {
  const m = new Map()
  return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v) }, delete: async k => { m.delete(k) }, keys: async () => [...m.keys()] }
}
const fakeEngine = (calls) => async (action, params, opts) => {
  calls.push({ action, params, opts })
  return { success: true, width: params.width, height: Math.round(params.width * 9 / 16), bytes: new Uint8Array([params.slideNumber]) }
}

test('fingerprint changes with any byte, so an edited deck never shows the old slides', async () => {
  const a = await fingerprint(new Uint8Array([1, 2, 3]))
  assert.equal(a, await fingerprint(new Uint8Array([1, 2, 3]).buffer))
  assert.notEqual(a, await fingerprint(new Uint8Array([1, 2, 4])))
})

test('capture renders the first slides as background jpeg previews, then load hits', async () => {
  const store = mapStore(), calls = []
  const cache = createSlidePreviewCache({ store })
  assert.equal(await cache.load('k1'), null)
  assert.equal(await cache.capture(fakeEngine(calls), { key: 'k1', total: 7, documentSeq: 3 }), true)
  assert.equal(calls.length, PREVIEW_SLIDES)
  for (const c of calls) {
    assert.equal(c.action, 'slide_get_thumbnail')
    assert.equal(c.params.format, 'jpeg'); assert.equal(c.params.preview, true); assert.equal(c.params.documentSeq, 3)
    assert.equal(c.opts.background, true)
  }
  const hit = await cache.load('k1')
  assert.equal(hit.total, 7)
  assert.deepEqual(hit.slides.map(s => s.bytes[0]), [1, 2, 3])
  // already cached: no further engine work
  await cache.capture(fakeEngine(calls), { key: 'k1', total: 7, documentSeq: 3 })
  assert.equal(calls.length, PREVIEW_SLIDES)
})

test('capture stops as soon as the user is active again and stores nothing partial', async () => {
  const store = mapStore(), calls = []
  let active = false
  const engine = async (a, p, o) => { const r = await fakeEngine(calls)(a, p, o); active = true; return r }
  const cache = createSlidePreviewCache({ store })
  assert.equal(await cache.capture(engine, { key: 'k2', total: 5, isCurrent: () => !active }), false)
  assert.equal(calls.length, 1)
  assert.equal(await cache.load('k2'), null)
})

test('only the 40 most recently used decks are kept', async () => {
  const store = mapStore()
  let t = 0
  const cache = createSlidePreviewCache({ store, now: () => ++t })
  for (let i = 0; i < 45; i++) await cache.save('k' + i, [{ bytes: new Uint8Array([i]) }], 1)
  assert.equal(store.m.size, 40)
  assert.equal(store.m.has('k0'), false)
  assert.equal(store.m.has('k44'), true)
})
