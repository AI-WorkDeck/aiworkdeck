// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import editorZh from '../locales/zh-CN/editor.js'
import editorEn from '../locales/en-US/editor.js'

function sw(key) {
  let en = false
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('checkba_app_language') === 'en-US') en = true
    else if (typeof document !== 'undefined' && document.documentElement?.lang === 'en-US') en = true
  } catch (_) { /* ignore */ }
  const dict = (en ? editorEn : editorZh)?.semanticWriting || editorZh.semanticWriting
  return dict[key] || editorZh.semanticWriting[key] || key
}

export function createSemanticWritingHost({ projectId, fileId, title, writable, execute, send, api }) {
  let session = '', generation = 0, disposed = false, active = null, applying = false, generating = false, saving = false
  let automaticEnabled = false, tabActive = true, automaticGeneration = 0, automatic = null, automaticGenerating = false
  let lastSourceFileIds = [], lastDocumentType = 'auto'
  const empty = () => ({ view: { status: 'EMPTY', advice: [] }, notices: [] })
  const stale = () => new Error(sw('staleError'))
  const current = seq => !disposed && seq === generation
  const cancel = id => id && Promise.resolve(api.cancel(projectId, id)).catch(() => {})
  function invalidate(state = 'STALE') {
    generation++; generating = false
    const old = active; active = null
    cancel(old?.id)
    if (!disposed && session) send({ __lo: 'lo-relay', type: 'writing-config', config: { session, semantic: { state } } })
  }
  function invalidateAutomatic(notify = false) {
    automaticGeneration++; automaticGenerating = false
    const old = automatic; automatic = null
    cancel(old?.id)
    if (notify && !disposed && session) send({ __lo: 'lo-relay', type: 'writing-config', config: { session, automatic: { state: 'STALE' } } })
  }
  const automaticCurrent = seq => !disposed && automaticEnabled && tabActive && seq === automaticGeneration
  function checkAutomatic(seq) { if (!automaticCurrent(seq)) throw stale() }
  function automaticView(view) {
    // The backend has already checked grounding; never surface multiple choices or unchecked running output.
    const advice = view?.status === 'READY' ? view.advice?.[0] : null
    const valid = typeof advice?.text === 'string' && advice.text.trim() && advice.text.length <= 2000
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(advice.text)
    return { ...view, status: view?.status === 'READY' && !valid ? 'EMPTY' : view?.status, advice: valid ? [advice] : [] }
  }
  async function generateAutomatic(data) {
    if (active || generating || saving || applying) return empty()
    invalidateAutomatic()
    const seq = automaticGeneration
    if (data.composing) return empty()
    automaticGenerating = true
    try {
      const snapshot = await execute('capture_writing_context', { radius: 200 })
      checkAutomatic(seq)
      const before = String(snapshot?.before || ''), after = String(snapshot?.after || '')
      if (!snapshot?.success || !snapshot.available || !snapshot.token || snapshot.revision == null
        || snapshot.scopeKnown !== true || !Number.isSafeInteger(snapshot.paragraphIndex) || snapshot.paragraphIndex < 0
        || snapshot.hasSelection || snapshot.selectedText
        || before.replace(/\s/gu, '').length < 20 || !/^[\s\p{P}]*$/u.test(after.split(/\r?\n/u)[0])) return empty()
      const sourceFileIds = [...new Set(data.sourceFileIds ?? lastSourceFileIds)]
      if (sourceFileIds.length > 4 || sourceFileIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error(sw('maxFourMaterialsError'))
      const nearby = await execute('get_document_text', { startParagraph: Math.max(0, snapshot.paragraphIndex - 3), maxParagraphs: 7, __agent: true })
      checkAutomatic(seq)
      if (!nearby?.success || String(nearby.revision) !== String(snapshot.revision) || !Array.isArray(nearby.paragraphs)) throw stale()
      const paragraph = nearby.paragraphs.find(item => item.index === snapshot.paragraphIndex)
      if (typeof paragraph?.text !== 'string' || paragraph.text.length > 6000) return empty()
      // Keep actual heading paragraphs captured with this snapshot. Reconstructing them from
      // sectionTitle would invent source text, while omitting them loses appendix scope downstream.
      if (!Array.isArray(snapshot.sectionPath) || !Array.isArray(snapshot.scopeHeadings)
        || snapshot.scopeHeadings.length !== snapshot.sectionPath.length) return empty()
      const scoped = new Map()
      let previousIndex = -1
      for (const heading of snapshot.scopeHeadings) {
        if (!Number.isSafeInteger(heading?.index) || heading.index <= previousIndex || heading.index > snapshot.paragraphIndex
          || typeof heading.text !== 'string' || !heading.text.trim()) return empty()
        const observed = nearby.paragraphs.find(item => item.index === heading.index)
        if (observed && observed.text !== heading.text) return empty()
        scoped.set(heading.index, heading.text); previousIndex = heading.index
      }
      scoped.set(paragraph.index, paragraph.text)
      const paragraphs = [...scoped.values()]
      let length = paragraphs.join('\n').length
      if (length > 6000) return empty()
      // Only unheaded body paragraphs are known to share scope with preceding paragraphs.
      if (snapshot.sectionTitle === '正文' && snapshot.sectionPath.length === 0) {
        for (let index = snapshot.paragraphIndex - 1; index >= Math.max(0, snapshot.paragraphIndex - 3); index--) {
          const previous = nearby.paragraphs.find(item => item.index === index)
          if (typeof previous?.text !== 'string' || length + 1 + previous.text.length > 6000) break
          paragraphs.unshift(previous.text); length += 1 + previous.text.length
        }
      }
      const context = { fileId, revision: String(snapshot.revision), documentText: paragraphs.join('\n'),
        before: before.slice(-200), after: after.slice(0, 200), selection: '', title: title || '',
        section: snapshot.sectionTitle || '', documentType: lastDocumentType, sourceFileIds }
      const view = await api.suggest(projectId, { mode: 'autocomplete', context })
      if (!automaticCurrent(seq)) { cancel(view?.id); throw stale() }
      const shown = automaticView(view)
      automatic = { id: view.id, snapshot, selection: '', notices: [], view: shown, mode: 'autocomplete' }
      return { view: shown, notices: [] }
    } finally { if (automaticCurrent(seq)) automaticGenerating = false }
  }
  function check(seq) { if (!current(seq)) throw stale() }
  async function generate(data) {
    invalidateAutomatic()
    if (saving) throw new Error(sw('savingWaitGenerateError'))
    if (data.composing) throw new Error(sw('finishComposingBeforeGenerateError'))
    if (!['local', 'sentence', 'paragraph', 'rewrite'].includes(data.mode)) throw new Error(sw('selectModeError'))
    const sourceFileIds = [...new Set(data.sourceFileIds || [])]
    if (sourceFileIds.length > 4 || sourceFileIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error(sw('maxFourMaterialsError'))
    lastSourceFileIds = sourceFileIds
    lastDocumentType = ['auto', 'litigation', 'contract', 'diligence'].includes(data.documentType) ? data.documentType : 'auto'
    invalidate('LOADING')
    const seq = generation
    generating = true
    try {
      const snapshot = await execute('capture_writing_context', {})
      check(seq)
      if (!snapshot?.success || !snapshot.available || !snapshot.token || snapshot.revision == null) throw new Error(snapshot?.message || sw('cannotGenerateAtCursorError'))
      const selection = snapshot.selectedText || ''
      if (data.mode === 'rewrite' ? !selection : !!selection) throw new Error(data.mode === 'rewrite' ? sw('selectTextForRewriteError') : sw('hasSelectionError'))
      if (selection.length > 2000) throw new Error(sw('selectionTooLongError'))
      const paragraphs = [], coveredParagraphs = new Set()
      let start = 0, body = '', truncated = false
      for (let page = 0; page < 100 && body.length < 16000; page++) {
        const text = await execute('get_document_text', { startParagraph: start, maxParagraphs: 200, __agent: true })
        check(seq)
        if (!text?.success || String(text.revision) !== String(snapshot.revision) || !Array.isArray(text.paragraphs)) throw stale()
        let length = body.length
        for (const paragraph of text.paragraphs) {
          length += (paragraphs.length ? 1 : 0) + String(paragraph.text || '').length
          if (length <= 16000 && Number.isInteger(paragraph.index)) coveredParagraphs.add(paragraph.index)
          paragraphs.push(paragraph.text || '')
        }
        body = paragraphs.join('\n')
        truncated = body.length > 16000 || !!text.truncated
        if (!text.truncated || body.length >= 16000) break
        if (!Number.isInteger(text.nextStartParagraph) || text.nextStartParagraph <= start) break
        start = text.nextStartParagraph
      }
      const notices = truncated ? [sw('truncatedNotice')] : []
      const scopeKnown = snapshot.scopeKnown !== false && coveredParagraphs.has(snapshot.paragraphIndex)
      if (!scopeKnown) notices.push(sw('scopeUnknownNotice'))
      const context = { fileId, revision: String(snapshot.revision), documentText: body.slice(0, 16000),
        before: String(snapshot.before || '').slice(-2000), after: String(snapshot.after || '').slice(0, 2000),
        selection, title: title || '', section: scopeKnown ? snapshot.sectionTitle || '' : '',
        documentType: ['auto', 'litigation', 'contract', 'diligence'].includes(data.documentType) ? data.documentType : 'auto', sourceFileIds }
      const view = await api.suggest(projectId, { mode: data.mode, context })
      if (!current(seq)) { cancel(view?.id); throw stale() }
      active = { id: view.id, snapshot, selection, notices, view, mode: data.mode }
      return { view, notices }
    } finally { if (current(seq)) generating = false }
  }
  async function accept(job, data, checkCurrent, isAutomatic = false) {
    if (data.composing) throw new Error(sw('finishComposingBeforeAcceptError'))
    if ((isAutomatic && data.index !== 0) || !Number.isInteger(data.index) || data.index < 0 || job.view.status !== 'READY' || !job.view.advice?.[data.index]) throw new Error(sw('selectValidAdviceError'))
    const review = await execute('get_review_context', {}); checkCurrent()
    if (String(review?.revision) !== String(job.snapshot.revision)) throw stale()
    const result = await api.accept(projectId, job.id, { index: data.index, revision: String(job.snapshot.revision) }); checkCurrent()
    if (String(result.revision) !== String(job.snapshot.revision) || result.selection !== job.selection || typeof result.text !== 'string' || !result.text.trim()) throw stale()
    applying = true
    try {
      const applied = await execute('accept_writing_suggestion', { token: job.snapshot.token, revision: job.snapshot.revision, text: result.text, expectedSelection: job.selection, __agent: job.mode !== 'local' })
      if (!applied?.success) throw new Error(applied?.message || sw('insertFailedError'))
      if (isAutomatic) { automatic = null; automaticGeneration++ }
      else { active = null; generation++ }
      return { applied: true, message: sw('acceptedUndoHint') }
    } finally { applying = false }
  }
  return {
    setAutomaticEnabled(value) { automaticEnabled = value === true; if (!automaticEnabled) invalidateAutomatic(true) },
    setActive(value) { tabActive = value === true; if (!tabActive) invalidateAutomatic(true) },
    bindSession(value) { session = value },
    async perform(action, data = {}) {
      if (disposed || !writable) throw new Error(sw('docNotWritableError'))
      if (action.startsWith('semantic-auto-')) {
        if (action === 'semantic-auto-cancel') { invalidateAutomatic(); return { cancelled: true } }
        if (!automaticEnabled || !tabActive) throw new Error(sw('autoDisabledOrInactiveError'))
        if (action === 'semantic-auto-generate') return generateAutomatic(data)
        if (!automatic) throw stale()
        const seq = automaticGeneration, job = automatic
        if (action === 'semantic-auto-poll') {
          const view = await api.get(projectId, job.id); checkAutomatic(seq)
          job.view = automaticView(view)
          return { view: job.view, notices: [] }
        }
        if (action === 'semantic-auto-accept') return accept(job, data, () => checkAutomatic(seq), true)
        throw new Error(sw('unsupportedActionError'))
      }
      if (action === 'semantic-context') {
        const ids = [...new Set(data.sourceFileIds || [])]
        if (ids.length > 4 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error(sw('maxFourMaterialsError'))
        lastSourceFileIds = ids
        lastDocumentType = ['auto', 'litigation', 'contract', 'diligence'].includes(data.documentType) ? data.documentType : 'auto'
        invalidateAutomatic(true)
        return {}
      }
      if (action === 'semantic-settings') {
        const settings = await api.settings(projectId)
        return { ...settings, files: (settings.files || []).filter(file => String(file.id) !== String(fileId)) }
      }
      if (action === 'semantic-save-settings') {
        if (saving) throw new Error(sw('savingWaitError'))
        saving = true; invalidateAutomatic(); invalidate()
        try { return await api.saveSettings(projectId, { stance: data.stance || '', cutoffDate: data.cutoffDate || '' }) }
        finally { saving = false }
      }
      if (action === 'semantic-generate') return generate(data)
      if (action === 'semantic-cancel') { invalidate('CANCELLED'); return { cancelled: true } }
      if (!active) throw stale()
      const seq = generation, job = active
      if (action === 'semantic-poll') {
        const view = await api.get(projectId, job.id); check(seq); job.view = view
        return { view, notices: job.notices }
      }
      if (action === 'semantic-accept') return accept(job, data, () => check(seq))
      throw new Error(sw('unsupportedActionError'))
    },
    modified() {
      if (disposed || applying) return
      if (automatic || automaticGenerating) invalidateAutomatic(true)
      if (active || generating) invalidate()
    },
    destroy() { if (disposed) return; disposed = true; invalidateAutomatic(); invalidate() },
  }
}
