// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { selectionClientRects, hitSelectionRects, attachSelectionDrag } from '../../src/composables/zetaOfficeSelectionDrag.js'

const surface = { left: 10, top: 20, width: 1000, height: 676 }
const singleLineRaw = {
  success: true,
  collapsed: false,
  selectionRects: {
    start: { x: 175, y: 198, height: 16, frameWidth: 1000, frameHeight: 676, viewport: { x: 0, y: 104, width: 937, height: 544 } },
    end: { x: 203, y: 198, height: 16, frameWidth: 1000, frameHeight: 676, viewport: { x: 0, y: 104, width: 937, height: 544 } },
  },
}

test('selectionClientRects maps single-line selection to a single client rect', () => {
  const boxes = selectionClientRects(singleLineRaw, surface)
  assert.equal(boxes.length, 1)
  assert.equal(boxes[0].left, 185)
  assert.equal(boxes[0].right, 213)
  assert.equal(boxes[0].top, 216)
  assert.equal(boxes[0].bottom, 236)
  assert.equal(hitSelectionRects(195, 225, boxes), true)
  assert.equal(hitSelectionRects(150, 225, boxes), false)
})

test('selectionClientRects maps multi-line selection to upper, middle, and lower line bands', () => {
  const multiRaw = {
    success: true,
    collapsed: false,
    selectionRects: {
      start: { x: 300, y: 198, height: 16, frameWidth: 1000, frameHeight: 676, viewport: { x: 100, y: 104, width: 800, height: 544 } },
      end: { x: 220, y: 246, height: 16, frameWidth: 1000, frameHeight: 676, viewport: { x: 100, y: 104, width: 800, height: 544 } },
    },
  }
  const boxes = selectionClientRects(multiRaw, surface)
  assert.equal(boxes.length, 3)
  // Upper line right of x=310
  assert.equal(hitSelectionRects(450, 225, boxes), true)
  // Middle band across viewport
  assert.equal(hitSelectionRects(200, 250, boxes), true)
  // Lower line left of x=230
  assert.equal(hitSelectionRects(180, 274, boxes), true)
  // Lower line right of end caret is outside selection
  assert.equal(hitSelectionRects(500, 274, boxes), false)
})

test('attachSelectionDrag: dragging selected text outside selection stashes, clicks drop target, and completes move', async (t) => {
  const dom = new JSDOM('<div><canvas id="qtcanvas"></canvas></div>', { pretendToBeVisual: true })
  const { window } = dom
  const canvas = window.document.getElementById('qtcanvas')
  canvas.getBoundingClientRect = () => surface

  const executed = []
  const canvasClicks = []
  let afterDropResult = null
  canvas.addEventListener('mousedown', (e) => canvasClicks.push({ type: 'mousedown', x: e.clientX, y: e.clientY }))
  canvas.addEventListener('mouseup', (e) => canvasClicks.push({ type: 'mouseup', x: e.clientX, y: e.clientY }))

  const drag = attachSelectionDrag({
    canvas,
    execute: async (action, params) => {
      executed.push({ action, params })
      if (action === 'stash_selection_for_drag') return { success: true, text: '应当' }
      if (action === 'complete_selection_drag') return { success: true, moved: true, text: '应当' }
      if (action === 'get_cursor_rect') return singleLineRaw
      return { success: true }
    },
    onAfterDrop: (res) => { afterDropResult = res },
  })
  t.after(() => { drag.destroy(); window.close() })

  drag.updateFromCursorRaw(singleLineRaw)

  // Press inside selection (195, 225) -> intercepted so Qt does not collapse selection
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 195, clientY: 225, button: 0, buttons: 1, detail: 1 }))
  assert.equal(canvasClicks.length, 0, 'initial mousedown inside selection must be intercepted before Qt')

  // Drag to (280, 225) outside selection
  canvas.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 280, clientY: 225, button: 0, buttons: 1 }))
  const indicator = window.document.querySelector('[data-lo-drag-caret]')
  assert.equal(indicator.style.display, 'block', 'drop caret indicator shown during drag')

  // Release at (280, 225)
  canvas.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 280, clientY: 225, button: 0, buttons: 0, detail: 1 }))
  await new Promise((r) => setTimeout(r, 90))

  assert.equal(executed[0].action, 'stash_selection_for_drag')
  assert.deepEqual(canvasClicks, [
    { type: 'mousedown', x: 280, y: 225 },
    { type: 'mouseup', x: 280, y: 225 },
  ])
  assert.equal(executed[1].action, 'complete_selection_drag')
  assert.equal(afterDropResult?.moved, true)
})

test('attachSelectionDrag: plain click inside selection without dragging forwards click to collapse cursor', (t) => {
  const dom = new JSDOM('<div><canvas id="qtcanvas"></canvas></div>', { pretendToBeVisual: true })
  const { window } = dom
  const canvas = window.document.getElementById('qtcanvas')
  canvas.getBoundingClientRect = () => surface

  const executed = []
  const canvasClicks = []
  canvas.addEventListener('mousedown', (e) => canvasClicks.push({ type: 'mousedown', x: e.clientX, y: e.clientY }))
  canvas.addEventListener('mouseup', (e) => canvasClicks.push({ type: 'mouseup', x: e.clientX, y: e.clientY }))

  const drag = attachSelectionDrag({
    canvas,
    execute: async (action, params) => { executed.push({ action, params }); return { success: true } },
  })
  t.after(() => { drag.destroy(); window.close() })

  drag.updateFromCursorRaw(singleLineRaw)
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 195, clientY: 225, button: 0, buttons: 1, detail: 1 }))
  canvas.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 196, clientY: 225, button: 0, buttons: 0, detail: 1 }))

  assert.deepEqual(canvasClicks, [
    { type: 'mousedown', x: 196, y: 225 },
    { type: 'mouseup', x: 196, y: 225 },
  ])
  assert.equal(executed.some((c) => c.action === 'stash_selection_for_drag'), false)
})

test('attachSelectionDrag: synthetic LOWA resize heartbeats with unchanged viewport do not wipe cached selection boxes', (t) => {
  const dom = new JSDOM('<div><canvas id="qtcanvas"></canvas></div>', { pretendToBeVisual: true })
  const { window } = dom
  const canvas = window.document.getElementById('qtcanvas')
  canvas.getBoundingClientRect = () => surface

  const canvasClicks = []
  canvas.addEventListener('mousedown', (e) => canvasClicks.push(e))

  const drag = attachSelectionDrag({
    canvas,
    execute: async () => ({ success: true }),
  })
  t.after(() => { drag.destroy(); window.close() })

  drag.updateFromCursorRaw(singleLineRaw)
  // Emit synthetic resize with identical viewport
  window.dispatchEvent(new window.Event('resize'))
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 195, clientY: 225, button: 0, buttons: 1, detail: 1 }))
  assert.equal(canvasClicks.length, 0, 'mousedown inside selection still intercepted after unchanged resize heartbeat')
})

test('attachSelectionDrag: consecutive drops within 16px emit a reset click at drag origin to prevent Qt5-WASM timestamp=0 double-click word selection', async (t) => {
  const dom = new JSDOM('<div><canvas id="qtcanvas"></canvas></div>', { pretendToBeVisual: true })
  const { window } = dom
  const canvas = window.document.getElementById('qtcanvas')
  canvas.getBoundingClientRect = () => surface

  const canvasClicks = []
  canvas.addEventListener('mousedown', (e) => canvasClicks.push({ x: e.clientX, y: e.clientY }))

  const drag = attachSelectionDrag({
    canvas,
    execute: async (action) => {
      if (action === 'stash_selection_for_drag') return { success: true, text: '应当' }
      if (action === 'complete_selection_drag') return { success: true, moved: true, text: '应当' }
      return singleLineRaw
    },
  })
  t.after(() => { drag.destroy(); window.close() })

  // First drag from (195, 225) to (280, 225)
  drag.updateFromCursorRaw(singleLineRaw)
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 195, clientY: 225, button: 0, buttons: 1, detail: 1 }))
  canvas.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 280, clientY: 225, button: 0, buttons: 1 }))
  canvas.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 280, clientY: 225, button: 0, buttons: 0, detail: 1 }))
  await new Promise((r) => setTimeout(r, 90))
  assert.deepEqual(canvasClicks, [{ x: 280, y: 225 }])

  // Second drag from (195, 225) to the same (280, 225)
  drag.updateFromCursorRaw(singleLineRaw)
  canvas.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 195, clientY: 225, button: 0, buttons: 1, detail: 1 }))
  canvas.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 280, clientY: 225, button: 0, buttons: 1 }))
  canvas.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 280, clientY: 225, button: 0, buttons: 0, detail: 1 }))
  await new Promise((r) => setTimeout(r, 90))
  assert.deepEqual(canvasClicks, [
    { x: 280, y: 225 },
    { x: 195, y: 225 },
    { x: 280, y: 225 },
  ])
})

