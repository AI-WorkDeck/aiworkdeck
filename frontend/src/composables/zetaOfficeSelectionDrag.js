// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// zetaOfficeSelectionDrag.js — Word-style mouse click-and-drag to move selected
// text on the LibreOffice WASM canvas (dev-board#1286).
//
// WHY: Qt5-WASM cannot enter a modal QDrag::exec() loop inside the browser
// sandbox. Pressing the left mouse button inside an active text selection on
// #qtcanvas and dragging the pointer causes Writer to collapse the existing
// selection and drag out a brand-new selection instead of moving the selected
// text to the drop position.
//
// HOW:
//   1. Whenever get_cursor_rect reports a non-collapsed selection with native
//      start/end caret geometry (selectionRects), we map those bounds into
//      canvas client rects (single-line box or 3-band multi-line polygon).
//   2. On capture-phase mousedown on #qtcanvas inside the selection bounds
//      (single left-click, no modifiers), we intercept the event before Qt sees
//      it so the selection stays intact while the user decides whether to click
//      or drag.
//   3. If mouseup occurs within 5px (plain click inside selection), we forward
//      a synthetic click to #qtcanvas so Qt collapses the cursor at that point
//      as normal.
//   4. If the pointer drags >= 5px and releases outside the selection bounds:
//      - stash_selection_for_drag captures the source range + XTransferable;
//      - a synthetic click at (upX, upY) lets Qt + Writer natively hit-test
//        the exact drop character;
//      - complete_selection_drag deletes the source and inserts the stashed
//        transferable at the drop position inside a single Undo context, then
//        re-selects the moved text at its new location (Word parity).

import { nativeCursorRectToPixels } from './zetaOfficeImeOverlay.js'

/**
 * Convert worker get_cursor_rect selectionRects ({ start, end }) to client-space
 * hit boxes over the canvas.
 * @param {object} raw result of get_cursor_rect
 * @param {{left:number,top:number,width:number,height:number}} surface canvas.getBoundingClientRect()
 * @returns {Array<{left:number,right:number,top:number,bottom:number,height:number}>}
 */
export function selectionClientRects(raw, surface) {
  if (!raw || raw.collapsed !== false || !raw.selectionRects || !surface) return []
  const { start, end } = raw.selectionRects
  if (!start || !end) return []
  const startPx = nativeCursorRectToPixels({ nativeCaret: start }, surface)
  const endPx = nativeCursorRectToPixels({ nativeCaret: end }, surface)
  if (!startPx || !endPx) return []

  const lineH = Math.max(startPx.height || 16, endPx.height || 16, 12)
  // Same line when start and end caret tops are within 60% of line height.
  if (Math.abs(endPx.top - startPx.top) <= lineH * 0.6) {
    const left = Math.min(startPx.left, endPx.left)
    const right = Math.max(startPx.left, endPx.left)
    const padX = Math.max(0, (4 - (right - left)) / 2)
    return [{
      left: left - padX,
      right: right + padX,
      top: Math.min(startPx.top, endPx.top) - 2,
      bottom: Math.max(startPx.top + startPx.height, endPx.top + endPx.height) + 2,
      height: lineH,
    }]
  }

  const [topPt, botPt] = startPx.top <= endPx.top ? [startPx, endPx] : [endPx, startPx]
  const scale = start.frameWidth > 0 ? surface.width / start.frameWidth : 1
  const vpLeft = start.viewport && Number.isFinite(start.viewport.x)
    ? (surface.left || 0) + start.viewport.x * scale
    : (surface.left || 0)
  const vpRight = start.viewport && Number.isFinite(start.viewport.width)
    ? vpLeft + start.viewport.width * scale
    : (surface.left || 0) + surface.width

  const boxes = []
  boxes.push({
    left: Math.min(topPt.left, vpRight),
    right: Math.max(topPt.left + 4, vpRight),
    top: topPt.top - 2,
    bottom: topPt.top + topPt.height + 2,
    height: topPt.height || lineH,
  })
  if (botPt.top > topPt.top + topPt.height + 2) {
    boxes.push({
      left: vpLeft,
      right: vpRight,
      top: topPt.top + topPt.height,
      bottom: botPt.top,
      height: lineH,
    })
  }
  boxes.push({
    left: Math.min(vpLeft, botPt.left),
    right: Math.max(vpLeft + 4, botPt.left),
    top: botPt.top - 2,
    bottom: botPt.top + botPt.height + 2,
    height: botPt.height || lineH,
  })
  return boxes
}

/**
 * Test whether client point (x, y) falls inside any selection client box.
 */
export function hitSelectionRects(x, y, boxes) {
  if (!Array.isArray(boxes) || !boxes.length || !Number.isFinite(x) || !Number.isFinite(y)) return false
  return boxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)
}

/**
 * Attach Word-style selected-text drag-and-drop move behavior to the LOWA canvas.
 */
export function attachSelectionDrag({ canvas, execute, onAfterDrop, onLog } = {}) {
  if (!canvas || typeof execute !== 'function') {
    return {
      updateFromCursorRaw() {},
      refreshSelection() {},
      invalidate() {},
      destroy() {},
    }
  }
  const doc = canvas.ownerDocument || document
  const win = doc.defaultView || window
  const forwarded = new WeakSet()

  const dropIndicator = doc.createElement('div')
  dropIndicator.setAttribute('data-lo-drag-caret', '')
  dropIndicator.setAttribute('aria-hidden', 'true')
  Object.assign(dropIndicator.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '2px',
    height: '18px',
    background: 'var(--awd-accent, #2563eb)',
    borderRadius: '1px',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '8',
  })
  ;(canvas.parentElement || doc.body || doc.documentElement).appendChild(dropIndicator)

  let cachedSelectionBoxes = []
  let cachedLineHeight = 18
  let pointerDown = false
  let dragState = null
  let refreshTimer = 0
  let refreshSeq = 0
  let disposed = false

  function hideIndicator() {
    dropIndicator.style.display = 'none'
    if (canvas.style.cursor === 'copy' || canvas.style.cursor === 'default') {
      canvas.style.cursor = ''
    }
  }

  function updateFromCursorRaw(raw) {
    if (disposed || dragState) return
    if (!raw || raw.collapsed !== false || !raw.selectionRects) {
      cachedSelectionBoxes = []
      if (!pointerDown && canvas.style.cursor === 'default') canvas.style.cursor = ''
      return
    }
    const surface = canvas.getBoundingClientRect()
    cachedSelectionBoxes = selectionClientRects(raw, surface)
    if (cachedSelectionBoxes.length > 0) {
      cachedLineHeight = cachedSelectionBoxes[0].height || 18
    }
  }

  function refreshSelection(delayMs = 35) {
    if (disposed || pointerDown || dragState) return
    clearTimeout(refreshTimer)
    const seq = ++refreshSeq
    refreshTimer = setTimeout(() => {
      refreshTimer = 0
      if (disposed || pointerDown || dragState) return
      Promise.resolve(execute('get_cursor_rect', {}))
        .then((raw) => {
          if (!disposed && seq === refreshSeq && !pointerDown && !dragState) {
            updateFromCursorRaw(raw)
          }
        })
        .catch(() => {})
    }, delayMs)
  }

  function invalidate() {
    refreshSeq++
    clearTimeout(refreshTimer)
    refreshTimer = 0
    cachedSelectionBoxes = []
    if (!dragState) hideIndicator()
  }

  function dispatchCanvasClick(clientX, clientY) {
    const down = new win.MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      detail: 1,
      view: win,
    })
    const up = new win.MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: 0,
      detail: 1,
      view: win,
    })
    forwarded.add(down)
    forwarded.add(up)
    canvas.dispatchEvent(down)
    canvas.dispatchEvent(up)
  }

  function onMouseDown(ev) {
    if (disposed || forwarded.has(ev) || ev.target !== canvas) return
    pointerDown = true
    clearTimeout(refreshTimer)
    refreshTimer = 0
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.detail > 1) {
      cachedSelectionBoxes = []
      return
    }
    if (!hitSelectionRects(ev.clientX, ev.clientY, cachedSelectionBoxes)) {
      cachedSelectionBoxes = []
      if (canvas.style.cursor === 'default') canvas.style.cursor = ''
      return
    }
    ev.preventDefault()
    ev.stopImmediatePropagation()
    dragState = {
      downX: ev.clientX,
      downY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      dragging: false,
      boxes: cachedSelectionBoxes.slice(),
      lineHeight: cachedLineHeight,
    }
  }

  function onMouseMove(ev) {
    if (disposed || forwarded.has(ev)) return
    if (!dragState) {
      if (!pointerDown && ev.target === canvas) {
        const hit = hitSelectionRects(ev.clientX, ev.clientY, cachedSelectionBoxes)
        if (hit && canvas.style.cursor !== 'default') canvas.style.cursor = 'default'
        else if (!hit && canvas.style.cursor === 'default') canvas.style.cursor = ''
      }
      return
    }
    ev.preventDefault()
    ev.stopImmediatePropagation()
    dragState.lastX = ev.clientX
    dragState.lastY = ev.clientY
    if (!dragState.dragging && Math.hypot(ev.clientX - dragState.downX, ev.clientY - dragState.downY) >= 5) {
      dragState.dragging = true
    }
    if (dragState.dragging) {
      const inside = hitSelectionRects(ev.clientX, ev.clientY, dragState.boxes)
      canvas.style.cursor = inside ? 'default' : 'copy'
      if (inside) {
        dropIndicator.style.display = 'none'
      } else {
        const h = Math.round(dragState.lineHeight || 18)
        Object.assign(dropIndicator.style, {
          display: 'block',
          left: Math.round(ev.clientX) + 'px',
          top: Math.round(ev.clientY - h / 2) + 'px',
          height: h + 'px',
        })
      }
    }
  }

  function onMouseUp(ev) {
    if (disposed || forwarded.has(ev)) return
    pointerDown = false
    if (!dragState) {
      if (ev.target === canvas && ev.button === 0) {
        refreshSelection(60)
      }
      return
    }
    const state = dragState
    dragState = null
    hideIndicator()
    ev.preventDefault()
    ev.stopImmediatePropagation()

    const upX = Number.isFinite(ev.clientX) ? ev.clientX : state.lastX
    const upY = Number.isFinite(ev.clientY) ? ev.clientY : state.lastY

    if (!state.dragging) {
      cachedSelectionBoxes = []
      dispatchCanvasClick(upX, upY)
      return
    }

    if (hitSelectionRects(upX, upY, state.boxes)) {
      if (typeof onAfterDrop === 'function') {
        onAfterDrop({ success: true, moved: false, reason: 'inside-source-box' })
      }
      return
    }

    cachedSelectionBoxes = []
    ;(async () => {
      try {
        const stashed = await execute('stash_selection_for_drag', {})
        if (!stashed || !stashed.success) {
          dispatchCanvasClick(upX, upY)
          return
        }
        dispatchCanvasClick(upX, upY)
        await new Promise((r) => setTimeout(r, 35))
        let res = null
        for (let attempt = 0; attempt < 5; attempt++) {
          res = await execute('complete_selection_drag', { force: attempt === 4 })
          if (!res || !res.pendingClick) break
          await new Promise((r) => setTimeout(r, 35))
        }
        if (typeof onAfterDrop === 'function') onAfterDrop(res)
        refreshSelection(40)
      } catch (err) {
        if (typeof onLog === 'function') onLog('selection drag error: ' + (err && err.message || err))
      }
    })()
  }

  function onKeyDown() {
    if (dragState) {
      dragState = null
      hideIndicator()
    }
    cachedSelectionBoxes = []
  }

  function onBlur() {
    pointerDown = false
    if (dragState) {
      dragState = null
      hideIndicator()
    }
  }

  const viewportKey = () => {
    const r = canvas.getBoundingClientRect()
    return [win.innerWidth, win.innerHeight, r.left, r.top, r.width, r.height].join(':')
  }
  let lastViewport = viewportKey()
  function onResize() {
    const next = viewportKey()
    if (next === lastViewport) return
    lastViewport = next
    invalidate()
    refreshSelection(60)
  }

  doc.addEventListener('mousedown', onMouseDown, true)
  doc.addEventListener('mousemove', onMouseMove, true)
  doc.addEventListener('mouseup', onMouseUp, true)
  doc.addEventListener('keydown', onKeyDown, true)
  canvas.addEventListener('wheel', invalidate, { passive: true })
  win.addEventListener('resize', onResize)
  win.addEventListener('blur', onBlur)

  return {
    updateFromCursorRaw,
    refreshSelection,
    invalidate,
    destroy() {
      disposed = true
      invalidate()
      doc.removeEventListener('mousedown', onMouseDown, true)
      doc.removeEventListener('mousemove', onMouseMove, true)
      doc.removeEventListener('mouseup', onMouseUp, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      canvas.removeEventListener('wheel', invalidate)
      win.removeEventListener('resize', onResize)
      win.removeEventListener('blur', onBlur)
      dropIndicator.remove()
    },
  }
}
