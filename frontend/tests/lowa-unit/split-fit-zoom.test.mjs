// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 分屏开合后按窗格宽度适配缩放（set_zoom{fit:'width'}）：只缩不放、上限是用户自己定的
// 缩放、用户手动改过就以手动值为准、换文档作废。假 ViewSettings 模拟 LO 的「页宽」
// 自动模式：切到 PAGE_WIDTH 时按当前窗格宽度算出 ZoomValue。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const method = source.slice(source.indexOf('  set_zoom(p) {'), source.indexOf('  // ---- [主题] 纸外工作区配色'))
const BY_VALUE = 3, PAGE_WIDTH = 2
// 页面在 100% 下占 800px：窗格 1600px 时页宽适配是 200%，800px 时 100%，560px 时 70%。
const fitFor = (paneWidth) => Math.round(paneWidth / 800 * 100)

function harness({ writer = true, zoom = 100, paneWidth = 1600 } = {}) {
  const state = { ZoomType: BY_VALUE, ZoomValue: zoom }
  const view = {
    getPropertyValue(name) { return state[name] },
    setPropertyValue(name, any) {
      const value = any.short
      state[name] = value
      if (name === 'ZoomType' && value === PAGE_WIDTH) state.ZoomValue = fitFor(ctx.paneWidth)
    },
  }
  const model = { writer }
  const ctx = vm.createContext({
    paneWidth, xModel: model, zoomPref: { model: null, value: 100 },
    ctrl: { getViewSettings: () => view },
    isWriterDoc: () => ctx.xModel.writer,
    shortAny: (v) => ({ short: v }),
    css: { view: { DocumentZoomType: { BY_VALUE, PAGE_WIDTH } } },
    ZOOM_MIN: 20, ZOOM_MAX: 600, errStr: String,
  })
  const setZoom = vm.runInContext(`({ ${method} }).set_zoom`, ctx)
  return {
    ctx, state,
    fit(width) { ctx.paneWidth = width; return setZoom({ fit: 'width' }) },
    set: (p) => setZoom(p),
  }
}

test('分屏：窗格变窄放不下整页 → 缩到页宽；关分屏 → 回到分屏前的缩放', () => {
  const h = harness({ zoom: 100, paneWidth: 1600 })
  const split = h.fit(560)
  assert.deepEqual([split.success, split.zoom, split.fitted], [true, 70, true])
  assert.equal(h.state.ZoomType, BY_VALUE, '适配完回到 BY_VALUE，之后不跟着窗口持续变')
  const unsplit = h.fit(1600)
  assert.equal(unsplit.zoom, 100, '宽窗格不放大到 200%，回到用户原来的 100%')
})

test('页面本来就放得下：不动缩放', () => {
  const h = harness({ zoom: 90, paneWidth: 1600 })
  assert.equal(h.fit(800).zoom, 90)
  assert.equal(h.fit(1600).zoom, 90)
})

test('分屏后用户手动改了缩放：以手动值为准，下一次开合才再适配', () => {
  const h = harness({ zoom: 100, paneWidth: 1600 })
  assert.equal(h.fit(560).zoom, 70)
  assert.equal(h.set({ value: 120 }).zoom, 120)
  assert.equal(h.state.ZoomValue, 120)
  assert.equal(h.fit(1600).zoom, 120, '关分屏回到手动定的 120%，不是分屏前的 100%')
  assert.equal(h.fit(560).zoom, 70)
  assert.equal(h.set({ delta: -10 }).zoom, 60)
  assert.equal(h.fit(1600).zoom, 60)
})

test('只读查询（无参 set_zoom）不改记住的缩放', () => {
  const h = harness({ zoom: 100, paneWidth: 1600 })
  h.fit(560)
  assert.equal(h.set({}).zoom, 70)
  assert.equal(h.fit(1600).zoom, 100)
})

test('换了文档：上一份的缩放作废，以新文档打开时的缩放为准', () => {
  const h = harness({ zoom: 100, paneWidth: 1600 })
  h.set({ value: 150 })
  h.ctx.xModel = { writer: true }
  h.state.ZoomValue = 80
  assert.equal(h.fit(560).zoom, 70)
  assert.equal(h.fit(1600).zoom, 80)
})

test('非 Writer（Calc / Impress）不动缩放', () => {
  const h = harness({ writer: false, zoom: 100, paneWidth: 1600 })
  const r = h.fit(560)
  assert.deepEqual([r.success, r.zoom, r.fitted], [true, 100, false])
  assert.deepEqual(h.state, { ZoomType: BY_VALUE, ZoomValue: 100 })
})
