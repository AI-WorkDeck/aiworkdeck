// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Framing calls (US office only): a founder books a lawyer before any drafting. Here the lawyer reads an AI pre-call
// brief, confirms one of the proposed times (an AI WorkDeck calendar task with a reminder), records the call only with
// every participant's consent (transcript stays in the case project), lets AI turn the call into a framework memo and a
// document plan, sends the plan to the client, and has AI check each document drafted from it against the framework.
// Loaded by matters.js through window.AIF_DESK; a build without this file simply has no "Framing calls" tab.
(function () {
  'use strict'
  const $ = (id) => document.getElementById(id)
  const F = { list: [], selected: null, detail: null, catalog: null, brief: {}, review: {}, rec: null, recTimer: null, busy: '', draft: {} }
  // Unsaved work per matter (notes, memo, ticked documents, consent): the desk's 30-second refresh redraws the
  // detail, so every field writes here as it changes and is restored from here on render. Cleared once sent.
  const draftOf = (id) => (F.draft[id] = F.draft[id] || {})
  let D // window.AIF_DESK: { call, t, h, E, toast, fail, S, openMatter }
  const t = (k, v) => D.t('fr.' + k, v)
  const h = (...a) => D.h(...a)

  const isFraming = (m) => m && m.consult && m.consult.kind === 'framing'
  const stage = (c) => (c.framework ? 'planned' : c.status === 'scheduled' ? 'scheduled' : 'requested')
  const when = (iso) => { try { return new Date(iso).toLocaleString((D && D.E.locale && D.E.locale()) || undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return iso } }
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  // AI text → safe HTML: escape first, then bold, list items and paragraphs.
  function md(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map((p) => (/^\s*([-*•]|\d+[.)])\s/m.test(p)
      ? '<ul>' + p.split('\n').map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')).filter(Boolean).map((l) => '<li>' + l + '</li>').join('') + '</ul>'
      : '<p>' + p.replace(/\n/g, '<br>') + '</p>')).join('')
  }
  const aiText = (el, text) => { el.innerHTML = md(text) }
  const ai = (prompt, purpose) => awd.ai.request(prompt, { purpose, timeoutMs: 120000, system: 'You assist a US-licensed startup lawyer inside AI WorkDeck. Be concise, practical and accurate; never invent facts about the client. Answer in the language of the lawyer\'s interface: ' + (document.documentElement.lang || 'en') + '.' })

  async function catalog() {
    if (F.catalog) return F.catalog
    try { const c = await D.call('svConfig'); F.catalog = (c && c.templates) || [] } catch { F.catalog = [] }
    return F.catalog
  }
  const docTitle = (id) => { const x = (F.catalog || []).find((c) => c.id === id); return x ? D.E.pick(x.title) : id }

  async function refresh() {
    if (!D || D.S.office !== 'sv') return
    try {
      const r = await D.call('matters', { all: '1' })
      F.list = ((r && r.matters) || []).filter(isFraming)
      D.setFramingCount(F.list.filter((m) => stage(m.consult) !== 'planned').length)
      renderList()
      if (F.selected) await open(F.selected, true)
    } catch (e) { D.fail(e, 'panel.error.load') }
  }

  function renderList() {
    const el = $('fr-list')
    if (!F.list.length) {
      el.replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-title' }, t('emptyTitle')), h('p', { class: 'awd-empty-desc' }, t('emptyDesc'))))
      $('fr-detail').replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-desc' }, t('select'))))
      return
    }
    const badge = { requested: 'awd-badge-danger', scheduled: 'awd-badge-accent', planned: 'awd-badge-success' }
    el.replaceChildren(...F.list.map((m) => {
      const c = m.consult, st = stage(c)
      return h('button', { type: 'button', role: 'option', 'aria-selected': String(F.selected === m.id), class: 'lead' + (F.selected === m.id ? ' is-active' : ''), on: { click: () => open(m.id) } },
        h('div', { class: 'top' }, h('span', { class: 'awd-badge ' + badge[st] }, t('stage.' + st)), h('span', { class: 'name' }, c.name || m.company || '—'), h('span', { class: 'when' }, c.scheduledAt ? when(c.scheduledAt) : '')),
        h('div', { class: 'tags' }, h('span', { class: 'muted' }, (c.topic || c.note || '').slice(0, 90))))
    }))
  }

  async function open(id, quiet) {
    F.selected = id
    if (!quiet) renderList()
    try {
      F.detail = await D.call('matter', { id })
      await catalog()
      renderDetail()
    } catch (e) { D.fail(e) }
  }

  function section(title, ...body) { return h('div', { class: 'section' }, h('h3', {}, title), ...body) }

  function renderDetail() {
    const m = F.detail, c = m && m.consult
    if (!c) return
    const st = stage(c)
    $('fr-detail').replaceChildren(...[
      h('div', { class: 'section' },
        h('h2', {}, c.name || '—'),
        h('div', { class: 'muted' }, [c.email, c.phone].filter(Boolean).join(' · ')),
        h('p', {}, c.topic || c.note || ''),
        h('div', { class: 'tags' },
          h('span', { class: 'awd-badge' }, t('stage.' + st)),
          h('span', { class: 'awd-badge ' + (c.recordingConsent ? 'awd-badge-success' : 'awd-badge-warning') }, t(c.recordingConsent ? 'clientConsentYes' : 'clientConsentNo')))),
      briefSection(m),
      st === 'requested' ? scheduleSection(m) : scheduledSection(c),
      st !== 'requested' ? callSection(m) : null,
      c.framework ? reviewSection(m) : null].filter(Boolean))
  }

  // ---- 1. AI pre-call brief ----
  function briefSection(m) {
    const c = m.consult, out = h('div', { class: 'ai-out' })
    if (F.brief[m.id]) aiText(out, F.brief[m.id])
    const btn = h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: async () => {
      btn.disabled = true; out.textContent = t('thinking')
      try {
        const docs = (await catalog()).map((x) => `${x.id}: ${D.E.pick(x.title)}`).join('\n')
        F.brief[m.id] = await ai(`A founder booked a framing call before any drafting.\nTheir words: "${c.topic || c.note || ''}"\nFacts on file: ${JSON.stringify(m.facts || {})}\n\nWrite a pre-call brief: (1) the situation in two lines, (2) a 20-minute agenda, (3) the questions to ask, (4) the likely documents, chosen only from this catalogue:\n${docs}`, 'aifirm-framing-brief')
        aiText(out, F.brief[m.id])
      } catch (e) { out.textContent = ''; D.fail(e) } finally { btn.disabled = false }
    } } }, t(F.brief[m.id] ? 'briefAgain' : 'brief'))
    return section(t('briefTitle'), btn, out)
  }

  // ---- 2. Confirm a time: the portal, then an AI WorkDeck calendar task with a reminder ----
  function scheduleSection(m) {
    const c = m.consult
    const radios = (c.slots || []).map((s, i) => h('label', { class: 'slot' }, h('input', { type: 'radio', name: 'fr-slot', value: s, checked: i === 0 }), h('span', {}, when(s))))
    const link = h('input', { class: 'awd-input', type: 'url', placeholder: 'https://' })
    const project = h('select', { class: 'awd-select' }, h('option', { value: '' }, t('noCalendar')))
    awd.services.request('calendar', 'projects', {}).then((ps) => {
      const list = Array.isArray(ps) ? ps : (ps && ps.data) || []
      for (const p of list.filter((x) => x.myRole !== 'VIEWER')) project.append(h('option', { value: p.id }, p.name))
    }).catch(() => {})
    const btn = h('button', { type: 'button', class: 'awd-btn awd-btn-primary', on: { click: async () => {
      const slot = (document.querySelector('input[name="fr-slot"]:checked') || {}).value
      if (!slot) return
      if (link.value && !/^https:\/\/\S+$/.test(link.value)) { D.toast(t('badLink')); return }
      btn.disabled = true
      try {
        await D.call('matterConsult', { id: m.id, status: 'scheduled', scheduledAt: slot, link: link.value || '' })
        if (project.value) {
          const d = new Date(slot), pad = (n) => String(n).padStart(2, '0')
          await awd.services.request('calendar', 'create', { data: { projectId: project.value, title: t('taskTitle', { name: c.name || '' }), dueDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, dueTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`, remindBefore: 30, notes: [c.topic || '', link.value].filter(Boolean).join('\n') } })
            .catch((e) => D.toast(t('calendarFailed') + (e && e.code ? ' (' + e.code + ')' : '')))
        }
        D.toast(t('scheduledToast'))
        await refresh()
      } catch (e) { D.fail(e) } finally { btn.disabled = false }
    } } }, t('confirm'))
    return section(t('timesTitle'), h('div', { class: 'slots' }, ...radios), h('label', {}, t('link'), link), h('label', {}, t('calendar'), project), btn)
  }
  function scheduledSection(c) {
    return section(t('scheduledTitle'), h('p', {}, when(c.scheduledAt)), c.link ? h('a', { class: 'awd-btn awd-btn-sm', href: c.link, target: '_blank', rel: 'noopener' }, t('join')) : null)
  }

  // ---- 3. The call: record only with everyone's consent; then AI turns it into a framework and a plan ----
  function callSection(m) {
    const c = m.consult
    const dr = draftOf(m.id)
    const consent = h('input', { type: 'checkbox', checked: Boolean(dr.consent), on: { change: () => { dr.consent = consent.checked } } })
    const recOn = Boolean(F.rec && F.rec.active && F.rec.matterId === m.id)
    const indicator = h('span', { class: 'rec-indicator', hidden: !recOn }, h('i'), h('span', { class: 'rec-time' }, ''))
    const notes = h('textarea', { class: 'awd-input notes', rows: 7, placeholder: t('notesHint'), on: { input: () => { dr.notes = notes.value } } })
    notes.value = dr.notes ?? ((F.rec && F.rec.matterId === m.id && F.rec.text) || '')
    const recBtn = h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: () => (F.rec && F.rec.active ? stopRec(recBtn, indicator, notes, dr) : startRec(m, consent, recBtn, indicator)) } }, t(recOn ? 'recStop' : 'recStart'))
    const memo = h('textarea', { class: 'awd-input memo', rows: 9, on: { input: () => { dr.memo = memo.value } } })
    const docs = h('div', { class: 'docs', on: { change: () => { dr.docs = [...docs.querySelectorAll('input:checked')].map((x) => x.value) } } })
    const fill = (fw) => {
      memo.value = (fw && fw.memo) || ''
      const chosen = new Set((fw && fw.documents) || [])
      docs.replaceChildren(...(F.catalog || []).map((x) => h('label', { class: 'doc' }, h('input', { type: 'checkbox', value: x.id, checked: chosen.has(x.id) }), h('span', {}, D.E.pick(x.title)))))
    }
    const saved = c.framework ? { memo: c.framework.memo, documents: c.framework.documents.map((d) => d.id || d) } : null
    fill({ memo: dr.memo ?? (saved && saved.memo), documents: dr.docs ?? (saved && saved.documents) })
    const gen = h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: async () => {
      if (notes.value.trim().length < 20) { D.toast(t('notesNeeded')); return }
      gen.disabled = true
      try {
        const list = F.catalog.map((x) => `${x.id}: ${D.E.pick(x.title)}`).join('\n')
        const raw = await ai(`From this framing call with a founder, write the agreed framework and choose the documents to prepare.\nClient's request: "${c.topic || ''}"\nCall notes / transcript:\n${notes.value.slice(0, 12000)}\n\nReturn only JSON: {"memo": "<the framework in 3-8 short bold-labelled lines, e.g. **Seed round:** ...>", "documents": ["<ids, 1 to 5, only from this catalogue>"]}\nCatalogue:\n${list}`, 'aifirm-framing-plan')
        const j = JSON.parse(String(raw).slice(String(raw).indexOf('{'), String(raw).lastIndexOf('}') + 1))
        dr.memo = j.memo; dr.docs = (j.documents || []).filter((id) => F.catalog.some((x) => x.id === id))
        fill({ memo: dr.memo, documents: dr.docs })
      } catch (e) { D.toast(t('aiFailed')) } finally { gen.disabled = false }
    } } }, t('generate'))
    const send = h('button', { type: 'button', class: 'awd-btn awd-btn-primary', on: { click: async () => {
      const documents = [...docs.querySelectorAll('input:checked')].map((x) => x.value)
      if (memo.value.trim().length < 20 || !documents.length) { D.toast(t('planNeeded')); return }
      send.disabled = true
      try { await D.call('matterConsult', { id: m.id, status: 'done', framework: { memo: memo.value.trim(), documents } }); delete F.draft[m.id]; D.toast(t('planSent')); await refresh() } catch (e) { D.fail(e) } finally { send.disabled = false }
    } } }, t(c.framework ? 'planUpdate' : 'planSend'))
    return h('div', { class: 'call' },
      section(t('recTitle'), h('label', { class: 'check' }, consent, h('span', {}, t('recConsent'))), h('div', { class: 'row' }, recBtn, indicator), h('p', { class: 'muted' }, t('recNote'))),
      section(t('notesTitle'), notes, gen),
      section(t('planTitle'), memo, h('div', { class: 'muted' }, t('docsLabel')), docs, send))
  }

  async function startRec(m, consent, btn, indicator) {
    // Two-party consent: never start without the lawyer confirming every participant agreed.
    if (!consent.checked) { D.toast(t('recConsentNeeded')); return }
    btn.disabled = true
    try {
      await awd.services.request('voice', 'start', {})
      F.rec = { matterId: m.id, active: true, at: Date.now(), text: '' }
      indicator.hidden = false
      clearInterval(F.recTimer)
      // The timer looks the indicator up on each tick: a refresh may have redrawn it.
      F.recTimer = setInterval(() => { const s = Math.floor((Date.now() - F.rec.at) / 1000), el = document.querySelector('#fr-detail .rec-time'); if (el) el.textContent = `${t('recording')} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }, 1000)
      btn.textContent = t('recStop')
    } catch (e) {
      D.toast(e && e.code === 'no_project' ? t('recNeedsProject') : e && e.code === 'notice_required' ? t('recNotice') : t('recFailed') + (e && e.code ? ' (' + e.code + ')' : ''))
    } finally { btn.disabled = false }
  }
  async function stopRec(btn, indicator, notes, dr) {
    btn.disabled = true
    try {
      const meeting = await awd.services.request('voice', 'stop', {})
      clearInterval(F.recTimer); indicator.hidden = true; F.rec.active = false; btn.textContent = t('recStart')
      if (meeting && meeting.id) {
        D.toast(t('transcribing'))
        await awd.services.request('voice', 'transcribe', { id: meeting.id }).catch(() => {})
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 6000))
          const g = await awd.services.request('voice', 'get', { id: meeting.id }).catch(() => null)
          const text = transcriptText(g)
          if (text) { F.rec.text = text; dr.notes = text; const el = document.querySelector('#fr-detail textarea.notes'); if (el) el.value = text; break }
          if (g && /fail|error/i.test(String(g.status || ''))) break
        }
      }
    } catch (e) { D.toast(t('recFailed')) } finally { btn.disabled = false }
  }
  // The host's recording keeps its transcript as JSON segments; collect their text in order.
  function transcriptText(g) {
    const raw = g && (g.transcriptJson || (g.data && g.data.transcriptJson))
    if (!raw) return ''
    let j; try { j = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return String(raw) }
    const out = []
    const walk = (o) => { if (!o) return; if (Array.isArray(o)) o.forEach(walk); else if (typeof o === 'object') { if (typeof o.text === 'string') out.push((o.speaker ? o.speaker + ': ' : '') + o.text); else Object.values(o).forEach(walk) } }
    walk(j)
    return out.join('\n')
  }

  // ---- 4. Each document drafted from the plan, checked against the framework ----
  function reviewSection(m) {
    const fw = m.consult.framework
    const started = fw.started || {}
    return section(t('reviewTitle'), h('ol', { class: 'plan' }, ...fw.documents.map((d) => {
      const id = d.id || d, child = started[id], out = h('div', { class: 'ai-out' })
      if (F.review[child]) aiText(out, F.review[child])
      const btn = child && h('button', { type: 'button', class: 'awd-btn awd-btn-xs', on: { click: async () => {
        btn.disabled = true; out.textContent = t('thinking')
        try {
          const cm = await D.call('matter', { id: child })
          const v = (cm.versions || [])[cm.versions.length - 1]
          if (!v) { out.textContent = t('noDraft'); return }
          F.review[child] = await ai(`Check this draft against the framework the lawyer agreed with the client. Start with a one-line bold verdict counting what you found, e.g. **1 mismatch, 1 point to confirm**, or **Consistent with the framework** only if there is no mismatch. Then list each mismatch or omission (quote the clause and give the agreed term), then anything to confirm with the client.\n\nFramework:\n${fw.memo}\n\nDraft (${docTitle(id)}):\n${String(v.markdown).slice(0, 30000)}`, 'aifirm-framing-review')
          aiText(out, F.review[child])
        } catch (e) { out.textContent = ''; D.fail(e) } finally { btn.disabled = false }
      } } }, t('check'))
      return h('li', {}, h('div', { class: 'row' }, h('span', {}, docTitle(id)),
        child ? h('span', { class: 'row' }, btn, h('button', { type: 'button', class: 'awd-btn awd-btn-xs', on: { click: () => D.openMatter(child) } }, t('openDraft'))) : h('span', { class: 'muted' }, t('notStarted'))), out)
    })))
  }

  window.AIF_FRAMING = {
    init(desk) { D = desk },
    refresh,
  }
})()
