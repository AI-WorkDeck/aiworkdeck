// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createProcessChannel } = require('./process-channel')
const { exportWithInlineRevisions } = require('./review-export.cjs')
const { createReviewUndo } = require('./review-undo.cjs')
const { REVIEW_BATCH_SIZE, hydrateReviewBatch, requireReviewDetails } = require('./review-hydration.cjs')
const { matchesCapiRevision, matchesUnoRevision, verifyReviewTarget } = require('./review-match.cjs')
const unsupported = action => Object.assign(Error(`Native editor does not support ${action}`), { code: 'UNSUPPORTED_NATIVE_ACTION' })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const documentActions = new Set(['get_document_text', 'get_paragraph', 'get_outline', 'find_text_locations', 'set_selection', 'clear_anchors', 'get_cursor_context', 'get_hyperlink_at_cursor', 'get_review_context', 'goto_review_range'])
const readActions = new Set([...documentActions, 'collapse_selection', 'get_bookmark_context', 'check_link_anchors', 'goto_bookmark', 'get_selection_hyperlink'])
const completionReads = new Set(['get_completion_context', 'capture_writing_context', 'get_context_menu_context'])
for (const action of completionReads) readActions.add(action)
readActions.add('set_host_context_menu')
const viewReadActions = new Set(['set_revision_view', 'export_document', 'export_pdf', 'set_review_balloons'])
const pureContextReads = new Set(['get_document_text', 'get_paragraph', 'get_outline', 'get_cursor_context', 'get_review_context', ...completionReads])
const completionWrites = new Set(['accept_completion', 'insert_completion_content', 'accept_writing_suggestion'])
const textEditActions = new Set(['replace_at_position', 'replace_selection', 'insert_at_cursor', 'modify_paragraph', 'apply_review_edit', ...completionWrites])
const reviewTargetActions = new Set(['goto_revision', 'resolve_revision', 'resolve_revisions'])
const expectedCompletionRefusals = new Set(['not-writer', 'composing', 'readonly', 'stale', 'selection', 'invalid-completion',
  'selection-mismatch', 'invalid-suggestion', 'invalid-content', 'invalid-table', 'table-requires-body'])
const evidenceWriteActions = new Set(['bookmark_selection', 'set_selection_hyperlink', 'adopt_legacy_links'])
const commentActions = new Set(['list_comments', 'goto_comment', 'add_comment_at_selection', 'update_comment', 'delete_comment', 'reply_comment', 'set_comment_resolved'])
const commentFields = ['id', 'author', 'content', 'timestamp', 'anchorText', 'resolved']
const revisionFields = ['index', 'identifier', 'type', 'text', 'author', 'timestamp']
const revisionDTO = (item, index) => ({ index, identifier: item.identifier, type: item.type,
  text: item.text, author: item.author, timestamp: item.dateTime })

// One owned process/profile per editor. Only exported bytes leave this class;
// publication, ACL, version leases and CAS remain in the existing save pipeline.
class NativeEditorSession {
  constructor({ config, run, readOnly, onEvent = () => {}, channel = createProcessChannel }) {
    if (typeof readOnly !== 'boolean') throw TypeError('readOnly must be a boolean')
    this.config = config; this.run = run; this.readOnly = readOnly; this.onEvent = onEvent; this.channel = channel
    this.queue = Promise.resolve(); this.model = null; this.review = null; this.comments = null; this.closed = false
    this.permissionSeq = 0; this.permissionPending = false
    this.revision = 0; this.initialCallbacks = new Map(); this.selectionCallbacks = new Map()
    this.undo = createReviewUndo({ view: params => this.unoCall('view', params),
      undoState: () => this.unoCall('undo_state'), undoStep: (kind, expected) => this.unoCall('undo_step', { kind, expected }) })
  }
  task(work) {
    const result = this.queue.then(() => { this.assertLive(); return work() })
    this.queue = result.catch(() => {})
    return result
  }
  assertLive() { if (this.closed || this.failure) throw this.failure || Error('Native session closed') }
  assertDocument(epoch) {
    this.assertLive()
    if (!this.model?.trackingReady || (epoch !== undefined && epoch !== this.model.documentEpoch)) throw Error('STALE_DOCUMENT')
    this.undo.assertSafe()
  }
  assertWrite() { if (this.readOnly) throw Object.assign(Error('Read-only document'), { code: 'READ_ONLY' }) }
  fail(error) {
    if (this.failure || this.closed) return
    this.failure = error
    this.onEvent({ type: 'engine-failed', message: error.message })
  }
  event(event) {
    if (event.type !== 'callback') return
    if ([1, 2, 3, 4, 5, 13].includes(event.callbackType)) this.initialCallbacks.set(event.callbackType, event)
    if (!this.model?.trackingReady || event.documentEpoch !== this.model.documentEpoch) return
    // Writer repeats selection notifications while selection/UI state is read.
    // Forwarding identical readback callbacks feeds Toolbar reads and paints
    // back into the native queue forever. Invalidation (type 0) is never folded.
    if ([2, 3, 4].includes(event.callbackType)) {
      const key = `${event.documentEpoch}:${event.viewId}:${event.callbackType}`
      if (this.selectionCallbacks.get(key) === event.payload) return
      this.selectionCallbacks.set(key, event.payload)
    }
    if (event.callbackType === 13) {
      const size = String(event.payload).split(',').map(Number)
      if (size.length === 2 && size.every(value => Number.isFinite(value) && value > 0)) {
        this.model.widthTwips = size[0]; this.model.heightTwips = size[1]
      }
    }
    if ([30, 31].includes(event.callbackType)) {
      if (event.callbackType === 31 && this.deferViewRevision(event)) return
      this.invalidateReview('review-changed', event.documentEpoch)
    }
    this.onEvent(event)
    if ([2, 3, 4].includes(event.callbackType)) {
      const selection = { type: 'selection', documentEpoch: event.documentEpoch }
      const guard = this.viewReadGuard
      if (this.currentViewRead(guard) && guard.selectionProof) {
        guard.selections.push(selection); this.scheduleViewReadCheck(guard)
      } else this.onEvent(selection)
    }
  }
  invalidateReview(type, documentEpoch = this.model.documentEpoch) {
    this.clearViewRead(false); this.reviewLoading = null
    const scope = this.mutationScope
    if (!scope?.invalidated) {
      this.revision++
      if (scope) scope.invalidated = true
      this.onEvent({ type, documentEpoch })
    } else if (type === 'modified' && !scope.modified) this.onEvent({ type, documentEpoch })
    if (scope && type === 'modified') scope.modified = true
  }
  changed() { this.invalidateReview('modified') }
  clearViewRead(invalidatePending = true) {
    const guard = this.viewReadGuard
    this.viewReadGuard = null
    // A callback removed from pending is still unproven until its UNO check ends.
    // Changing owners/permissions or navigating must not silently discard it.
    if (invalidatePending && guard?.model === this.model && guard?.revision === this.revision
        && (guard.pending.size || guard.verifying)) this.invalidateReview('review-changed', guard.model.documentEpoch)
    for (const event of guard?.selections || []) this.onEvent(event)
    if (guard) guard.selections = []
  }
  beginViewRead() {
    if (this.currentViewRead(this.viewReadGuard)) return this.viewReadGuard
    this.clearViewRead()
    if (this.review?.revision !== this.revision) throw Error('STALE_REVIEW_BATCH')
    return (this.viewReadGuard = { model: this.model, identity: this.review, revision: this.revision, permission: this.permissionSeq, pending: new Set(), selections: [] })
  }
  currentViewRead(guard) {
    return guard && !this.closed && !this.failure && this.viewReadGuard === guard && this.model === guard.model
      && this.review === guard.identity && this.revision === guard.revision && this.permissionSeq === guard.permission
  }
  deferViewRevision(event) {
    const guard = this.viewReadGuard
    if (!this.currentViewRead(guard)) return false
    let change
    try { change = JSON.parse(event.payload).redline } catch { return false }
    if (change?.action !== 'Modify') return false
    const index = guard.identity.items.findIndex(item => String(item.revisionId) === String(change.index))
    if (index < 0) return false
    guard.pending.add(index)
    this.scheduleViewReadCheck(guard)
    return true
  }
  scheduleViewReadCheck(guard) {
    if (guard.scheduled) return
    guard.scheduled = true
    // Verification is bounded and yields between batches so a large display
    // transition cannot put all full-text reads ahead of queued typing.
    tick().then(() => this.task(() => this.verifyViewRead(guard))).catch(() => {}).finally(() => {
      guard.scheduled = false
      if (this.currentViewRead(guard) && (guard.pending.size || guard.selections?.length)) this.scheduleViewReadCheck(guard)
    })
  }
  async verifyViewRead(guard) {
    if (!this.currentViewRead(guard)) return
    if (!guard.pending.size) return this.verifyViewSelection(guard)
    const indices = [...guard.pending].slice(0, REVIEW_BATCH_SIZE)
    indices.forEach(index => guard.pending.delete(index))
    guard.verifying = true
    const items = guard.identity.items
    const snapshot = async () => {
      const value = await this.engine.call('review_snapshot', { documentEpoch: guard.model.documentEpoch })
      if (!this.currentViewRead(guard)) return false
      const matches = value.documentEpoch === guard.model.documentEpoch && value.items?.length === items.length
        && value.items.every((item, index) => matchesCapiRevision(items[index], guard.displayChanged
          && ['Insert', 'Delete'].includes(items[index].type) ? { ...item, description: items[index].description } : item))
      if (matches && guard.displayChanged) {
        // A controlled display transition abbreviates deletion descriptions.
        // Full UNO identities/text were checked above; retain only fresh geometry summaries.
        items.forEach((item, index) => { item.description = value.items[index].description })
        guard.displayChanged = false
      }
      return matches
    }
    try {
      const full = await this.unoCall('check_revision_batch', { expectedCount: items.length,
        targets: indices.map(index => ({ index, identifier: items[index].identifier })) })
      if (!this.currentViewRead(guard)) return
      if (full.total !== items.length || full.entries?.length !== indices.length
          || !full.entries.every((item, offset) => item.index === indices[offset]
            && matchesUnoRevision(items[item.index], item)))
        throw Error('View-read revision text changed')
      if (!guard.pending.size) {
        if (!await snapshot()) throw Error('View-read review identity changed')
        await this.verifyViewSelection(guard)
      }
    } catch (error) {
      if (this.currentViewRead(guard)) {
        this.invalidateReview('review-changed', guard.model.documentEpoch)
      }
    } finally { guard.verifying = false }
  }
  async verifyViewSelection(guard) {
    if (!this.currentViewRead(guard) || !guard.selectionProof || !guard.selections.length) return
    const events = guard.selections.splice(0)
    let proof
    try { proof = await this.unoCall('check_view_read', { token: guard.selectionProof }) }
    catch {
      if (this.currentViewRead(guard)) this.invalidateReview('review-changed', guard.model.documentEpoch)
      for (const event of events) this.onEvent(event)
      return
    }
    if (!this.currentViewRead(guard)) { for (const event of events) this.onEvent(event); return }
    if (!proof.contentUnchanged) {
      this.invalidateReview('review-changed', guard.model.documentEpoch)
    }
    if (!proof.selectionUnchanged) guard.selectionProof = null
    for (const event of events) this.onEvent(proof.contentUnchanged && proof.selectionUnchanged
      ? { ...event, origin: 'view-read' } : event)
  }
  async start() {
    if (this.engine) return
    for (const name of ['', 'home', 'temp', 'profile']) {
      this.assertLive()
      await fs.mkdir(path.join(this.run, name), { recursive: true })
    }
    this.assertLive()
    this.env = { HOME: path.join(this.run, 'home'), TMPDIR: path.join(this.run, 'temp'),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', SAL_LOK_OPTIONS: 'unipoll' }
    this.engine = this.channel({ command: this.config.worker,
      args: [this.config.runtime, pathToFileURL(path.join(this.run, 'profile')).href, this.run],
      cwd: this.run, env: this.env, log: path.join(this.run, 'engine.log'), framed: true,
      onEvent: event => this.event(event), onFailure: error => this.fail(error) })
    await this.engine.ready
    this.assertLive()
  }
  async unoCall(method, params = {}) {
    if (!this.uno) {
      const bridge = await this.engine.call('start_urp', { documentEpoch: this.model.documentEpoch })
      this.assertLive()
      const pythonHome = path.join(this.config.unoRuntime, 'Frameworks/LibreOfficePython.framework/Versions/3.12')
      this.uno = this.channel({ command: this.config.unoHost,
        args: [path.join(pythonHome, 'LibreOfficePython'), path.join(__dirname, 'native_review_uno.py'), '--port', String(bridge.port)],
        cwd: this.run, framed: false, log: path.join(this.run, 'uno.log'),
        env: { ...this.env, PYTHONHOME: pythonHome,
          PYTHONPATH: path.join(this.config.unoRuntime, 'Resources') + ':' + path.join(this.config.unoRuntime, 'Frameworks'),
          URE_BOOTSTRAP: 'vnd.sun.star.pathname:' + path.join(this.config.unoRuntime, 'Resources/fundamentalrc'),
          PYTHONDONTWRITEBYTECODE: '1', PYTHONPYCACHEPREFIX: path.join(this.run, 'python-cache') },
        onFailure: error => this.fail(error) })
    }
    return this.uno.call(method, { ...params, documentUrl: this.model.documentUrl, nativeReadOnly: this.readOnly,
      nativeDocumentEpoch: this.model.documentEpoch, nativeRevision: this.revision, nativePermissionSeq: this.permissionSeq })
  }
  async load(params) {
    if (params.bytes === undefined) {
      this.assertDocument()
      if (typeof params.authorName !== 'string') throw TypeError('authorName must be a string')
      const result = await this.unoCall('author', { name: params.authorName })
      this.model.authorName = params.authorName
      return { success: true, ...result }
    }
    if (!/\.docx$/i.test(params.name || '')) throw unsupported('load_document format (DOCX required)')
    const bytes = Buffer.from(params.bytes)
    if (bytes.length > 64 * 1024 * 1024) throw Error('Native DOCX exceeds the current 64 MiB limit')
    if (typeof params.authorName !== 'string') throw TypeError('authorName must be a string')
    await this.start()
    if (this.model) {
      await this.engine.call('close', { documentEpoch: this.model.documentEpoch })
      this.model = null
    }
    this.review = null; this.reviewLoading = null; this.comments = null; this.viewReadGuard = null; this.undo.reset(); this.initialCallbacks.clear(); this.selectionCallbacks.clear()
    const local = path.join(this.run, `document-${++this.revision}.docx`)
    if (bytes.length) await fs.writeFile(local, bytes, { flag: 'wx' })
    this.assertLive()
    const opened = await this.engine.call(bytes.length ? 'open' : 'open_blank', { path: local, readOnly: this.readOnly })
    if (opened.readOnly !== this.readOnly || !Number.isInteger(opened.documentEpoch) || !Number.isInteger(opened.viewId)) throw Error('Native open identity not confirmed')
    this.model = { ...opened, name: params.name, authorName: params.authorName, documentUrl: pathToFileURL(local).href, trackingReady: false }
    try {
      await this.unoCall('author', { name: params.authorName })
      const tracking = await this.unoCall(this.readOnly ? 'tracking_state' : 'tracking', this.readOnly ? {} : { enabled: true, initialize: true })
      if (typeof tracking.enabled !== 'boolean' || (!this.readOnly && (tracking.enabled !== true || tracking.modified !== false))) throw Error('Native tracking initialization not confirmed')
      this.model.trackingInitialized = !this.readOnly
      this.model.view = await this.unoCall('view_settings')
      this.model.layout = await this.unoCall('view_metrics')
      this.model.trackingReady = true
      const { documentEpoch, viewId, widthTwips, heightTwips } = this.model
      return { success: true, kind: 'writer', docKind: 'writer', nativeModel: { documentEpoch, viewId, widthTwips, heightTwips, readOnly: this.readOnly, permissionSeq: this.permissionSeq, view: this.model.view, layout: this.model.layout },
        callbacks: [...this.initialCallbacks.values()].filter(event => event.documentEpoch === documentEpoch) }
    } catch (error) { this.fail(error); throw error }
  }
  async paint(params) {
    this.assertDocument(params.documentEpoch)
    const { width, height, scale = 1, xTwips = 0, yTwips = 0, widthTwips = this.model.widthTwips } = params
    if (![width, height, scale, xTwips, yTwips, widthTwips].every(Number.isFinite) || width < 1 || height < 1 || width > 4096 || height > 4096 || scale < 1 || scale > 4 || xTwips < 0 || yTwips < 0 || widthTwips <= 0) throw Error('Invalid native viewport')
    // A queued frame can outlive a view-only reflow (including review gutters).
    // Return the current dimensions instead of treating old geometry as a crash.
    if (Number.isFinite(params.documentWidthTwips) && params.documentWidthTwips > 0
        && params.documentWidthTwips !== this.model.widthTwips)
      return { stale: true, documentEpoch: this.model.documentEpoch,
        widthTwips: this.model.widthTwips, heightTwips: this.model.heightTwips }
    if (widthTwips > this.model.widthTwips || xTwips > this.model.widthTwips) throw Error('Invalid native viewport')
    const heightTwips = Math.round(widthTwips * height / width)
    const common = { documentEpoch: this.model.documentEpoch, xTwips: Math.round(xTwips), yTwips: Math.round(yTwips), widthTwips: Math.round(widthTwips), heightTwips }
    await this.engine.call('set_viewport', { ...common, width, height })
    const pixelsWide = Math.min(2048, Math.round(width * scale)), pixelsHigh = Math.min(2048, Math.round(height * scale))
    const tile = await this.engine.call('paint', { ...common, width: pixelsWide, height: pixelsHigh })
    const pixels = Buffer.from(tile.bytes)
    if (pixels.length !== pixelsWide * pixelsHigh * 4) throw Error('Native pixels are incomplete')
    if (tile.tileMode === 1) for (let i = 0; i < pixels.length; i += 4) { const blue = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = blue }
    return { ...common, width: pixelsWide, height: pixelsHigh, pixels: new Uint8Array(pixels) }
  }
  async input(action, params) {
    this.assertDocument(params.documentEpoch)
    if (['input_mouse', 'input_key', 'input_text', 'command'].includes(action)) this.clearViewRead()
    if (this.permissionPending && action === 'input_mouse') throw Object.assign(Error('Native permission update pending'), { code: 'READ_ONLY_PENDING', inputNotConsumed: true })
    const key = Number(params.keyCode), base = key & 0xFFF, modifiers = key & ~0xFFF
    const navigation = Number.isInteger(key) && Number(params.charCode || 0) === 0
      && ((base >= 1024 && base <= 1031 && (modifiers & ~0x1000) === 0) || (base === 512 && [0x2000, 0x8000].includes(modifiers)))
    if (this.readOnly && (action === 'input_text' || action === 'command' || (action === 'input_key' && !navigation))) {
      throw Object.assign(Error('Read-only document'), { code: 'READ_ONLY', inputNotConsumed: true })
    }
    if (action === 'command') {
      if (!['.uno:Undo', '.uno:Redo'].includes(params.command)) throw unsupported(params.command)
      const result = await this.undo.step(params.command === '.uno:Undo' ? 'undo' : 'redo')
      if (result.applied) this.changed()
      return result
    }
    if (!['input_text', 'input_key', 'input_mouse', 'input_barrier', 'set_viewport', 'selected_text', 'selection_text'].includes(action)) throw unsupported(action)
    const edits = action === 'input_text' || (action === 'input_key' && params.eventType === 0 && !navigation && base !== 1281 && base !== 1285)
    const run = () => {
      if (edits && this.readOnly) throw Object.assign(Error('Read-only document'), { code: 'READ_ONLY', inputNotConsumed: true })
      return this.engine.call(action, params)
    }
    const commit = action === 'input_text' ? () => this.commitText(params, run) : run
    const result = edits ? await this.undo.edit(commit) : await commit()
    if (edits) this.changed()
    return result
  }
  async commitText(params, run) {
    const owner = this.model, permission = this.permissionSeq
    const context = { inputSeq: params.inputSeq, permissionSeq: permission }
    let prepared, result, error, applied = false
    try {
      prepared = await this.unoCall('input_undo_begin', context)
      if (typeof prepared.grouped !== 'boolean' || prepared.inputSeq !== context.inputSeq
          || prepared.permissionSeq !== permission) throw Error('Native input context not confirmed')
      try {
        if (this.model !== owner) throw Error('STALE_DOCUMENT')
        if (this.permissionSeq !== permission || this.readOnly)
          throw Object.assign(Error('Native input permission changed'), { code: 'READ_ONLY_PENDING', inputNotConsumed: true })
        // SAL_LOK_OPTIONS=unipoll executes both EXT events synchronously on
        // the worker's main thread. Its acknowledged sequence is the boundary
        // before the URL-bound UNO context can be safely closed.
        result = await run()
        if (result.applied !== true || result.lastInputSeq !== params.inputSeq
            || result.documentEpoch !== owner.documentEpoch) throw Error('Native input outcome not confirmed')
        applied = true
      } catch (caught) { error = caught }
      finally {
        if (prepared.grouped) {
          const closed = await this.unoCall('input_undo_end', { ...context, applied })
          if (closed.closed !== true || closed.inputSeq !== context.inputSeq
              || closed.permissionSeq !== permission) throw Error('Native input cleanup not confirmed')
        }
      }
      if (error) throw error
      return result
    } catch (caught) {
      if (caught.inputNotConsumed === true) throw caught
      const unknown = Error('INPUT_OUTCOME_UNKNOWN: ' + caught.message)
      this.fail(unknown)
      throw unknown
    }
  }
  listRevisions() {
    const owner = this.model
    const existing = this.reviewRead
    if (existing?.owner === owner && existing.revision === this.revision) return existing.promise
    const job = { owner, revision: this.revision }
    job.promise = this.hydrateRevisions(owner).finally(() => {
      if (this.reviewRead === job) this.reviewRead = null
    })
    this.reviewRead = job
    return job.promise
  }
  async hydrateRevisions(owner) {
    const identity = await this.task(async () => {
      this.assertDocument(owner?.documentEpoch)
      const summary = await this.engine.call('review_snapshot', { documentEpoch: owner.documentEpoch })
      // Keep visible, complete cards usable while the replacement hydrates.
      return (this.reviewLoading = { ...summary, hydratedCount: 0, items: summary.items.map(item => ({ ...item, textAvailable: false })) })
    })
    try {
      while (identity.hydratedCount < identity.items.length) {
        // Deliberately leave the native queue, then the event loop, between batches.
        await tick()
        await this.task(() => hydrateReviewBatch({ start: identity.hydratedCount, limit: REVIEW_BATCH_SIZE,
          refreshEpoch: identity.refreshEpoch, documentEpoch: owner.documentEpoch }, {
          getIdentity: () => this.reviewLoading,
          getDocument: () => this.model && ({ documentEpoch: this.model.documentEpoch, documentUrl: this.model.documentUrl }),
          snapshot: documentEpoch => this.engine.call('review_snapshot', { documentEpoch }),
          details: params => this.unoCall('snapshot_batch', params)
        }))
      }
      return await this.task(() => {
        this.assertDocument(owner.documentEpoch)
        if (this.reviewLoading !== identity) throw Error('STALE_REVIEW_BATCH')
        this.clearViewRead()
        if (this.reviewLoading !== identity) throw Error('STALE_REVIEW_BATCH')
        identity.revision = this.revision
        this.review = identity
        return { success: true, revisions: identity.items.map(revisionDTO), count: identity.items.length,
          documentSeq: owner.documentEpoch, revision: identity.revision, truncated: false }
      })
    } finally {
      if (this.reviewLoading === identity) this.reviewLoading = null
    }
  }
  async reviewLayout(params = {}) {
    const owner = this.model
    const view = await this.task(async () => {
      this.assertDocument(params.documentEpoch); this.assertDocument(owner?.documentEpoch)
      return this.unoCall('view')
    })
    const revisionCards = ['balloons', 'margin'].includes(view.mode)
    if (revisionCards && (!this.review || (params.fresh !== false && this.review.revision !== this.revision)))
      await this.listRevisions()
    return this.task(async () => {
      this.assertDocument(owner.documentEpoch)
      const layout = await this.unoCall('geometry')
      if (!layout.available) return { success: true, available: false, items: [], pages: [] }
      if (layout.mode !== view.mode) throw Error('STALE_REVIEW_LAYOUT')
      if (!this.comments || this.comments.documentEpoch !== owner.documentEpoch
          || (params.fresh !== false && this.comments.revision !== this.revision)) await this.comment('list_comments', {})
      const geometry = layout.geometry, items = []
      const revisions = new Map((this.review?.items || []).map((item, index) => [String(item.revisionId), revisionDTO(item, index)]))
      let pending = 0, unread = 0
      const add = (kind, data, native, key) => {
        if (!native?.anchor || native.available === false || native.page == null) {
          if (kind === 'comment' || (revisionCards && data.type !== 'Insert')) pending++
          return
        }
        items.push({ key, kind, data, x: native.anchor.x, y: native.anchor.y,
          w: native.anchor.width, h: native.anchor.height, page: native.page, rects: native.rects || [] })
      }
      for (const native of geometry.revisions) {
        const data = revisionCards ? revisions.get(String(native.id)) : { index: native.index }
        if (!data) { unread++; continue }
        add('revision', { ...data, index: native.index }, native, 'r' + native.id)
      }
      const nativeComments = new Map()
      for (const native of geometry.comments) {
        const id = String(native.name || ('postit:' + native.id))
        nativeComments.set(id, nativeComments.has(id) ? null : native)
      }
      for (const [id, comment] of this.comments.items) add('comment', comment, nativeComments.get(String(id)), 'c' + id)
      for (const [id, native] of nativeComments) if (native && !this.comments.items.has(id)) unread++
      return { success: true, available: true, items, pages: geometry.pages, pending, unread,
        truncated: pending > 0 || unread > 0,
        stale: (revisionCards && this.review?.revision !== this.revision) || this.comments.revision !== this.revision,
        mode: view.mode, sidebarWidth: layout.sidebarWidth, revision: this.revision, documentSeq: owner.documentEpoch,
        writable: !this.readOnly && !this.permissionPending, selfAuthor: owner.authorName || '' }
    })
  }
  async resolveRevision(action, params) {
    const identity = this.review
    if (!identity || params.documentSeq !== this.model.documentEpoch || params.revision !== identity.revision || identity.revision !== this.revision) throw Error('STALE_REVIEW')
    const card = identity.items[params.index]
    if (!card || params.identifier !== card.identifier) throw Error('STALE_REVIEW_TARGET')
    if (action !== 'goto_revision') {
      this.assertWrite()
      if (!['accept', 'reject'].includes(params.action)) throw Error('Invalid review decision')
      const expected = params.expectedRevision, dto = revisionDTO(card, params.index)
      if (!expected || !revisionFields.every(key => expected[key] === dto[key])) throw Error('STALE_REVIEW_TEXT')
    }
    return this.resolveCard(action, card, identity, params.action)
  }
  async resolveCard(action, card, identity, decision) {
    requireReviewDetails(identity, card.revisionId)
    const run = async ({ displayChanged = false } = {}) => {
      const fresh = await verifyReviewTarget({ revisionId: card.revisionId, refreshEpoch: identity.refreshEpoch }, {
        reviewIdentity: identity, documentEpoch: this.model.documentEpoch, documentUrl: this.model.documentUrl, displayChanged,
        startUno: async () => this.uno, engineCall: (...args) => this.engine.call(...args), unoCall: (...args) => this.unoCall(...args) })
      if (action !== 'goto_revision') this.assertWrite()
      const result = await this.engine.call(action === 'goto_revision' ? 'review_goto' : 'review_resolve', {
        documentEpoch: this.model.documentEpoch, revisionId: card.revisionId, refreshEpoch: fresh.refreshEpoch, decision })
      if (action === 'goto_revision') {
        await this.unoCall('verify_location', { identifier: card.identifier })
        return { success: true, rects: fresh.rects, ...result }
      }
      this.changed(); this.review = null
      return { success: true, ...result }
    }
    if (action === 'goto_revision') return run()
    return this.undo.resolve(run)
  }
  setReadOnly(params) {
    this.assertLive()
    if (!this.model || params.documentEpoch !== this.model.documentEpoch) throw Error('STALE_DOCUMENT')
    if (typeof params.readOnly !== 'boolean' || !Number.isInteger(params.documentEpoch)
        || !Number.isSafeInteger(params.permissionSeq) || params.permissionSeq <= this.permissionSeq || params.permissionSeq > 0x7fffffff) {
      throw Error('INVALID_PERMISSION_UPDATE')
    }
    const owner = this.model, seq = params.permissionSeq
    this.clearViewRead()
    this.permissionSeq = seq
    // Synchronous, before joining the native queue: queued mutations must see
    // revocation immediately. Promotion also stays locked until the view agrees.
    this.readOnly = true; this.permissionPending = true; owner.readOnly = true
    return this.task(async () => {
      this.assertDocument(owner.documentEpoch)
      if (seq !== this.permissionSeq) throw Error('STALE_PERMISSION_UPDATE')
      try {
        const result = await this.engine.call('set_read_only', { documentEpoch: owner.documentEpoch, permissionSeq: seq, readOnly: params.readOnly })
        if (result.readOnly !== params.readOnly || result.documentEpoch !== owner.documentEpoch || result.permissionSeq !== seq || !Number.isSafeInteger(result.lastInputSeq) || result.lastInputSeq < 0) throw Error('Native permission update not confirmed')
        if (this.model !== owner || seq !== this.permissionSeq) throw Error('STALE_PERMISSION_UPDATE')
        if (!params.readOnly && !owner.trackingInitialized) {
          const before = await this.unoCall('tracking_state')
          if (before.modified !== false) throw Error('Uninitialized readonly model was modified')
          const tracking = await this.unoCall('tracking', { enabled: true, initialize: true })
          if (tracking.enabled !== true || tracking.modified !== false) throw Error('Native tracking initialization not confirmed')
          owner.trackingInitialized = true
        }
        if (this.model !== owner || seq !== this.permissionSeq) throw Error('STALE_PERMISSION_UPDATE')
        this.readOnly = params.readOnly; this.permissionPending = false; owner.readOnly = params.readOnly
        return { success: true, documentEpoch: owner.documentEpoch, permissionSeq: seq, readOnly: this.readOnly, lastInputSeq: result.lastInputSeq }
      } catch (error) {
        if (error.message !== 'STALE_PERMISSION_UPDATE') this.fail(error)
        throw error
      }
    })
  }
  async comment(action, params) {
    if (params.documentSeq !== undefined && params.documentSeq !== this.model.documentEpoch) throw Error('STALE_DOCUMENT')
    const reading = action === 'list_comments' || action === 'goto_comment'
    if (!reading) this.assertWrite()
    const { documentEpoch: _, nativeReadOnly: _readOnly, nativeCommentParents: _parents, ...command } = params
    if (action !== 'list_comments' && action !== 'add_comment_at_selection') {
      const expected = command.expectedComment || this.comments?.items.get(command.id)
      if (!expected || this.comments?.documentEpoch !== this.model.documentEpoch || expected.id !== command.id
          || !commentFields.every(key => Object.hasOwn(expected, key))) throw Error('STALE_COMMENT')
      // Older global revisions may still identify an unchanged comment. The UNO
      // adapter verifies every full-text/author/anchor field on the live model.
      command.expectedComment = expected
    }
    if (action === 'list_comments' || action === 'delete_comment') {
      const native = await this.engine.call('values', { command: '.uno:ViewAnnotations', documentEpoch: this.model.documentEpoch })
      const parsed = JSON.parse(native.value)
      if (!Array.isArray(parsed.comments)) throw Error('COMMENT_TOPOLOGY_UNAVAILABLE')
      command.nativeCommentParents = parsed.comments.map(({ id, parentId }) => ({ id, parentId }))
    }
    try {
      const run = () => { if (!reading) this.assertWrite(); return this.unoCall(action, command) }
      const result = reading ? await run() : await this.undo.edit(run)
      if (action === 'list_comments') {
        if (result.truncated !== false || !Array.isArray(result.comments) || result.count !== result.comments.length) throw Error('COMMENT_LIST_INCOMPLETE')
        this.comments = { documentEpoch: this.model.documentEpoch, revision: this.revision, items: new Map(result.comments.map(item => [item.id, item])) }
        if (this.comments.items.size !== result.comments.length) throw Error('COMMENT_ID_NOT_UNIQUE')
      }
      if (result.changed) this.changed()
      return { ...result, documentSeq: this.model.documentEpoch, revision: this.revision }
    } catch (error) {
      if (error.message.includes('COMMENT_OUTCOME_UNKNOWN')) this.fail(error)
      throw error
    }
  }
  execute(action, params = {}) {
    if (action === 'export_document' && this.readOnly) return Promise.reject(Object.assign(Error('Read-only document'), { code: 'READ_ONLY' }))
    if (action === 'set_read_only') {
      try { return this.setReadOnly(params) } catch (error) { return Promise.reject(error) }
    }
    if (action === 'list_revisions') return this.listRevisions()
    if (action === 'get_review_layout') return this.reviewLayout(params)
    if (completionWrites.has(action)) {
      const owner = this.model
      return this.executeQueued(action, params).then(async result => {
        if (result.success !== true) return result
        // The edit is already committed. A fresh continuation token is optional
        // and must still refer to its exact post-edit position after proof setup.
        // Never replay the write when intervening input makes this read stale.
        try {
          if (this.model !== owner || this.revision !== result.revision) return { ...result, token: null }
          const context = await this.execute('get_completion_context', { documentEpoch: owner.documentEpoch,
            nativeAfterToken: result.token, nativeExpectedRevision: result.revision })
          return context.success === true ? { ...result, ...context } : { ...result, token: null }
        } catch { return { ...result, token: null } }
      })
    }
    if (action === 'set_view_options') {
      const owner = this.model, permission = this.permissionSeq, read = this.reviewRead
      const pending = read?.owner === owner && read.revision === this.revision ? read.promise : null
      const ready = this.review?.revision === this.revision && this.review.items.every(item => item.textAvailable === true)
      // Initial toolbar preferences can arrive between an existing reader's
      // bounded hydration batches. Share that read before publishing view-only
      // callbacks; do not start a new full scan just to initialize the toolbar.
      if (pending || ready) return (pending || Promise.resolve()).then(() =>
        this.executeQueued(action, params, owner, permission))
    }
    const finalRead = viewReadActions.has(action) || completionReads.has(action) || ['get_review_context', 'goto_review_range'].includes(action)
      || (action === 'get_document_text' && params.__agent === true)
    if (finalRead) {
      const owner = this.model
      if (this.review?.revision === this.revision && this.review.items.every(item => item.textAvailable === true))
        return this.executeQueued(action, params, owner)
      return this.task(() => {
        this.assertDocument(params.documentEpoch); this.assertDocument(owner?.documentEpoch)
        return this.review?.revision === this.revision && this.review.items.every(item => item.textAvailable === true)
      }).then(async ready => {
        // Hydration uses bounded queued batches, so it must run outside a task.
        // A background context read cannot depend on the sidebar having opened.
        if (!ready) await this.listRevisions()
        return this.executeQueued(action, params, owner)
      })
    }
    return this.executeQueued(action, params)
  }
  executeQueued(action, params, finalReadOwner, finalReadPermission) {
    return this.task(async () => {
      if (action === 'load_document') return this.load(params)
      this.assertDocument(params.documentEpoch)
      if (finalReadOwner) {
        this.assertDocument(finalReadOwner.documentEpoch)
        if (this.model !== finalReadOwner) throw Error('STALE_DOCUMENT')
        if (finalReadPermission !== undefined && finalReadPermission !== this.permissionSeq) throw Error('STALE_PERMISSION_UPDATE')
        if (params.nativeExpectedRevision !== undefined && params.nativeExpectedRevision !== this.revision)
          return { success: false, available: false, reason: 'stale', error: 'stale', message: 'stale' }
        if (this.review?.revision !== this.revision || !this.review.items.every(item => item.textAvailable === true))
          throw Error('STALE_REVIEW_BATCH: document changed while preparing final-text read')
      }
      const actualMutation = (action === 'native_input' && ['input_text', 'input_key', 'input_mouse', 'command'].includes(params.action))
        || textEditActions.has(action) || evidenceWriteActions.has(action) || reviewTargetActions.has(action)
        || (commentActions.has(action) && action !== 'list_comments')
        || ['format_selection', 'ui_command', 'set_style', 'set_ruler_state', 'set_track_changes', 'undo', 'redo', 'set_selection', 'collapse_selection', 'goto_bookmark'].includes(action)
        || (!this.readOnly && ['find_text_locations', 'clear_anchors'].includes(action))
      if (action === 'apply_review_edit' || action === 'set_ruler_state' || reviewTargetActions.has(action) || completionWrites.has(action)) {
        const pendingRead = this.viewReadGuard
        if (this.currentViewRead(pendingRead)) {
          // A captured edit may arrive between bounded read-proof batches.
          // Finish one full-list pass inside this task before relinquishing the
          // proof; remaining/changed callbacks still invalidate in clearViewRead.
          await this.engine.call('selected_text', { documentEpoch: pendingRead.model.documentEpoch })
          for (let batches = Math.ceil(pendingRead.identity.items.length / REVIEW_BATCH_SIZE);
            batches > 0 && this.currentViewRead(pendingRead) && pendingRead.pending.size; batches--)
            await this.verifyViewRead(pendingRead)
        }
      }
      if (actualMutation) this.clearViewRead()
      const mutation = actualMutation ? (this.mutationScope = { invalidated: false, modified: false }) : null
      const guard = finalReadOwner ? this.beginViewRead() : null
      if (guard && (viewReadActions.has(action) || action === 'set_view_options')) guard.displayChanged = true
      if (guard && !pureContextReads.has(action)) {
        for (const event of guard.selections.splice(0)) this.onEvent(event)
        guard.selectionProof = null
      }
      const runAction = async () => {
      if (action === 'native_paint') return this.paint(params)
      if (action === 'native_input') return this.input(params.action, params.params || {})
      if (action === 'export_pdf') {
        const local = path.join(this.run, 'export.pdf')
        try {
          await fs.rm(local, { force: true })
          const result = await this.unoCall('export_pdf', { nativeOutputPath: local })
          if (result.success !== true) throw Error('Native PDF export failed')
          const bytes = await fs.readFile(local)
          if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw Error('Native PDF export is empty or invalid')
          return { success: true, size: bytes.length, bytes: new Uint8Array(bytes) }
        } catch (error) {
          if (error.message.includes('PDF_EXPORT_OUTCOME_UNKNOWN')) this.fail(error)
          throw error
        } finally { await fs.rm(local, { force: true }) }
      }
      if (action === 'export_document') {
        this.assertWrite()
        return exportWithInlineRevisions(params => this.unoCall('view', params), async () => {
          const local = path.join(this.run, 'export.docx')
          this.assertWrite()
          const result = await this.engine.call('save', { documentEpoch: this.model.documentEpoch, path: local })
          if (result.success !== true) throw Error('Native export failed')
          return { success: true, bytes: new Uint8Array(await fs.readFile(local)) }
        })
      }
      if (action === 'get_ui_state') return { success: true, ...await this.unoCall('ui_state') }
      if (action === 'get_ruler_state') return { success: true, ...await this.unoCall(action, params) }
      if (action === 'list_fonts' || action === 'list_styles') {
        const { documentEpoch: _, ...query } = params
        return { success: true, ...await this.unoCall(action, query) }
      }
      if (['set_view_options', 'set_zoom', 'set_chrome', 'set_review_balloons', 'native_layout'].includes(action)) {
        const { documentEpoch: _, ...query } = params
        if (action === 'native_layout') return { success: true, nativeLayout: await this.unoCall('view_metrics') }
        try {
          const result = await this.unoCall(action, query)
          this.model.view = await this.unoCall('view_settings')
          if (action === 'set_review_balloons') {
            const size = await this.engine.call('review_snapshot', { documentEpoch: this.model.documentEpoch })
            this.model.widthTwips = size.widthTwips; this.model.heightTwips = size.heightTwips
          }
          return { success: true, ...result, nativeView: this.model.view,
            ...(action === 'set_review_balloons' ? { widthTwips: this.model.widthTwips, heightTwips: this.model.heightTwips } : {}),
            ...((action === 'set_view_options' && this.model.view.ruler) || action === 'set_review_balloons'
              ? { nativeLayout: await this.unoCall('view_metrics') } : {}) }
        } catch (error) {
          if (error.message.includes('VIEW_OUTCOME_UNKNOWN')) this.fail(error)
          throw error
        }
      }
      if (action === 'format_selection' || action === 'ui_command' || action === 'set_style' || action === 'set_ruler_state') {
        const { documentEpoch: _, ...command } = params
        const navigation = action === 'ui_command' && ['select_all', 'escape'].includes(command.name)
        if (!navigation) this.assertWrite()
        if (command.__agent) throw unsupported('AI formatting view/author contract')
        const run = () => { if (!navigation) this.assertWrite(); return this.unoCall(action, command) }
        try {
          const result = navigation ? await run() : await this.undo.edit(run)
          if (result.changed && !result.atCursor) this.changed()
          else this.onEvent({ type: 'selection', documentEpoch: this.model.documentEpoch })
          return { success: true, ...result,
            ...(action === 'set_ruler_state' ? { ...await this.unoCall('get_ruler_state'), changed: result.changed,
              nativeLayout: await this.unoCall('view_metrics') } : {}) }
        } catch (error) {
          if (error.message.includes('FORMAT_OUTCOME_UNKNOWN')) this.fail(error)
          throw error
        }
      }
      if (textEditActions.has(action) || evidenceWriteActions.has(action)) {
        this.assertWrite()
        if (params.documentSeq !== undefined && params.documentSeq !== this.model.documentEpoch) throw Error('STALE_DOCUMENT')
        const { documentEpoch: _, ...query } = params, textEdit = textEditActions.has(action)
        const marker = textEdit ? 'EDIT_OUTCOME_UNKNOWN' : 'EVIDENCE_OUTCOME_UNKNOWN'
        const run = async () => {
          this.assertWrite()
          const result = await this.unoCall(action, query)
          const reviewRefused = result.success === false && (action === 'apply_review_edit'
            ? ['not-writer', 'stale', 'invalid-range', 'unsupported-unicode-range', 'invalid-replacement'].includes(result.reason)
            : completionWrites.has(action) && expectedCompletionRefusals.has(result.reason))
            && result.changed === false && result.textChanged === false && result.trackingChanged === false
          if ((!reviewRefused && result.success !== true) || typeof result.changed !== 'boolean'
              || (textEdit ? typeof result.textChanged !== 'boolean' || typeof result.trackingChanged !== 'boolean'
                || result.changed !== (result.textChanged || result.trackingChanged)
                : !Number.isSafeInteger(result.bookmarkMutations) || result.bookmarkMutations < 0
                  || !Number.isSafeInteger(result.hyperlinkMutations) || result.hyperlinkMutations < 0
                  || result.changed !== (result.bookmarkMutations + result.hyperlinkMutations > 0)))
            throw Error(marker + ': native mutation receipt is incomplete')
          return result
        }
        try {
          const result = await this.undo.edit(run, { isNoop: value => textEdit ? value.textChanged === false
            : value.bookmarkMutations === 0 && value.hyperlinkMutations === 0 })
          if (result.changed) this.changed()
          this.onEvent({ type: 'selection', documentEpoch: this.model.documentEpoch })
          return action === 'apply_review_edit' || completionWrites.has(action) ? { ...result, revision: this.revision } : result
        } catch (error) {
          if (/EDIT_OUTCOME_UNKNOWN|EVIDENCE_OUTCOME_UNKNOWN|FINAL_TEXT_RESTORE_FAILED/.test(error.message)) this.fail(error)
          throw error
        }
      }
      if (readActions.has(action)) {
        if (params.documentSeq !== undefined && params.documentSeq !== this.model.documentEpoch) throw Error('STALE_DOCUMENT')
        const { documentEpoch: _, ...query } = params
        const bookmarks = !this.readOnly && ['find_text_locations', 'clear_anchors'].includes(action)
        let guard = null
        if ((query.__agent || completionReads.has(action) || ['get_review_context', 'goto_review_range'].includes(action)) && !bookmarks && this.review?.revision === this.revision
            && this.review.items.every(item => item.textAvailable === true)) {
          guard = finalReadOwner ? null : this.beginViewRead()
        }
        const run = () => { if (bookmarks) this.assertWrite(); return this.unoCall(action, query) }
        try {
          // Writable anchors are real bookmarks and can change Writer's undo
          // stacks. Keep them inside the same lineage guard as other mutations.
          const result = bookmarks ? await this.undo.edit(run, { isNoop: result => result.bookmarkMutations === 0 }) : await run()
          if (guard) {
            // Cross the worker's main-thread queue after UNO restored the view.
            // Later callbacks retain this exact model/list proof and are still
            // freshly checked; there is no timer window that assumes no edits.
            await this.engine.call('selected_text', { documentEpoch: this.model.documentEpoch })
            await this.verifyViewRead(guard)
          }
          return result
        } catch (error) {
          if (this.currentViewRead(guard)) {
            this.invalidateReview('review-changed')
          }
          if (bookmarks || /FINAL_TEXT_RESTORE_FAILED|EDIT_OUTCOME_UNKNOWN|EVIDENCE_OUTCOME_UNKNOWN/.test(error.message)) this.fail(error)
          throw error
        }
      }
      if (action === 'get_selection') return { success: true, ...await this.engine.call('selected_text', { documentEpoch: this.model.documentEpoch }) }
      if (commentActions.has(action)) return this.comment(action, params)
      if (action === 'undo' || action === 'redo') {
        this.assertWrite(); const result = await this.undo.step(action); if (result.applied) this.changed()
        return { success: true, ...result }
      }
      if (action === 'set_track_changes') {
        this.assertWrite()
        if (typeof params.on !== 'boolean') throw TypeError('on must be a boolean')
        this.model.trackingReady = false
        try {
          const result = await this.unoCall('tracking', { enabled: params.on })
          if (result.enabled !== params.on || typeof result.changed !== 'boolean' || typeof result.modified !== 'boolean'
              || (result.changed && !result.modified)) throw Error('Tracking change not confirmed')
          this.model.trackingReady = true
          if (result.changed) this.changed()
          return { success: true, ...result, recordChanges: result.enabled }
        } catch (error) { this.fail(error); throw error }
      }
      if (action === 'set_revision_view') {
        if (!['all', 'final', 'balloons'].includes(params.mode)) throw unsupported(`revision view ${params.mode}`)
        const result = await this.unoCall('view', { mode: params.mode, refresh: true })
        const size = await this.engine.call('review_snapshot', { documentEpoch: this.model.documentEpoch })
        this.model.widthTwips = size.widthTwips; this.model.heightTwips = size.heightTwips
        return { success: true, ...result, widthTwips: size.widthTwips, heightTwips: size.heightTwips,
          nativeLayout: await this.unoCall('view_metrics') }
      }
      if (action === 'goto_revision' || action === 'resolve_revision') return this.resolveRevision(action, params)
      if (action === 'resolve_revisions') {
        this.assertWrite()
        const identity = this.review
        if (!identity || params.documentSeq !== this.model.documentEpoch || params.revision !== identity.revision
            || identity.revision !== this.revision) throw Error('STALE_REVIEW')
        if (!['accept', 'reject'].includes(params.action) || !Array.isArray(params.indices) || !params.indices.length
            || params.indices.length > 500 || new Set(params.indices).size !== params.indices.length) throw Error('Invalid revision batch')
        const targets = params.indices.map(index => {
          const card = Number.isInteger(index) && identity.items[index]
          const expected = params.expectedRevisions?.find(item => item.index === index)
          if (!card || !expected || !revisionFields.every(key => expected[key] === revisionDTO(card, index)[key])) throw Error('STALE_REVIEW_TEXT')
          return { index, card }
        }).sort((a, b) => b.index - a.index)
        const results = []
        for (const { index, card } of targets) {
          try { results.push({ index, ...await this.resolveCard('resolve_revision', card, identity, params.action) }) }
          catch (error) { return { success: false, results, message: error.message } }
        }
        return { success: true, results }
      }
      // No invented empty results or raw postUno acknowledgement as success.
      throw unsupported(action)
      }
      try {
        if (guard && pureContextReads.has(action)) {
          // A new capture cannot retroactively attribute a prior unknown selection.
          for (const event of guard.selections.splice(0)) this.onEvent(event)
          guard.selectionProof = null
          const proof = await this.unoCall('capture_view_read')
          guard.selectionProof = proof.token
        }
        const result = await runAction()
        // The worker acknowledgement fences callbacks from this owned mutation.
        // They all invalidate the same atomic operation, not thousands of revisions.
        if (mutation || (action === 'set_view_options' && !guard)) await this.engine.call('selected_text', { documentEpoch: this.model.documentEpoch })
        if (guard) {
          await this.engine.call('selected_text', { documentEpoch: this.model.documentEpoch })
          await this.verifyViewRead(guard)
        }
        return result
      } catch (error) {
        if (this.currentViewRead(guard)) {
          this.invalidateReview('review-changed', guard.model.documentEpoch)
        }
        if (/FINAL_TEXT_RESTORE_FAILED|VIEW_OUTCOME_UNKNOWN|EDIT_OUTCOME_UNKNOWN/.test(error.message)) this.fail(error)
        throw error
      } finally {
        if (this.mutationScope === mutation) this.mutationScope = null
      }
    })
  }
  close() {
    return this.closePromise ||= (async () => {
      this.closed = true
      await this.uno?.stop()
      await this.engine?.stop(true)
      // No still-running load may recreate files after manager cleanup.
      await this.queue
    })()
  }
}
module.exports = { NativeEditorSession }
