// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { attachInlineReview } from './zetaOfficeInlineReview.js'
import { attachWritingAssistance } from './zetaOfficeCompletion.js'
import { attachSemanticWritingPanel } from './semanticWritingPanel.js'

// The native editor shares a document with other panes. Keep guest subscriptions,
// overlays and input ownership inside one model lifetime, as a webview does.
export function attachNativeOfficeAssistance({ element, canvas, input, execute, send }) {
  const doc = canvas.ownerDocument, win = doc.defaultView, listeners = new Set()
  const container = doc.createElement('div')
  container.dataset.nativeAssistance = ''
  Object.assign(container.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '20' })
  element.appendChild(container)
  let disposed = false, writable = false, config, preferences, mutation = null
  const bounds = () => element.getBoundingClientRect()
  const dispatch = message => { if (!disposed) for (const listener of [...listeners]) listener(message) }
  const transport = { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    send(message) { if (!disposed) send(message) } }
  async function executeCompletion(action, params) {
    if (!['accept_completion', 'insert_completion_content'].includes(action)) return execute(action, params)
    const scope = { invalid: false, suspending: false }
    if (mutation) { mutation.invalid = true; return execute(action, params) }
    mutation = scope
    let result
    try { result = await execute(action, params, scope); return result }
    finally {
      if (mutation === scope) mutation = null
      // The engine issues this token only after checking the post-edit revision
      // and exact continuation range. A bare successful write is insufficient.
      if (!disposed && (scope.invalid || result?.success !== true || typeof result.token !== 'string' || !result.token || !Number.isSafeInteger(result.revision) || result.revision < 0)) writing.invalidate({ flush: false })
    }
  }
  const suspendBlur = event => {
    // Chromium blurs an input disabled by our own suspend. A real focus move
    // keeps its relatedTarget and must continue invalidating the guest normally.
    if (mutation?.suspending && input.getState().suspended && event.relatedTarget == null) event.stopImmediatePropagation()
  }
  input.element.addEventListener('blur', suspendBlur, true)
  const options = { canvas, input: input.element, execute: executeCompletion, transport, focus: () => input.focus(),
    language: doc.documentElement.lang || 'zh-CN', overlayContainer: container, bounds }
  const writing = attachWritingAssistance(options)
  const semantic = attachSemanticWritingPanel(options)
  const review = attachInlineReview(options)
  function publishPermission() {
    if (config) dispatch({ __lo: 'lo-relay', type: 'writing-config', config: { ...config, writable: writable && config.writable === true } })
    if (preferences) dispatch({ ...preferences, available: writable && preferences.available === true })
  }
  function layout() {
    const r = bounds()
    container.style.clipPath = `inset(${Math.max(0, r.top)}px ${Math.max(0, win.innerWidth - r.right)}px ${Math.max(0, win.innerHeight - r.bottom)}px ${Math.max(0, r.left)}px)`
    container.style.visibility = r.width > 0 && r.height > 0 ? 'visible' : 'hidden'
    writing.reposition(); semantic.reposition(); review.reposition()
  }
  layout()
  return {
    receive(message) {
      if (disposed) return
      if (message.type === 'writing-config') { if (message.config && typeof message.config === 'object') config = { ...config, ...message.config }; publishPermission(); return }
      if (message.type === 'writing-assistance-preferences-state') { preferences = message; publishPermission(); return }
      dispatch(message)
    },
    setWritable(value) { if (!value && mutation) mutation.invalid = true; if (writable === value) return; writable = value; publishPermission() },
    keydown: event => writing.keydown(event),
    get mutationScope() { return mutation },
    externalChange() { if (mutation) { mutation.invalid = true; writing.invalidate({ flush: false }) } },
    committed(text) { if (mutation) mutation.invalid = true; writing.committed(text); semantic.committed(text); review.committed(text) },
    cursorMoved() { if (!mutation) writing.cursorMoved(); semantic.cursorMoved(); review.cursorMoved() },
    documentChanged() { if (!mutation) writing.invalidate({ flush: false }); semantic.committed(); review.documentChanged() },
    layout,
    destroy() {
      if (disposed) return
      // Notify the current host before closing this model's guest channel.
      writing.destroy(); semantic.destroy(); review.destroy()
      send({ __lo: 'lo-relay', type: 'writing-assistance-state', available: false, open: false })
      send({ __lo: 'lo-relay', type: 'semantic-writing-state', available: false, open: false })
      disposed = true; listeners.clear(); input.element.removeEventListener('blur', suspendBlur, true); container.remove()
    },
  }
}
