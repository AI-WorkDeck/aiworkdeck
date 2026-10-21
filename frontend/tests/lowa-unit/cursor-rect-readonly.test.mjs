// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const method = source.slice(source.indexOf('  get_cursor_rect('), source.indexOf('  // 选中文字鼠标点击拖拽移动'))

function harness({ collapsed = false } = {}) {
  const moves = [], nativeReads = [], endpointReads = []
  const view = { top: 9600 }
  const cursor = {
    getPosition: () => ({ X: 1200, Y: 10300 }),
    getPropertyValue: () => 12,
    getString: () => collapsed ? '' : '跨页选区',
    gotoRange(range) { moves.push(range); view.top = range.top },
  }
  const frame = { getComponentWindow: () => ({ getPosSize: () => ({ X: 0, Y: 0, Width: 900, Height: 700 }) }) }
  const liveViewData = 'live-view-data'
  const nativeCaret = { x: 80, y: 120, height: 16 }
  const selectionRects = { start: { x: 80, y: -700, height: 16 }, end: nativeCaret }
  const run = vm.runInNewContext(`({ ${method} }).get_cursor_rect`, {
    isWriterDoc: () => true,
    errStr: String,
    xModel: {},
    ctrl: {
      getViewCursor: () => cursor,
      getViewSettings: () => ({ getPropertyValue: () => 100 }),
      getFrame: () => frame,
      getViewData: () => liveViewData,
    },
    readNativeCaretRect(...args) { nativeReads.push(args); return nativeCaret },
    readSelectionCaretRects(...args) {
      endpointReads.push(args)
      // Model the endpoint reader's observable cursor/scroll side effect.
      args[1].gotoRange({ top: 0 })
      return selectionRects
    },
  })
  return { run, moves, view, nativeReads, endpointReads, frame, cursor, liveViewData, nativeCaret, selectionRects }
}

test('background caret reads preserve the scrolled selection and still return native caret geometry', () => {
  const h = harness()
  for (const params of [undefined, {}, { selectionRects: false }, { selectionRects: 1 }]) {
    const result = h.run(params)
    assert.equal(result.success, true)
    assert.equal(result.collapsed, false)
    assert.equal(result.nativeCaret, h.nativeCaret)
    assert.equal(result.selectionRects, undefined)
    assert.equal(result.pos.Y, 10300)
    assert.equal(h.view.top, 9600)
  }
  assert.deepEqual(h.moves, [])
  assert.deepEqual(h.endpointReads, [])
  assert.equal(h.nativeReads.length, 4)
  for (const args of h.nativeReads) assert.deepEqual(args, [h.frame, h.liveViewData, 12])
})

test('explicit selection endpoint request returns geometry from the native selection reader', () => {
  const h = harness()
  const result = h.run({ selectionRects: true })
  assert.equal(result.nativeCaret, h.nativeCaret)
  assert.equal(result.selectionRects, h.selectionRects)
  assert.deepEqual(h.endpointReads, [[h.frame, h.cursor, 12]])
  assert.equal(h.moves.length, 1)
  assert.equal(h.view.top, 0)
})

test('collapsed caret never invokes endpoint traversal, even when explicitly requested', () => {
  const h = harness({ collapsed: true })
  const result = h.run({ selectionRects: true })
  assert.equal(result.collapsed, true)
  assert.equal(result.nativeCaret, h.nativeCaret)
  assert.equal(result.selectionRects, undefined)
  assert.deepEqual(h.endpointReads, [])
  assert.deepEqual(h.moves, [])
  assert.equal(h.view.top, 9600)
})
