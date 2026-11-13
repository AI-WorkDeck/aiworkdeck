// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// O13：文件预览 / QuickLook 里的演示文稿改由引擎逐页渲染（FilePreview.renderPptx + 工作台 renderSlidesForPreview），
// 前端 pptx-preview 只在没有引擎时兜底。抠出生产方法真跑，外部依赖用桩。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isEncryptedOoxml } from '../../src/utils/editorLoadFailure.js'

const PREVIEW = readFileSync(new URL('../../src/components/FilePreview.vue', import.meta.url), 'utf8')
const POOL = readFileSync(new URL('../../src/pages/project-overview/librePool.js', import.meta.url), 'utf8')
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j) }

const PPTX = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4])
const CFB = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
const deck = (n, total = n) => ({ slides: Array.from({ length: n }, (_, i) => ({ bytes: new Uint8Array([i]), width: 1280, height: 720 })), total })

function previewHarness({ file, bytes = PPTX, renderSlides = null, cached = null }) {
  const calls = { shown: [], pptxPreview: 0, errors: [] }
  const body = between(PREVIEW, '    async renderPptx() {', '    getMimeType(fileType) {')
    .replace("await import('pptx-preview')", 'await __pptxPreview()')
  const methods = new Function('createSlidePreviewCache', 'fingerprint', 'renderSlideCards', 'isEncryptedOoxml', '__pptxPreview', 'URL', 'console', `return ({${body}})`)(
    () => ({ load: async () => cached }), async () => 'key',
    (container, d, more) => { calls.shown.push({ count: d.slides.length, more }); return ['blob:' + calls.shown.length] },
    isEncryptedOoxml,
    async () => ({ init: () => ({ preview: async () => { calls.pptxPreview++ } }) }),
    { revokeObjectURL() {} }, { error: (...a) => calls.errors.push(a) },
  )
  const container = { innerHTML: '', clientWidth: 900 }
  const vm = {
    file, renderSlides, pptxLoading: false, pptxRenderFailed: false,
    $refs: { pptxContainer: container }, $nextTick: async () => {}, $t: (k, p) => k + (p ? JSON.stringify(p) : ''),
    fetchAuthedBlob: async () => new Blob([bytes]),
  }
  for (const [name, fn] of Object.entries(methods)) vm[name] = fn.bind(vm)
  return { vm, calls }
}

test('有引擎：显示引擎渲染的全部页，不再走前端 pptx-preview', async () => {
  const seen = []
  const { vm, calls } = previewHarness({ file: { id: 1, name: '课件.pptx', fileType: 'pptx' }, renderSlides: async (buf, name) => { seen.push(name); return deck(5) } })
  await vm.renderPptx()
  assert.deepEqual(seen, ['课件.pptx'])
  assert.deepEqual(calls.shown, [{ count: 5, more: '' }])
  assert.equal(calls.pptxPreview, 0)
  assert.equal(vm.pptxRenderFailed, false)
  assert.equal(vm.pptxLoading, false)
})

test('上次编辑器缓存过同一份字节：先瞬时显示缓存页，再换成引擎完整渲染；超过上限的页数给提示', async () => {
  const { vm, calls } = previewHarness({ file: { id: 1, name: 'a.pptx', fileType: 'pptx' }, cached: deck(3, 60), renderSlides: async () => deck(40, 60) })
  await vm.renderPptx()
  assert.deepEqual(calls.shown.map(s => s.count), [3, 40])
  assert.match(calls.shown[1].more, /slidesNotShown.*20/)
})

test('拿不到引擎（renderSlides 回 null 或没有）：.pptx 退回前端渲染，.ppt 落占位', async () => {
  const a = previewHarness({ file: { id: 1, name: 'a.pptx', fileType: 'pptx' }, renderSlides: async () => null })
  await a.vm.renderPptx()
  assert.equal(a.calls.pptxPreview, 1)
  const b = previewHarness({ file: { id: 2, name: 'b.pptx', fileType: 'pptx' } })
  await b.vm.renderPptx()
  assert.equal(b.calls.pptxPreview, 1)
  const c = previewHarness({ file: { id: 3, name: 'c.ppt', fileType: 'ppt' }, bytes: CFB, renderSlides: async () => null })
  await c.vm.renderPptx()
  assert.equal(c.calls.pptxPreview, 0)
  assert.equal(c.vm.pptxRenderFailed, true)
})

test('设了打开密码的演示文稿：预览不借引擎、不问密码，直接落占位', async () => {
  let asked = 0
  const { vm, calls } = previewHarness({ file: { id: 1, name: 'locked.pptx', fileType: 'pptx' }, bytes: CFB, renderSlides: async () => { asked++; return deck(1) } })
  await vm.renderPptx()
  assert.equal(asked, 0)
  assert.equal(calls.pptxPreview, 0)
  assert.equal(vm.pptxRenderFailed, true)
})

test('渲染途中换了文件：迟到的结果不显示到新文件上', async () => {
  let release
  const gate = new Promise(r => { release = r })
  const { vm, calls } = previewHarness({ file: { id: 1, name: 'a.pptx', fileType: 'pptx' }, renderSlides: () => gate.then(() => deck(2)) })
  const pending = vm.renderPptx()
  await new Promise(r => setTimeout(r, 0))
  vm.file = { id: 2, name: 'b.pptx', fileType: 'pptx' }
  release()
  await pending
  assert.deepEqual(calls.shown, [])
  assert.equal(calls.pptxPreview, 0)
})

// ---- 工作台：借隐藏引擎渲染 ----
function poolHarness(run) {
  const body = between(POOL, '    async renderSlidesForPreview(', '    releaseLibreHiddenInstance(handle) {')
  const methods = new Function('console', `return ({${body}})`)({ warn() {} })
  const released = []
  const vm = {
    acquireLibreHiddenInstance: async ({ isCancelled }) => (isCancelled() ? null : { run, _spare: { key: 1 } }),
    releaseLibreHiddenInstance: (h) => released.push(h),
  }
  vm.renderSlidesForPreview = methods.renderSlidesForPreview.bind(vm)
  return { vm, released }
}

test('工作台渲染：装载 → 逐页取图（上限 maxSlides）→ 无论成败都归还引擎', async () => {
  const calls = []
  const run = async (action, p) => {
    calls.push(action)
    if (action === 'load_document') return { success: true }
    if (action === 'office_get_navigation') return { success: true, items: new Array(5).fill({}), documentSeq: 9 }
    if (action === 'slide_get_thumbnail') { assert.equal(p.documentSeq, 9); assert.equal(p.preview, true); return { success: true, bytes: [p.slideNumber], width: 1280, height: 720 } }
  }
  const { vm, released } = poolHarness(run)
  const out = await vm.renderSlidesForPreview(new ArrayBuffer(4), 'x.pptx', { maxSlides: 3 })
  assert.equal(out.total, 5)
  assert.deepEqual(out.slides.map(s => [...s.bytes]), [[1], [2], [3]])
  assert.equal(released.length, 1)

  const failing = poolHarness(async (action) => (action === 'load_document' ? { success: false } : null))
  assert.equal(await failing.vm.renderSlidesForPreview(new ArrayBuffer(4), 'bad.pptx'), null)
  assert.equal(failing.released.length, 1, '装载失败也要归还引擎')
})

test('工作台渲染：新的预览请求作废上一份，上一份停在下一页前并归还引擎', async () => {
  let unblock
  const block = new Promise(r => { unblock = r })
  let thumbs = 0
  const run = async (action) => {
    if (action === 'load_document') return { success: true }
    if (action === 'office_get_navigation') return { success: true, items: new Array(10).fill({}), documentSeq: 1 }
    thumbs++
    if (thumbs === 1) await block
    return { success: true, bytes: [1], width: 1, height: 1 }
  }
  const { vm, released } = poolHarness(run)
  const first = vm.renderSlidesForPreview(new ArrayBuffer(4), 'a.pptx')
  await new Promise(r => setTimeout(r, 0))
  const second = vm.renderSlidesForPreview(new ArrayBuffer(4), 'b.pptx', { maxSlides: 2 })
  unblock()
  assert.equal(await first, null)
  assert.equal((await second).slides.length, 2)
  assert.equal(released.length, 2)
})
