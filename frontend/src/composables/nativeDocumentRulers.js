// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const HANDLES = [
  ['leftMargin', '左页边距', 'x', 0], ['rightMargin', '右页边距', 'x', 0],
  ['firstLineIndent', '首行缩进', 'x', 7], ['leftIndent', '段落左缩进', 'x', 14], ['rightIndent', '段落右缩进', 'x', 14],
  ['topMargin', '上页边距', 'y', 0], ['bottomMargin', '下页边距', 'y', 0],
]
const reversed = key => ['rightMargin', 'rightIndent', 'bottomMargin'].includes(key)
const fields = ['pageIndex', 'pageWidth', 'pageHeight', ...HANDLES.map(([key]) => key)]

// State is read from Writer; a drag is only a preview until pointerup. Every
// gesture obtains a fresh token, which the engine checks and consumes once.
export function attachNativeDocumentRulers({ element, horizontal, vertical, input, execute, model, viewport, canWrite }) {
  const doc = element.ownerDocument, win = doc.defaultView
  let state = null, drag = null, disposed = false, serial = 0, timer, noticeTimer, reading = false, writing = false
  const notice = doc.createElement('div'); notice.dataset.nativeRulerNotice = ''; notice.hidden = true; notice.setAttribute('role', 'status')
  Object.assign(notice.style, { position: 'absolute', top: '24px', left: '24px', right: '24px', padding: '6px 10px', zIndex: '4', background: 'var(--awd-surface)', color: 'var(--awd-text)', border: '1px solid var(--awd-border)', pointerEvents: 'none' })
  element.appendChild(notice)
  const visible = () => model()?.view?.ruler || model()?.view?.verticalRuler
  const editable = () => !disposed && !writing && canWrite() && !input.getState().composing
  const valid = value => value?.available === true && typeof value.contextToken === 'string' && fields.every(key => Number.isFinite(value[key]))
  function message() { notice.textContent = '标尺未能应用，位置可能已变化，请重试。'; notice.style.top = (element.scrollTop + 24) + 'px'; notice.hidden = false; win.clearTimeout(noticeTimer); noticeTimer = win.setTimeout(() => { notice.hidden = true }, 3500) }
  function position(key, value = state?.[key]) {
    if (key === 'leftMargin' || key === 'topMargin') return value
    if (key === 'rightMargin') return state.pageWidth - value
    if (key === 'bottomMargin') return state.pageHeight - value
    if (key === 'leftIndent') return state.leftMargin + value
    if (key === 'firstLineIndent') return state.leftMargin + state.leftIndent + value
    return state.pageWidth - state.rightMargin - value
  }
  function limit(key, value) {
    const width = state.pageWidth - state.leftMargin - state.rightMargin
    const ranges = {
      leftMargin: [0, state.pageWidth - state.rightMargin - 1], rightMargin: [0, state.pageWidth - state.leftMargin - 1],
      topMargin: [0, state.pageHeight - state.bottomMargin - 1], bottomMargin: [0, state.pageHeight - state.topMargin - 1],
      leftIndent: [Math.max(-state.leftMargin, -state.leftMargin - state.firstLineIndent), width - state.rightIndent - Math.max(0, state.firstLineIndent) - 1],
      rightIndent: [-state.rightMargin, width - state.leftIndent - Math.max(0, state.firstLineIndent) - 1],
      firstLineIndent: [-state.leftMargin - state.leftIndent, width - state.rightIndent - state.leftIndent - 1],
    }
    return Math.round(Math.max(ranges[key][0], Math.min(value, ranges[key][1])))
  }
  function offset(key, axis, value) {
    const view = viewport(), page = model()?.layout?.pages?.[state?.pageIndex]
    if (!page) return null
    return (page[axis] + position(key, value) - view[axis === 'x' ? 'xTwips' : 'yTwips']) * view.scale
  }
  function clearHandles() { for (const node of [horizontal, vertical]) for (const handle of node.querySelectorAll('[data-ruler-handle]')) handle.remove() }
  function render() {
    if (drag) return
    clearHandles()
    if (!visible() || !valid(state) || !editable()) return
    for (const [key, label, axis, row] of HANDLES) {
      const ruler = axis === 'x' ? horizontal : vertical
      if (ruler.hidden) continue
      const value = offset(key, axis, state[key]), extent = viewport()[axis === 'x' ? 'width' : 'height']
      if (value == null || value < 0 || value > extent) continue
      const handle = doc.createElement('button'); handle.type = 'button'; handle.dataset.rulerHandle = key
      handle.title = label + ' · 拖动调整'; handle.setAttribute('aria-label', label); handle.setAttribute('role', 'slider')
      handle.setAttribute('aria-valuenow', String(Math.round(state[key] * 25.4 / 1440 * 10) / 10)); handle.setAttribute('aria-valuetext', `${Math.round(state[key] * 25.4 / 1440 * 10) / 10} 毫米`)
      Object.assign(handle.style, { position: 'absolute', padding: '0', margin: '0', border: '1px solid var(--awd-accent-text)', borderRadius: '1px', background: 'var(--awd-accent-soft)', pointerEvents: 'auto', touchAction: 'none', cursor: axis === 'x' ? 'ew-resize' : 'ns-resize', zIndex: '1',
        ...(axis === 'x' ? { left: (value - 4) + 'px', top: row + 'px', width: '9px', height: '6px' } : { top: (value - 4) + 'px', left: '0', width: '19px', height: '9px' }) })
      handle.addEventListener('pointerdown', event => start(event, key, axis, handle))
      handle.addEventListener('keydown', event => keyboard(event, key, axis))
      ruler.appendChild(handle)
    }
  }
  async function read() {
    await input.flush()
    return execute('get_ruler_state')
  }
  function cancel() { serial++; drag = null; state = null; clearHandles() }
  function refresh() {
    if (disposed || reading || drag || writing) return
    win.clearTimeout(timer)
    if (!visible()) { state = null; render(); return }
    timer = win.setTimeout(async () => {
      const generation = ++serial; reading = true
      try { const value = await read(); if (!disposed && generation === serial) state = valid(value) ? value : null }
      catch { if (generation === serial) state = null }
      finally { reading = false; if (!disposed && generation === serial) render() }
    }, 80)
  }
  async function fresh(generation) {
    const previous = state, value = await read()
    if (disposed || generation !== serial || !editable() || !valid(value)) return null
    state = value
    // A different paragraph/page cannot inherit the visual starting position.
    if (!previous || fields.some(key => previous[key] !== value[key])) return null
    return value
  }
  async function start(event, key, axis, handle) {
    if (event.button !== 0 || !editable() || !valid(state)) return
    event.preventDefault(); event.stopPropagation(); win.clearTimeout(timer)
    const generation = ++serial
    drag = { key, axis, handle, origin: axis === 'x' ? event.clientX : event.clientY, value: state[key], ready: false }
    try { const value = await fresh(generation); if (generation !== serial) return; if (!value) { drag = null; render(); return }; drag.ready = true }
    catch { if (generation === serial) { drag = null; state = null; render(); message() } }
  }
  function move(event) {
    if (!drag?.ready) return
    if (!editable()) { cancel(); refresh(); return }
    event.preventDefault()
    const delta = ((drag.axis === 'x' ? event.clientX : event.clientY) - drag.origin) / viewport().scale
    drag.value = limit(drag.key, state[drag.key] + delta * (reversed(drag.key) ? -1 : 1))
    drag.handle.style[drag.axis === 'x' ? 'left' : 'top'] = (offset(drag.key, drag.axis, drag.value) - 4) + 'px'
  }
  async function apply(key, value, token) {
    if (!editable()) { cancel(); refresh(); return }
    writing = true; clearHandles(); state = null
    try { await execute('set_ruler_state', { contextToken: token, patch: { [key]: value } }) }
    catch { if (!disposed) message() }
    finally { writing = false; if (!disposed) refresh() }
  }
  function end(event) {
    if (!drag) return
    const current = drag, token = state?.contextToken
    if (current.ready) move(event)
    drag = null; serial++
    if (current.ready && token && state && current.value !== Math.round(state[current.key])) void apply(current.key, current.value, token)
    else { state = null; refresh() }
  }
  async function keyboard(event, key, axis) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || !editable()) return
    if ((axis === 'x') !== ['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation(); win.clearTimeout(timer)
    const generation = ++serial
    try {
      const value = await fresh(generation)
      if (!value) { render(); return }
      const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1
      await apply(key, limit(key, value[key] + direction * (reversed(key) ? -1 : 1) * 1440 / 25.4), value.contextToken)
    } catch { if (!disposed && generation === serial) { state = null; render(); message() } }
  }
  const abort = () => { if (drag) { cancel(); refresh() } }
  const escape = event => { if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); abort() } }
  win.addEventListener('pointermove', move); win.addEventListener('pointerup', end); win.addEventListener('pointercancel', abort)
  win.addEventListener('blur', abort); win.addEventListener('keydown', escape, true); input.element.addEventListener('compositionstart', abort)
  return { render, refresh, isDragging: () => !!drag, invalidate() { cancel(); refresh() },
    destroy() { disposed = true; cancel(); win.clearTimeout(timer); win.clearTimeout(noticeTimer); notice.remove()
      win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', end); win.removeEventListener('pointercancel', abort)
      win.removeEventListener('blur', abort); win.removeEventListener('keydown', escape, true); input.element.removeEventListener('compositionstart', abort) },
  }
}
