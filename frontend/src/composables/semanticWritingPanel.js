// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import editorZh from '../locales/zh-CN/editor.js'
import editorEn from '../locales/en-US/editor.js'

/** Guest UI only. All data and mutations travel through the existing writing session. */
export function attachSemanticWritingPanel({ canvas, input, transport, focus, overlayContainer, bounds }) {
  const doc = canvas.ownerDocument, win = doc.defaultView
  function sw(key, params) {
    let en = false
    try {
      if (doc?.documentElement?.lang === 'en-US') en = true
      else if (win?.localStorage?.getItem('checkba_app_language') === 'en-US') en = true
      else if (typeof localStorage !== 'undefined' && localStorage.getItem('checkba_app_language') === 'en-US') en = true
    } catch (_) { /* ignore */ }
    const dict = (en ? editorEn : editorZh)?.semanticWriting || editorZh.semanticWriting
    let text = dict[key] || editorZh.semanticWriting[key] || key
    if (params && typeof text === 'string') {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? ''))
      }
    }
    return text
  }
  let session = '', writable = false, available = false, sheetOpen = false, composing = false, disposed = false, sequence = 0, requestId = 0, timer = null, active = false, accepting = false, saving = false
  const pending = new Map(), selected = new Set()
  const root = doc.createElement('div'); root.className = 'awd-semantic'; root.hidden = true
  // 色值全部走 editor.html 头部那套 --awd-*：面板注入的是编辑器页自己的 document
  // （canvas.ownerDocument），宿主 App.vue 的 :root 令牌继承不进来，令牌表由
  // editor.html 自带一份。深浅两套靠 html.theme-dark 上的令牌取值切换，
  // 这里不再写 .theme-dark 分支。
  const style = doc.createElement('style'); style.textContent = `
    .awd-semantic{font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--awd-text);position:fixed;right:16px;top:14px;z-index:2147482600}
    .awd-semantic[hidden]{display:none!important}.awd-semantic *{box-sizing:border-box}.awd-semantic button,.awd-semantic input,.awd-semantic textarea,.awd-semantic select{font:inherit}.awd-semantic :focus-visible{outline:3px solid var(--awd-accent-text);outline-offset:3px}
    .awd-semantic button{border:1px solid var(--awd-border);background:var(--awd-surface);color:var(--awd-accent-text);border-radius:7px;padding:6px 10px;cursor:pointer}.awd-semantic button:hover{background:var(--awd-accent-soft)}.awd-semantic button:disabled{opacity:.45;cursor:default}
    .awd-semantic-sheet{position:absolute;right:0;top:0;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 28px);overflow:auto;background:var(--awd-surface);border:1px solid var(--awd-border);border-radius:12px;box-shadow:var(--awd-shadow-lg)}
    .awd-semantic-head{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--awd-border-subtle)}.awd-semantic-head strong{font-size:16px}.awd-semantic-section{padding:14px 18px;border-bottom:1px solid var(--awd-border-subtle)}.awd-semantic-label{display:block;font-size:12px;font-weight:600;color:var(--awd-text-2);margin:0 0 5px}.awd-semantic select,.awd-semantic textarea,.awd-semantic input[type=date]{display:block;width:100%;border:1px solid var(--awd-border);border-radius:6px;padding:7px;background:var(--awd-surface);color:var(--awd-text);margin-bottom:10px}.awd-semantic textarea{resize:vertical;min-height:56px}
    .awd-semantic-files{max-height:126px;overflow:auto;margin:8px 0}.awd-semantic-file{display:flex;gap:8px;align-items:flex-start;padding:5px 0;overflow-wrap:anywhere}.awd-semantic-file input{margin-top:4px}.awd-semantic-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.awd-semantic .awd-semantic-primary{background:var(--awd-accent);color:var(--awd-text-on-accent);border-color:var(--awd-accent)}.awd-semantic .awd-semantic-primary:hover{background:var(--awd-accent-hover);border-color:var(--awd-accent-hover)}.awd-semantic-hint{font-size:12px;color:var(--awd-text-2);margin:6px 0;white-space:pre-wrap}.awd-semantic-status{padding:12px 18px;background:var(--awd-accent-soft);white-space:pre-wrap;color:var(--awd-accent-text)}.awd-semantic-card{padding:15px 18px;border-top:1px solid var(--awd-border-subtle)}.awd-semantic-preview{font-size:14px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 12px}.awd-semantic details{border-left:2px solid var(--awd-gold-line);padding-left:10px;margin:10px 0;color:var(--awd-text-2)}.awd-semantic summary{cursor:pointer;font-size:12px}.awd-semantic blockquote{margin:8px 0;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.awd-semantic [hidden]{display:none!important}
  `
  doc.head.append(style); (overlayContainer || doc.body).append(root)
  if (overlayContainer) root.style.pointerEvents = 'auto'
  function element(tag, text, parent, cls) { const el = doc.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; parent?.append(el); return el }
  function button(text, parent, handler, cls) { const el = element('button', text, parent, cls); el.type = 'button'; el.addEventListener('click', () => Promise.resolve(handler()).catch(e => status(e.message))); return el }
  const sheet = element('section', null, root, 'awd-semantic-sheet'); sheet.hidden = true; sheet.setAttribute('aria-label', sw('panelTitle')); sheet.setAttribute('role', 'dialog')
  function reposition() {
    if (!bounds) return
    const b = bounds()
    root.style.right = Math.max(0, win.innerWidth - b.right + 16) + 'px'
    root.style.top = (b.top + 14) + 'px'
    sheet.style.width = Math.max(0, Math.min(420, b.width - 32)) + 'px'
    sheet.style.maxHeight = Math.max(0, b.height - 28) + 'px'
  }
  const head = element('div', null, sheet, 'awd-semantic-head'); element('strong', sw('panelTitle'), head); button(sw('closeBtn'), head, () => closePanel(true))
  const controls = element('div', null, sheet, 'awd-semantic-section')
  element('label', sw('docTypeLabel'), controls, 'awd-semantic-label')
  const profile = element('select', null, controls); profile.setAttribute('aria-label', sw('docTypeLabel'))
  for (const [value, label] of [['auto', sw('docTypeAuto')], ['litigation', sw('docTypeLitigation')], ['contract', sw('docTypeContract')], ['diligence', sw('docTypeDiligence')]]) { const option = element('option', label, profile); option.value = value }
  const settings = element('details', null, controls); element('summary', sw('stanceAndCutoffSummary'), settings)
  element('label', sw('stanceLabel'), settings, 'awd-semantic-label'); const stance = element('textarea', null, settings); stance.dataset.semanticStance = ''; stance.setAttribute('aria-label', sw('stanceLabel')); stance.maxLength = 120
  element('label', sw('cutoffLabel'), settings, 'awd-semantic-label'); const cutoff = element('input', null, settings); cutoff.type = 'date'; cutoff.setAttribute('aria-label', sw('stanceLabel') === 'Project Stance' ? 'Verification Cutoff Date' : '核查截止日')
  const saveButton = button(sw('saveSettingsBtn'), settings, async () => {
    saving = true; invalidate(true); updateActions(); status(sw('savingSettingsStatus'))
    try { await rpc('semantic-save-settings', { stance: stance.value, cutoffDate: cutoff.value }); status(sw('settingsSavedStatus')) }
    finally { saving = false; updateActions() }
  })
  element('div', sw('referenceMaterialsLabel'), controls, 'awd-semantic-label'); const files = element('div', null, controls, 'awd-semantic-files')
  element('div', sw('referenceMaterialsHint'), controls, 'awd-semantic-hint')
  const actions = element('div', null, sheet, 'awd-semantic-section'), actionGrid = element('div', null, actions, 'awd-semantic-actions')
  for (const [mode, label] of [['local', sw('modeLocal')], ['sentence', sw('modeSentence')], ['paragraph', sw('modeParagraph')], ['rewrite', sw('modeRewrite')]]) button(label, actionGrid, () => run(mode), mode === 'sentence' ? 'awd-semantic-primary' : '')
  element('div', sw('actionsHint'), actions, 'awd-semantic-hint')
  const statusEl = element('div', sw('initialStatus'), sheet, 'awd-semantic-status'); statusEl.setAttribute('role', 'status')
  const cancelButton = button(sw('cancelGenerateBtn'), sheet, () => { invalidate(true); status(sw('cancelledStatus')) }); cancelButton.hidden = true
  const output = element('div', null, sheet)
  function status(text) { statusEl.textContent = text || '' }
  // 面板的唯一入口在宿主的自建工具栏（dev-board#748）：客体只按指令开合，并把
  // 「这份文档有没有这项能力」与「面板此刻开着没有」回报给宿主同步按下态。
  // 关着时根节点整个 display:none——画布上不留一个像素，也截不到点击。
  function report() { try { transport.send({ __lo: 'lo-relay', type: 'semantic-writing-state', available, open: sheetOpen }) } catch (e) { /* 通道没起来 */ } }
  function applyOpen() { sheetOpen = sheetOpen && available; sheet.hidden = !sheetOpen; root.hidden = !sheetOpen }
  function closePanel(refocus) { if (!sheetOpen) return; sheetOpen = false; applyOpen(); invalidate(true); report(); if (refocus) focus?.() }
  function openPanel() { if (!available || sheetOpen) return; reposition(); sheetOpen = true; applyOpen(); report(); loadSettings().catch(e => status(e.message)) }
  function rpc(action, data = {}) {
    if (disposed || !session) return Promise.reject(new Error(sw('docSwitchedReopenError')))
    const id = `semantic-${++requestId}`, expected = session
    return new Promise((resolve, reject) => {
      const timeout = win.setTimeout(() => { pending.delete(id); reject(new Error(sw('requestTimeoutError'))) }, 120000)
      pending.set(id, { resolve, reject, timeout, session: expected })
      transport.send({ __lo: 'lo-relay', type: 'writing-request', session: expected, id, action, data })
    })
  }
  function stopTimer() { if (timer != null) win.clearTimeout(timer); timer = null }
  function invalidate(remote = false) {
    const hadActive = active, hadContent = output.childNodes.length > 0; sequence++; active = false; stopTimer(); output.replaceChildren(); cancelButton.hidden = true
    if (hadActive || hadContent) status(sw('contextChangedStatus'))
    if (remote && hadActive && session) rpc('semantic-cancel').catch(() => {})
  }
  async function loadSettings() {
    const expected = session; status(sw('loadingSettingsStatus'))
    const result = await rpc('semantic-settings'); if (disposed || expected !== session) return
    stance.value = result.stance || ''; cutoff.value = result.cutoffDate || ''; files.replaceChildren()
    const available = new Set((result.files || []).map(file => file.id))
    for (const id of selected) if (!available.has(id)) selected.delete(id)
    for (const file of result.files || []) {
      const row = element('label', null, files, 'awd-semantic-file'); const box = element('input', null, row); box.type = 'checkbox'; box.value = String(file.id); box.checked = selected.has(file.id)
      element('span', file.name, row)
      box.addEventListener('change', () => { if (box.checked) selected.add(file.id); else selected.delete(file.id); updateChecks(); invalidate(true); syncContext() })
    }
    updateChecks(); syncContext(); if (!active) status(sw('initialStatus'))
  }
  function syncContext() { rpc('semantic-context', { documentType: profile.value, sourceFileIds: [...selected] }).catch(e => status(e.message)) }
  function updateChecks() { for (const box of files.querySelectorAll('input')) box.disabled = !box.checked && selected.size >= 4 }
  function sourceDetails(parent, view, advice) {
    const chosen = (view.facts || []).filter(f => advice.factIds?.includes(f.id))
    const references = (view.sources || []).filter(s => advice.sourceIds?.includes(s.id) || chosen.some(f => f.sourceId === s.id))
    const details = element('details', null, parent); element('summary', sw('sourcesSummary', { count: references.length }), details)
    for (const source of references) {
      const name = element('div', [source.name, source.locator].filter(Boolean).join(' · '), details, 'awd-semantic-hint')
      if (source.version) name.title = sw('sourceVersionTitle', { version: source.version })
      const quotes = chosen.filter(f => f.sourceId === source.id).map(f => f.quote).filter(Boolean)
      if (quotes.length) for (const quote of new Set(quotes)) element('blockquote', quote, details)
      else element('blockquote', source.text || sw('sourceNoText'), details)
    }
  }
  function render(result, seq) {
    if (disposed || seq !== sequence) return
    const view = result.view || {}, notices = [...(result.notices || []), ...(view.warnings || [])]
    output.replaceChildren(); cancelButton.hidden = view.status !== 'RUNNING'
    if (view.status === 'RUNNING') {
      status(sw('runningStatus'))
      timer = win.setTimeout(async () => { try { render(await rpc('semantic-poll'), seq) } catch (e) { if (seq === sequence) status(e.message) } }, 800)
      return
    }
    stopTimer()
    const labels = {
      READY: sw('readyStatus', { profile: view.profileLabel || sw('currentDocFallback') }),
      EMPTY: sw('emptyStatus'),
      FAILED: view.error || sw('failedFallback'),
      CANCELLED: sw('cancelledStatus'),
    }
    status([labels[view.status] || sw('noSuggestionFallback'), ...notices].join('\n'))
    if (!['READY', 'EMPTY'].includes(view.status)) { active = false; return }
    if (!(view.advice || []).length && (view.facts || []).length) {
      if (view.status === 'EMPTY') status([sw('factsOnlyStatus'), ...notices].join('\n'))
      const card = element('div', null, output, 'awd-semantic-card'); element('strong', sw('factsCardTitle'), card)
      const states = {
        PENDING: sw('factStatePending'),
        CONFLICT: sw('factStateConflict'),
        MISSING: sw('factStateMissing'),
        CLAIM: sw('factStateClaim'),
        COUNTERPARTY_PROPOSAL: sw('factStateCounterparty'),
      }
      for (const fact of view.facts) {
        const row = element('div', `${fact.label}：${fact.value}`, card)
        element('span', ` · ${[states[fact.status] || sw('factStateRecorded'), fact.role].filter(Boolean).join(' · ')}`, row, 'awd-semantic-hint')
        sourceDetails(card, view, { factIds: [fact.id], sourceIds: [fact.sourceId] })
      }
    }
    if (view.status !== 'READY') { active = false; return }
    for (const [index, advice] of (view.advice || []).entries()) {
      const card = element('div', null, output, 'awd-semantic-card'); element('strong', sw('adviceCardTitle'), card)
      element('div', advice.text, card, 'awd-semantic-preview'); if (advice.explanation) element('div', advice.explanation, card, 'awd-semantic-hint')
      sourceDetails(card, view, advice)
      button(sw('acceptBtn'), card, async () => {
        if (composing) { status(sw('finishComposingBeforeAcceptError')); return }
        if (seq !== sequence) return
        accepting = true
        try { const applied = await rpc('semantic-accept', { index, composing }); if (seq !== sequence) return; if (!applied.applied) throw new Error(sw('acceptFailedError')); invalidate(); status(applied.message || sw('acceptedUndoHint')); focus?.() }
        finally { accepting = false }
      }, 'awd-semantic-primary')
    }
  }
  function updateActions() { saveButton.disabled = saving; for (const button of actionGrid.querySelectorAll('button')) button.disabled = saving }
  async function run(mode) {
    if (saving) { status(sw('savingWaitGenerateError')); return }
    if (composing) { status(sw('finishComposingBeforeGenerateError')); return }
    invalidate(true); active = true; const seq = sequence; cancelButton.hidden = false; status(sw('readingContextStatus'))
    try { render(await rpc('semantic-generate', { mode, documentType: profile.value, sourceFileIds: [...selected], composing }), seq) }
    catch (e) { if (seq === sequence) { active = false; cancelButton.hidden = true; status(e.message) } }
  }
  const unsubscribe = transport.subscribe(msg => {
    if (disposed) return
    if (msg?.type === 'writing-config') {
      const config = msg.config || {}
      if ('session' in config && config.session !== session) { invalidate(); selected.clear(); files.replaceChildren(); stance.value = ''; cutoff.value = ''; profile.value = 'auto'; sheetOpen = false; session = config.session || ''; for (const item of pending.values()) { win.clearTimeout(item.timeout); item.reject(new Error(sw('docSwitchedError'))) } pending.clear() }
      if ('writable' in config) writable = !!config.writable
      const wasOpen = sheetOpen
      available = !!session && !!writable
      applyOpen()
      if (wasOpen && !sheetOpen) invalidate(true)
      report()
      if (config.semantic?.state === 'STALE') invalidate()
      return
    }
    // 宿主工具栏的开合指令（dev-board#748）。
    if (msg?.type === 'semantic-writing-panel') { if (msg.open) openPanel(); else closePanel(false); return }
    if (msg?.type !== 'writing-response' || msg.session !== session) return
    const item = pending.get(msg.id); if (!item) return
    pending.delete(msg.id); win.clearTimeout(item.timeout)
    if (msg.error) item.reject(new Error(msg.error)); else item.resolve(msg.result)
  })
  const ownComposition = event => !overlayContainer || event.target === input || root.contains(event.target)
  const beginComposition = event => { if (!ownComposition(event)) return; composing = true; if (active) invalidate(true) }
  const endComposition = event => { if (ownComposition(event)) composing = false }
  doc.addEventListener('compositionstart', beginComposition, true); doc.addEventListener('compositionend', endComposition, true)
  sheet.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') closePanel(true) })
  profile.addEventListener('change', () => { invalidate(true); syncContext() }); stance.addEventListener('input', () => invalidate(true)); cutoff.addEventListener('change', () => invalidate(true))
  return {
    reposition,
    isComposing() { return composing },
    cursorMoved() { if (!accepting && active) invalidate(true) },
    committed() { if (!accepting && active) invalidate(true) },
    destroy() { if (disposed) return; invalidate(true); disposed = true; unsubscribe?.(); for (const item of pending.values()) { win.clearTimeout(item.timeout); item.reject(new Error(sw('docClosedError'))) } pending.clear(); doc.removeEventListener('compositionstart', beginComposition, true); doc.removeEventListener('compositionend', endComposition, true); root.remove(); style.remove() },
  }
}
