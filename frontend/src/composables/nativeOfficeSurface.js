// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import './nativeDocumentInput.js'
import { attachDocumentLinkClicks } from './zetaOfficeLinkClick.js'
import { attachReviewBalloons } from './zetaOfficeReviewBalloons.js'
import { attachNativeOfficeAssistance } from './nativeOfficeAssistance.js'
import { attachNativeDocumentRulers } from './nativeDocumentRulers.js'
import { CURSOR_RADIUS } from '../utils/insightMatch.js'

// Implements the existing lo-relay transport. There is no HTTP publication here:
// export_document returns bytes to LibreOfficeEditor's ordinary save pipeline.
export function createNativeOfficeSurface({ api, info, document: doc = document }) {
  const element = doc.createElement('div'), layer = doc.createElement('div'), canvas = doc.createElement('canvas')
  Object.assign(element.style, { overflow: 'auto', position: 'relative', background: 'var(--awd-canvas)', color: 'var(--awd-text)', fontFamily: 'inherit' })
  Object.assign(layer.style, { position: 'relative', margin: '0 auto' })
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', background: 'var(--awd-surface)', touchAction: 'none' })
  element.dataset.nativeOffice = info.sessionId; element.appendChild(layer); layer.appendChild(canvas)
  const horizontalRuler = doc.createElement('div'), verticalRuler = doc.createElement('div')
  for (const [node, axis] of [[horizontalRuler, 'horizontal'], [verticalRuler, 'vertical']]) {
    node.dataset.nativeRuler = axis
    Object.assign(node.style, { position: 'absolute', zIndex: '2', overflow: 'hidden', pointerEvents: 'none',
      background: 'var(--awd-surface)', color: 'var(--awd-text-muted)', fontSize: '10px' })
    element.appendChild(node)
  }
  const listeners = new Set()
  let model, input, disposed = false, paintJob, paintAgain = false, paintTimer, layoutTimer, failed = false
  let desiredReadOnly = null, permissionRevision = 0, permissionSeq = 0, permissionApplied = -1, permissionJob
  let insightSub = false, contextGeneration = 0, contextJob, pendingContext, lastContextAt = 0, detachLinks, modelLoads = 0
  let reviewBalloons, assistance, rulers
  const emit = message => { if (!disposed) for (const listener of [...listeners]) listener({ __lo: 'lo-relay', ...message }) }
  const fail = error => {
    if (failed || disposed) return
    failed = true; rulers?.destroy(); rulers = null; assistance?.destroy(); assistance = null; input?.dispose(); reviewBalloons?.destroy()
    emit({ type: 'engine-failed', message: error.message || String(error) })
  }
  const request = async (action, params) => {
    if (disposed || failed) throw Error('Native editor is closed')
    const result = await api.nativeRequest(info.sessionId, action, params)
    if (result?.success === false) throw Object.assign(Error(result.message || 'Native command failed'), { code: result.code, inputNotConsumed: result.inputNotConsumed === true })
    return result
  }
  function invalidateContext() {
    contextGeneration++; pendingContext = null
  }
  function queueContext(meta = null, force = false) {
    if (!insightSub || !model || modelLoads || disposed || failed || input?.getState().composing) return
    // Reads can themselves emit cursor callbacks. Never feed those back into
    // another read; retain only an explicit newer click while one is in flight.
    if (!meta && !force && (contextJob || Date.now() - lastContextAt < 400)) return
    pendingContext = { owner: model, generation: ++contextGeneration, meta }
    void readContext()
  }
  async function readContext() {
    if (contextJob || !pendingContext) return
    const job = contextJob = pendingContext; pendingContext = null; lastContextAt = Date.now()
    const current = () => !disposed && !failed && !modelLoads && insightSub && model === job.owner && contextGeneration === job.generation
    try {
      await input?.flush()
      if (!current()) return
      const result = await execute('get_cursor_context', { radius: CURSOR_RADIUS })
      if (current() && result?.success) emit({ type: 'cursor-context', payload: {
        before: result.before || '', after: result.after || '', paragraph: result.paragraph || '',
        selectedText: result.selectedText || '', hasSelection: !!result.hasSelection,
        meta: job.meta || { metaKey: false, ctrlKey: false, clientX: null, clientY: null }, at: Date.now(),
      } })
    } catch { /* Optional read failures do not change the document or its input state. */ }
    finally { if (contextJob === job) contextJob = null; if (pendingContext) void readContext() }
  }
  function bindLinks(owner) {
    detachLinks?.()
    // The native canvas shares the host viewport. Preserve the existing relay
    // contract, whose coordinates are relative to the editor guest viewport.
    const localMeta = meta => {
      const rect = element.getBoundingClientRect()
      return { ...meta, clientX: Number.isFinite(meta?.clientX) ? meta.clientX - rect.left : null,
        clientY: Number.isFinite(meta?.clientY) ? meta.clientY - rect.top : null }
    }
    detachLinks = attachDocumentLinkClicks({ canvas,
      execute: async (action, params) => {
        await input?.flush()
        if (owner !== model || modelLoads || disposed || failed) throw Error('STALE_DOCUMENT_LINK')
        const result = await execute(action, params)
        if (owner !== model || modelLoads || disposed || failed) throw Error('STALE_DOCUMENT_LINK')
        return result
      },
      send: message => { if (owner === model && !modelLoads && !disposed && !failed) emit({ ...message, meta: localMeta(message.meta) }) },
      cursorContext: meta => { if (owner === model) queueContext(localMeta(meta)) },
    })
  }
  function applyPermission(owner, revision) {
    if (permissionJob?.owner === owner && permissionJob.revision === revision) return permissionJob.promise
    const seq = permissionSeq = Math.max(permissionSeq, owner.permissionSeq || 0) + 1
    const readOnly = desiredReadOnly
    owner.readOnly = true
    rulers?.invalidate()
    assistance?.setWritable(false)
    input?.setReadOnly(true, { pending: true })
    const job = { owner, revision }
    job.promise = (async () => {
      try {
        const result = await request('set_read_only', { readOnly, documentEpoch: owner.documentEpoch, permissionSeq: seq })
        if (owner !== model || revision !== permissionRevision || disposed) return { stale: true }
        if (result.readOnly !== readOnly || result.documentEpoch !== owner.documentEpoch || result.permissionSeq !== seq
            || !Number.isSafeInteger(result.lastInputSeq) || result.lastInputSeq < 0) throw Error('Native permission acknowledgement does not match')
        owner.readOnly = readOnly; owner.permissionSeq = seq; permissionApplied = revision
        input?.setReadOnly(readOnly, { pending: false })
        assistance?.setWritable(!readOnly)
        rulers?.invalidate()
        return result
      } catch (error) {
        if (owner !== model || revision !== permissionRevision || disposed) return { stale: true }
        if (permissionJob === job) permissionJob = null
        // Keep the input latch closed. A failed or stale grant is never proof
        // that this native view is writable; the host also retains its latch.
        throw error
      }
    })()
    permissionJob = job
    return job.promise
  }
  async function setReadOnly(readOnly) {
    if (typeof readOnly !== 'boolean') throw TypeError('readOnly must be a boolean')
    if (disposed || failed) throw Error('Native editor is closed')
    if (desiredReadOnly !== readOnly) { desiredReadOnly = readOnly; permissionRevision++ }
    if (model && permissionApplied === permissionRevision) return { success: true, readOnly: model.readOnly, documentEpoch: model.documentEpoch, permissionSeq: model.permissionSeq }
    input?.setReadOnly(true, { pending: true })
    assistance?.setWritable(false)
    rulers?.invalidate()
    if (!model) return { pending: true, readOnly: true }
    return applyPermission(model, permissionRevision)
  }
  const metrics = () => {
    const scale = model.view.zoom / 1500, inset = model.view.ruler ? 20 : 0, insetX = model.view.verticalRuler ? 20 : 0
    const fullWidth = model.widthTwips * scale
    const availableWidth = Math.max(1, element.clientWidth - insetX)
    const width = Math.max(1, Math.min(fullWidth, availableWidth)), height = Math.max(1, element.clientHeight - inset)
    return { width, height, cssWidth: width, cssHeight: height, scale, inset, insetX, fullWidth,
      xTwips: Math.round(element.scrollLeft / scale), yTwips: Math.round(element.scrollTop / scale),
      widthTwips: Math.min(model.widthTwips, Math.round(width / scale)), heightTwips: Math.round(height / scale) }
  }
  function drawRulers(viewport) {
    if (rulers?.isDragging()) return
    horizontalRuler.hidden = !model.view.ruler; verticalRuler.hidden = !model.view.verticalRuler
    if (horizontalRuler.hidden && verticalRuler.hidden) return
    const { inset, insetX, scale, width, height } = viewport
    const center = Math.max(0, (element.clientWidth - insetX - viewport.fullWidth) / 2)
    Object.assign(horizontalRuler.style, { left: (element.scrollLeft + insetX + center) + 'px', top: element.scrollTop + 'px', width: width + 'px', height: inset + 'px' })
    Object.assign(verticalRuler.style, { left: element.scrollLeft + 'px', top: (element.scrollTop + inset) + 'px', width: insetX + 'px', height: height + 'px' })
    for (const [node, axis, extent, origin] of [[horizontalRuler, 'x', width, viewport.xTwips], [verticalRuler, 'y', height, viewport.yTwips]]) {
      node.replaceChildren()
      const pages = model.layout.pages.filter(page => axis === 'y' || (page.y + page.height >= viewport.yTwips && page.y <= viewport.yTwips + viewport.heightTwips)).slice(0, axis === 'x' ? 1 : undefined)
      for (const page of pages) {
        const length = axis === 'x' ? page.width : page.height
        for (let mm = 0; mm * 1440 / 25.4 <= length; mm++) {
          const offset = (page[axis] + mm * 1440 / 25.4 - origin) * scale
          if (offset < 0 || offset > extent) continue
          const tick = doc.createElement('span'), major = mm % 10 === 0
          tick.dataset.mm = String(mm); tick.textContent = major ? String(mm / 10) : ''
          Object.assign(tick.style, axis === 'x' ? { position: 'absolute', left: offset + 'px', bottom: '0', height: (major ? 17 : mm % 5 ? 4 : 8) + 'px', borderLeft: '1px solid var(--awd-border)', paddingLeft: '2px' }
            : { position: 'absolute', top: offset + 'px', right: '0', width: (major ? 17 : mm % 5 ? 4 : 8) + 'px', borderTop: '1px solid var(--awd-border)', paddingTop: '1px' })
          node.appendChild(tick)
        }
      }
    }
    rulers?.render()
  }
  function scheduleLayout() {
    doc.defaultView.clearTimeout(layoutTimer)
    const owner = model
    layoutTimer = doc.defaultView.setTimeout(async () => {
      layoutTimer = null
      try {
        const result = await request('native_layout', { documentEpoch: owner.documentEpoch })
        if (model !== owner || disposed) return
        model.layout = result.nativeLayout; schedulePaint()
      } catch (error) { if (model === owner && !disposed) fail(error) }
    }, 150)
  }
  async function paint(owner = model) {
    if (!owner || disposed || failed) return
    if (paintJob) {
      const previous = paintJob
      if (previous.owner === owner) { paintAgain = true; return previous.promise }
      await previous.promise
      if (owner !== model || disposed) throw Error('STALE_DOCUMENT_PAINT')
      return paint(owner)
    }
    const job = { owner }
    paintJob = job
    job.promise = draw(owner).finally(() => {
      if (paintJob === job) paintJob = null
      if (paintAgain) { paintAgain = false; schedulePaint() }
    })
    return job.promise
  }
  async function draw(owner) {
    try {
      const viewport = metrics()
      const tile = await request('native_paint', { documentEpoch: owner.documentEpoch,
        documentWidthTwips: owner.widthTwips,
        width: viewport.width, height: viewport.height, scale: Math.max(1, doc.defaultView.devicePixelRatio || 1), xTwips: viewport.xTwips, yTwips: viewport.yTwips, widthTwips: viewport.widthTwips })
      if (disposed || owner !== model || tile.documentEpoch !== owner.documentEpoch) return
      if (tile.stale) {
        owner.widthTwips = tile.widthTwips; owner.heightTwips = tile.heightTwips
        return draw(owner)
      }
      layer.style.width = viewport.fullWidth + 'px'; layer.style.height = Math.ceil(owner.heightTwips * viewport.scale) + 'px'
      layer.style.marginTop = viewport.inset + 'px'
      layer.style.marginLeft = Math.max(viewport.insetX, (element.clientWidth - viewport.fullWidth + viewport.insetX) / 2) + 'px'
      canvas.width = tile.width; canvas.height = tile.height
      canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px'
      canvas.style.top = Math.round(viewport.yTwips * viewport.scale) + 'px'
      canvas.style.left = Math.round(viewport.xTwips * viewport.scale) + 'px'
      canvas.getContext('2d').putImageData(new ImageData(transparentPageExterior(tile, owner.layout.pages), tile.width, tile.height), 0, 0)
      drawRulers(viewport)
      assistance?.layout()
      await input?.viewportChanged()
    } catch (error) {
      if (owner === model && !disposed) throw error
    }
  }
  function schedulePaint() {
    if (disposed || paintTimer) return
    paintTimer = doc.defaultView.setTimeout(() => { paintTimer = null; paint().catch(fail) }, 16)
  }
  const scroll = () => { rulers?.invalidate(); input?.viewportChanged()?.catch(fail); reviewBalloons?.cursorMoved(); assistance?.cursorMoved(); assistance?.layout(); schedulePaint() }
  element.addEventListener('scroll', scroll)
  const resize = new ResizeObserver(() => { rulers?.invalidate(); assistance?.layout(); schedulePaint() }); resize.observe(element)
  const off = api.onNativeEvent(info.sessionId, event => {
    if (event.type === 'engine-failed') { fail(Error(event.message || 'Native worker stopped')); return }
    if (!model || event.documentEpoch !== model.documentEpoch) return
    if (event.type === 'callback') {
      input?.handleCallback(event)
      if (event.callbackType === 1) queueContext()
      if (event.callbackType === 13) {
        const size = String(event.payload).split(',').map(Number)
        if (size.length === 2 && size.every(value => Number.isFinite(value) && value > 0)) {
          model.widthTwips = size[0]; model.heightTwips = size[1]; scheduleLayout()
        }
      }
      schedulePaint()
    } else {
      emit(event)
      if (event.type === 'selection') {
        queueContext(); rulers?.refresh(); reviewBalloons?.cursorMoved()
        // Only the main process's completed read proof can identify view-only
        // readback. Untagged/asynchronous native selection remains a real change.
        if (event.origin !== 'view-read') assistance?.cursorMoved()
      }
      if (event.type === 'modified') { rulers?.refresh(); reviewBalloons?.documentChanged(); assistance?.documentChanged(); schedulePaint() }
    }
  })
  async function execute(action, params = {}, assistanceOperation = null) {
    const previous = model, previousInput = input, previousPermission = permissionRevision
    const contextRead = (action === 'get_document_text' && params.__agent === true)
      || ['get_completion_context', 'get_context_menu_context', 'capture_writing_context', 'get_review_context', 'get_ruler_state'].includes(action)
    const currentContext = () => previous === model && previousInput === input && previousPermission === permissionRevision && !modelLoads && !disposed && !failed
    const read = ['get_ui_state', 'get_selection', 'list_revisions', 'list_comments', 'list_fonts', 'list_styles',
      'get_document_text', 'get_paragraph', 'get_outline', 'find_text_locations', 'get_cursor_context',
      'get_hyperlink_at_cursor', 'get_bookmark_context', 'check_link_anchors', 'get_selection_hyperlink', 'get_review_layout',
      'get_review_context', 'get_completion_context', 'get_context_menu_context', 'capture_writing_context', 'set_host_context_menu', 'get_ruler_state'].includes(action)
    if (!read && assistanceOperation !== assistance?.mutationScope) assistance?.externalChange()
    const reviewOwner = !read && action !== 'set_review_balloons' ? reviewBalloons : null
    let suspended = false, loading = false
    try {
      if (contextRead) {
        await previousInput?.flush()
        if (!currentContext()) throw Error('STALE_DOCUMENT_ASSISTANCE')
      }
      reviewOwner?.suspend(action)
      // Composition cannot be committed implicitly by Save, toolbar or retarget.
      if (input && !read) {
        let suspension
        if (assistanceOperation) assistanceOperation.suspending = true
        try { suspension = input.suspend() }
        finally { if (assistanceOperation) assistanceOperation.suspending = false }
        await suspension; suspended = true
      }
      if (action === 'load_document') {
        loading = true; modelLoads++; invalidateContext(); detachLinks?.(); detachLinks = null
        assistance?.destroy(); assistance = null
        rulers?.destroy(); rulers = null
      }
      const result = await request(action, { ...params, ...(model ? { documentEpoch: model.documentEpoch } : {}) })
      if (contextRead && !currentContext()) throw Error('STALE_DOCUMENT_ASSISTANCE')
      if (disposed) throw Error('Native editor disposed during command')
      if (action === 'load_document' && result.nativeModel) {
        invalidateContext(); detachLinks?.(); detachLinks = null
        input?.dispose(); input = null; model = result.nativeModel; element.scrollTop = 0; element.scrollLeft = 0
        permissionApplied = -1
        permissionSeq = Math.max(permissionSeq, model.permissionSeq || 0)
        const owner = model
        // Permission may change while load/retarget is in flight. Synchronize
        // the latest policy using the new epoch before creating editable input.
        if (desiredReadOnly !== null) {
          do { await applyPermission(owner, permissionRevision) }
          while (owner === model && permissionApplied !== permissionRevision && !disposed)
        }
        if (owner !== model || disposed) throw Error('STALE_DOCUMENT_PERMISSION')
        doc.defaultView.clearTimeout(layoutTimer)
        input = globalThis.AWDDocumentInput.createDocumentInput({ canvas, viewport: metrics,
          request: (name, values) => request('native_input', { documentEpoch: model.documentEpoch, action: name, params: values }),
          writeClipboard: text => doc.defaultView.navigator.clipboard.writeText(text),
          onSave: () => emit({ type: 'save-request' }), onError: fail,
          onChanged: () => { assistance?.externalChange(); schedulePaint() },
          onState: state => assistance?.setWritable(state.readOnly === false && !state.permissionPending && !state.failed),
          onCommitted: text => { assistance?.committed(text); rulers?.refresh() },
          onAssistanceKey: event => assistance?.keydown(event) || false,
          onEnsureVisible: rect => {
            const viewport = metrics(), top = rect.y * viewport.scale
            if (top < element.scrollTop || top > element.scrollTop + element.clientHeight - 40) element.scrollTop = Math.max(0, top - 80)
          } })
        input.setDocument(model)
        for (const callback of result.callbacks || []) input.handleCallback(callback)
        await paint()
        bindLinks(owner)
        reviewBalloons?.destroy()
        reviewBalloons = attachReviewBalloons({ canvas, execute,
          transport: { send: emit }, locale: doc.documentElement.lang || 'zh-CN' })
        const ownedInput = input
        const executeOwned = async (action, params, operation) => {
          const current = () => owner === model && ownedInput === input && !modelLoads && !disposed && !failed
          if (!current()) throw Error('STALE_DOCUMENT_ASSISTANCE')
          const result = await execute(action, params, operation)
          if (!current()) throw Error('STALE_DOCUMENT_ASSISTANCE')
          return result
        }
        assistance = attachNativeOfficeAssistance({ element, canvas, input, send: emit, execute: executeOwned })
        assistance.setWritable(!owner.readOnly)
        rulers = attachNativeDocumentRulers({ element, horizontal: horizontalRuler, vertical: verticalRuler, input,
          model: () => model, viewport: metrics,
          canWrite: () => owner === model && !modelLoads && !disposed && !failed && !owner.readOnly && !input.getState().permissionPending && !input.getState().suspended,
          execute: executeOwned })
        rulers.refresh()
      } else if (model) {
        if (result.nativeView) { model.view = result.nativeView; rulers?.refresh() }
        if (result.nativeLayout) model.layout = result.nativeLayout
        if (result.widthTwips) model.widthTwips = result.widthTwips
        if (result.heightTwips) model.heightTwips = result.heightTwips
        if (result.rects?.[0]) {
          const rectangle = result.rects[0], y = Array.isArray(rectangle) ? rectangle[1] : rectangle.y
          if (Number.isFinite(y)) element.scrollTop = Math.max(0, y * metrics().scale - 80)
        }
        if (!read) await paint()
      }
      if (action === 'get_review_layout' && model && result.available) {
        // LOK's internal headless view spans the whole model. Cards use the
        // visible tile's actual host coordinates, including native scrolling.
        const viewport = metrics()
        result.view = { left: viewport.xTwips, top: viewport.yTwips,
          right: viewport.xTwips + viewport.widthTwips, bottom: viewport.yTwips + viewport.heightTwips,
          frameWidth: viewport.width, frameHeight: viewport.height,
          viewport: { x: 0, y: 0, width: viewport.width, height: viewport.height } }
      }
      return result
    } finally {
      if (loading) modelLoads--
      if (suspended && model === previous && !disposed && !failed) input?.resume()
      reviewOwner?.resume()
    }
  }
  const transport = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    send(message) {
      if (message.type === 'insight-sub') {
        insightSub = message.enabled === true; invalidateContext()
        if (insightSub) queueContext(null, true)
        return
      }
      if (message.type !== 'exec') { if (!modelLoads) assistance?.receive(message); return }
      execute(message.action, message.params).then(result => emit({ type: 'result', reqId: message.reqId, result }),
        error => emit({ type: 'result', reqId: message.reqId, result: { success: false, code: error.code || 'NATIVE_ACTION_FAILED', message: error.message } }))
    }
  }
  return { element, transport, setReadOnly,
    start() {
      Promise.resolve().then(async () => {
        if (info.initialBlank) await execute('load_document', { bytes: new Uint8Array(0), name: 'Untitled.docx', authorName: '' })
        emit({ type: 'ready', engine: 'lok', capabilities: info.capabilities })
      }).catch(error => { emit({ type: 'boot-failed', message: error.message }); fail(error) })
    },
    focus() { input?.focus() },
    dispose() {
      if (disposed) return
      assistance?.destroy(); assistance = null
      rulers?.destroy(); rulers = null
      disposed = true; invalidateContext(); detachLinks?.(); reviewBalloons?.destroy(); off(); listeners.clear(); resize.disconnect(); element.removeEventListener('scroll', scroll)
      doc.defaultView.clearTimeout(paintTimer); doc.defaultView.clearTimeout(layoutTimer); input?.dispose()
      return api.nativeClose(info.sessionId)
    } }
}


// LOK does not paint the application background. Its native macOS tiles have
// opaque black outside Writer pages. Use native page bounds, never pixel color,
// to preserve every printed pixel (including black text and black page fills).
export function transparentPageExterior(tile, pages) {
  if (!Array.isArray(pages) || !pages.length || !pages.every(p => ['x', 'y', 'width', 'height'].every(k => Number.isFinite(p[k])) && p.width > 0 && p.height > 0)) throw Error('Native page geometry missing')
  const pixels = new Uint8ClampedArray(tile.pixels)
  const scaleX = tile.width / tile.widthTwips, scaleY = tile.height / tile.heightTwips
  const bounds = pages.map(p => ({ left: (p.x - tile.xTwips) * scaleX, right: (p.x + p.width - tile.xTwips) * scaleX,
    top: (p.y - tile.yTwips) * scaleY, bottom: (p.y + p.height - tile.yTwips) * scaleY }))
  for (let y = 0; y < tile.height; y++) {
    const spans = bounds.filter(p => y + 0.5 >= p.top && y + 0.5 < p.bottom)
    for (let x = 0; x < tile.width; x++) {
      if (!spans.some(p => x + 0.5 >= p.left && x + 0.5 < p.right)) pixels[(y * tile.width + x) * 4 + 3] = 0
    }
  }
  return pixels
}
