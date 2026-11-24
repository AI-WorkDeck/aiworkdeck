// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict'
  const CONN = 'intake'
  const STATUSES = ['new', 'contacted', 'meeting', 'engaged', 'closed']
  const POLL_MS = 30000
  const $ = (id) => document.getElementById(id)
  const state = { event: '', topic: '', status: '', q: '', anon: false, leads: [], selected: null, detail: null, summary: null, seenHot: null, draft: null }
  let dict = {}
  let zh = false
  let zht = false
  let uiLocale = 'en-US' // dates follow the host UI language, not Electron's default locale

  function t(key, vars) {
    let s = dict[key] || (window.ELP_L10N['en-US'] || {})[key] || key
    for (const k in vars || {}) s = s.split('{' + k + '}').join(vars[k])
    return s
  }
  const pick = (obj) => {
    if (!obj) return ''
    if (zht) return obj.zht || obj.zh || obj.en || ''
    if (zh) return obj.zh || obj.zht || obj.en || ''
    return obj.en || obj.zht || obj.zh || ''
  }
  function applyLanguage(lang) {
    const all = window.ELP_L10N || {}
    const code = all[lang] ? lang : Object.keys(all).find((k) => k.split('-')[0] === String(lang || '').split('-')[0]) || 'en-US'
    dict = all[code] || {}
    uiLocale = code
    zh = code.startsWith('zh')
    zht = /^zh-(TW|HK|MO|Hant)/i.test(code) || code === 'zh-TW'
    document.documentElement.lang = code
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n) })
    $('search').placeholder = t('panel.filter.search')
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag)
    for (const k in attrs || {}) {
      const v = attrs[k]
      if (k === 'on') for (const ev in v) el.addEventListener(ev, v[ev])
      else if (k === 'class') el.className = v
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v)
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid)
    return el
  }

  function ago(iso) {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
    if (m < 1) return t('panel.ago.now')
    if (m < 60) return t('panel.ago.min', { n: m })
    if (m < 1440) return t('panel.ago.hour', { n: Math.round(m / 60) })
    return t('panel.ago.day', { n: Math.round(m / 1440) })
  }
  const heatBadge = (l) => h('span', { class: 'awd-badge ' + ({ hot: 'awd-badge-danger', warm: 'awd-badge-warning', cold: 'awd-badge-info' }[l.heat] || '') }, t('panel.heat.' + l.heat) + ' · ' + l.score)
  const eventBadge = (l) => {
    const events = (state.summary && state.summary.events) || []
    const e = !state.event && events.length > 1 && events.find((x) => x.code === l.event)
    return e ? h('span', { class: 'awd-badge' }, pick(e.name)) : null
  }
  const topicBadge = (id) => h('span', { class: 'awd-badge' }, t('panel.topic.' + id))
  const statusBadge = (s) => h('span', { class: 'awd-badge' + (s === 'engaged' ? ' awd-badge-accent' : '') }, t('panel.status.' + s))
  const leadName = (l) => l.company || l.name || t('panel.anonymous')

  let noticeSource = null
  function notice(kind, text, actions, source = 'action') {
    const el = $('notice')
    if (!kind) { el.hidden = true; el.replaceChildren(); noticeSource = null; return }
    noticeSource = source
    el.hidden = false
    el.className = 'awd-notice ' + (kind === 'danger' ? 'awd-notice-danger' : kind === 'warning' ? 'awd-notice-warning' : '')
    el.setAttribute('role', kind === 'danger' ? 'alert' : 'status')
    el.replaceChildren(h('span', {}, text), ...(actions || []))
  }

  const call = (op, params) => awd.connections.request(CONN, op, params || {}, { timeoutMs: 60000 })

  async function connected() {
    try {
      const { connections } = await awd.connections.list()
      const c = (connections || []).find((x) => x.id === CONN)
      return Boolean(c && c.connected && !c.needsReconnect)
    } catch (e) {
      if (e.code === 'unknown_method') { notice('danger', t('panel.error.upgrade')); return null }
      throw e
    }
  }

  let connectRetry = null
  function showConnect() {
    clearTimeout(connectRetry); connectRetry = setTimeout(() => { if (!document.hidden) load() }, 4000)
    $('board').hidden = true
    $('btn-qr').disabled = $('btn-export').disabled = true
    notice('warning', t('panel.connect.title') + ' — ' + t('panel.connect.desc'), [
      h('button', { type: 'button', class: 'awd-btn awd-btn-xs awd-btn-primary', on: { click: () => awd.connections.connect(CONN).catch(() => {}) } }, t('panel.connect.button')),
      h('button', { type: 'button', class: 'awd-btn awd-btn-xs', on: { click: load } }, t('panel.connect.retry')),
    ], 'load')
  }

  let loading = false
  let reloadQueued = false
  async function load() {
    if (window.FIRM && window.FIRM.events === false) return
    if (loading) { reloadQueued = true; return }
    loading = true
    try {
      const ok = await connected()
      if (ok === null) return
      if (!ok) return showConnect()
      const params = { all: state.anon ? '1' : '0' }
      const scope = state.event ? { event: state.event } : {}
      Object.assign(params, scope)
      if (state.topic) params.topic = state.topic
      if (state.status) params.status = state.status
      if (state.q) params.q = state.q
      const [summary, list] = await Promise.all([call('summary', scope), call('leads', params)])
      if ((scope.event || '') !== state.event) { reloadQueued = true; return }
      if (noticeSource === 'load') notice(null)
      state.summary = summary
      state.leads = list.leads || []
      announceHot(summary)
      renderBoard()
      if (state.selected) await loadDetail(state.selected, true)
    } catch (e) {
      notice('danger', t('panel.error.load'), [h('button', { type: 'button', class: 'awd-btn awd-btn-xs', on: { click: load } }, t('panel.connect.retry'))], 'load')
    } finally {
      loading = false
      if (reloadQueued) { reloadQueued = false; load() }
    }
  }

  function announceHot(summary) {
    if (state.seenHot !== null && summary.hot > state.seenHot) {
      const newest = state.leads.filter((l) => l.heat === 'hot' && l.hasContact).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (newest) awd.ui.toast(t('panel.toast.hot', { name: leadName(newest) })).catch(() => {})
    }
    state.seenHot = summary.hot
  }

  function renderBoard() {
    const s = state.summary
    $('board').hidden = false
    $('btn-qr').disabled = $('btn-export').disabled = false
    const events = s.events || []
    if (!$('leads-view').hidden) $('title').textContent = !state.event && events.length > 1 ? t('panel.filter.allEvents') : [pick(s.event), s.firm].filter(Boolean).join(' · ')
    const evSel = $('event')
    evSel.hidden = events.length < 2
    evSel.replaceChildren(h('option', { value: '' }, t('panel.filter.allEvents')), ...events.map((e) => h('option', { value: e.code }, pick(e.name))))
    evSel.value = state.event

    const kpi = (label, value) => h('div', { class: 'awd-kpi-card' }, h('div', { class: 'awd-kpi-label' }, label), h('div', { class: 'awd-kpi-value' }, String(value)))
    $('kpis').replaceChildren(kpi(t('panel.kpi.visitors'), s.visitors), kpi(t('panel.kpi.engaged'), s.engaged), kpi(t('panel.kpi.leads'), s.leads), kpi(t('panel.kpi.hot'), s.hot), kpi(t('panel.kpi.today'), s.today))

    const tab = (id, label) => h('button', { type: 'button', class: 'awd-subnav-item' + (state.topic === id ? ' is-active' : ''), 'aria-pressed': String(state.topic === id), on: { click: () => { state.topic = id; load() } } }, label)
    $('topics').replaceChildren(tab('', t('panel.filter.all') + ' ' + s.leads), ...Object.keys(s.byTopic).map((id) => tab(id, t('panel.topic.' + id) + ' ' + s.byTopic[id])))

    const sel = $('status')
    sel.replaceChildren(h('option', { value: '' }, t('panel.filter.anyStatus')), ...STATUSES.map((st) => h('option', { value: st }, t('panel.status.' + st) + ' ' + (s.byStatus[st] || 0))))
    sel.value = state.status

    renderList()
  }

  function renderList() {
    const list = $('list')
    if (!state.leads.length) {
      const filtered = state.topic || state.status || state.q
      list.replaceChildren(h('div', { class: 'awd-empty' },
        h('p', { class: 'awd-empty-title' }, filtered ? t('panel.empty.filtered') : t('panel.empty.title')),
        filtered ? null : h('p', { class: 'awd-empty-desc' }, t('panel.empty.desc'))))
      if (!state.selected) renderDetailEmpty()
      return
    }
    list.replaceChildren(...state.leads.map((l) => h('button', {
      type: 'button', role: 'option', 'aria-selected': String(state.selected === l.id),
      class: 'lead' + (state.selected === l.id ? ' is-active' : ''), on: { click: () => loadDetail(l.id) },
    },
      h('div', { class: 'top' }, heatBadge(l), h('span', { class: 'name', title: leadName(l) }, leadName(l)), h('span', { class: 'when' }, ago(l.updatedAt))),
      l.headline ? h('div', { class: 'headline' }, l.headline) : null,
      h('div', { class: 'tags' }, eventBadge(l), l.topics.map(topicBadge), statusBadge(l.status)))))
    if (!state.selected) renderDetailEmpty()
  }

  function renderDetailEmpty() {
    $('detail').replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-desc' }, t('panel.select'))))
  }

  function mdInline(text) {
    return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? h('strong', {}, p.slice(2, -2)) : p))
  }
  function mdNodes(md) {
    const out = []; let list = null
    for (const raw of String(md || '').split('\n')) {
      const line = raw.trim(); let m
      if (!line || /^#\s/.test(line)) { list = null; continue }
      if ((m = /^#{2,}\s+(.+)/.exec(line))) { list = null; out.push(h('h3', { class: 'md-h' }, mdInline(m[1]))); continue }
      if ((m = /^>\s?(.*)/.exec(line))) { list = null; out.push(h('blockquote', { class: 'md-quote' }, mdInline(m[1]))); continue }
      if ((m = /^(?:[-*•]|\d+[.)])\s+(.+)/.exec(line))) { if (!list) { list = h('ul', {}); out.push(list) } list.append(h('li', {}, mdInline(m[1]))); continue }
      list = null; out.push(h('p', { class: 'md-p' }, mdInline(line)))
    }
    return out
  }

  async function loadDetail(id, quiet) {
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)
    if (quiet && typing && $('detail').contains(document.activeElement)) return
    state.selected = id
    if (!quiet) { state.draft = null; renderList() }
    try {
      state.detail = await call('lead', { id })
      renderDetail()
      if (!quiet && window.innerWidth < 760) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) {
      if (!quiet) notice('danger', t('panel.error.action'))
    }
  }

  function renderDetail() {
    const d = state.detail
    const c = d.contact || {}
    const contactLines = [
      [c.name, c.role].filter(Boolean).join(' · '),
      c.email ? h('a', { href: 'mailto:' + c.email, class: 'ltr', target: '_blank', rel: 'noopener' }, c.email) : null,
      c.phone ? h('span', { class: 'ltr' }, c.phone) : null,
    ].filter(Boolean).map((x) => h('span', {}, x))

    const b = d.brief
    const briefEl = h('section', { class: 'section' },
      h('div', { class: 'row' }, h('span', { class: 'section-title' }, b && b.source === 'rules' ? t('panel.detail.ruleBrief') : t('panel.detail.brief')),
        h('button', { type: 'button', class: 'awd-btn awd-btn-xs', on: { click: regenerate } }, t('panel.detail.regenerate'))),
      b ? h('div', { class: 'brief' },
        h('p', { class: 'headline' }, b.headline),
        h('dl', {},
          b.needs && b.needs.length ? [h('dt', {}, t('panel.detail.needs')), h('dd', {}, h('ul', {}, b.needs.map((n) => h('li', {}, n))))] : null,
          b.nextStep ? [h('dt', {}, t('panel.detail.next')), h('dd', {}, b.nextStep)] : null,
          b.flags && b.flags.length ? [h('dt', {}, t('panel.detail.flags')), h('dd', {}, h('ul', {}, b.flags.map((f) => h('li', {}, f))))] : null))
        : h('p', { class: 'muted' }, t('panel.detail.noBrief')))

    const pipeline = h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('panel.detail.pipeline')),
      h('div', { class: 'pipeline' }, STATUSES.map((s) => h('button', {
        type: 'button', class: 'awd-btn awd-btn-sm' + (d.status === s ? ' awd-btn-primary' : ''), 'aria-pressed': String(d.status === s),
        on: { click: () => update({ status: s }) },
      }, t('panel.status.' + s)))))

    const owner = h('input', { class: 'awd-input', value: d.owner || '', placeholder: t('panel.detail.ownerPlaceholder'), 'aria-label': t('panel.detail.owner') })
    const notes = h('textarea', { class: 'awd-textarea', placeholder: t('panel.detail.notesPlaceholder'), 'aria-label': t('panel.detail.notes') })
    notes.value = d.notes || ''
    const saveBtn = h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: async () => {
      if (await update({ owner: owner.value, notes: notes.value }, true)) { saveBtn.textContent = t('panel.detail.saved'); setTimeout(() => { saveBtn.textContent = t('panel.detail.save') }, 1500) }
    } } }, t('panel.detail.save'))

    const actions = h('div', { class: 'row' },
      h('button', { type: 'button', class: 'awd-btn awd-btn-sm awd-btn-primary', on: { click: draftEmail }, disabled: !c.email }, t('panel.action.email')),
      h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: handToAssistant } }, t('panel.action.assistant')))

    const answers = d.answers.length ? h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('panel.detail.answers')),
      d.answers.map((a) => h('div', { class: 'section' }, topicBadge(a.topic),
        h('dl', { class: 'qa' }, a.items.map((i) => [h('dt', {}, pick(i.question)), h('dd', {}, pick(i.answer))]))))) : null

    const bf = d.briefing
    const briefingEl = bf ? h('details', { class: 'section briefing' },
      h('summary', { class: 'section-title' }, t('panel.detail.briefing') + (bf.title ? ' · ' + bf.title : '')),
      h('div', { class: 'tags' }, Object.values(bf.choices || {}).map((o) => h('span', { class: 'awd-badge' }, pick(o))),
        bf.complete ? null : h('span', { class: 'awd-badge awd-badge-warning' }, t('panel.detail.briefingIncomplete'))),
      h('div', { class: 'md' }, mdNodes(bf.markdown))) : null

    const userMsgs = d.transcript.filter((m) => m.role === 'user').length
    const transcript = h('details', { class: 'section' },
      h('summary', { class: 'section-title' }, t('panel.detail.chat', { n: d.transcript.length })),
      d.transcript.length ? h('div', { class: 'transcript' }, d.transcript.map((m) => h('div', { class: 'bubble ' + m.role },
        h('small', {}, m.role === 'user' ? t('panel.detail.visitor') : t('panel.detail.assistant')), m.content))) : h('p', { class: 'muted' }, t('panel.detail.noChat')))
    if (userMsgs && userMsgs <= 6) transcript.open = true

    $('detail').replaceChildren(...[
      h('div', { class: 'head' },
        h('div', { class: 'section' }, h('h2', {}, leadName(d)), h('div', { class: 'contact' }, contactLines)),
        h('div', { class: 'tags' }, heatBadge(d), eventBadge(d), d.topics.map(topicBadge))),
      d.reasons.length ? h('div', { class: 'tags', title: t('panel.detail.why') }, d.reasons.map((r) => h('span', { class: 'awd-badge awd-badge-gold' }, t('panel.reason.' + r)))) : null,
      briefEl,
      actions,
      state.draft ? draftBox() : null,
      c.note ? h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('panel.detail.note')), h('p', {}, c.note)) : null,
      pipeline,
      h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('panel.detail.owner')), h('div', { class: 'row' }, owner)),
      h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('panel.detail.notes')), notes, h('div', { class: 'row' }, saveBtn)),
      answers,
      briefingEl,
      transcript,
    ].filter(Boolean))
  }

  function draftBox() {
    const area = h('textarea', { class: 'awd-textarea', 'aria-label': t('panel.action.email') })
    area.value = state.draft
    const copy = h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: async () => {
      area.select()
      try { await navigator.clipboard.writeText(area.value) } catch (e) { document.execCommand && document.execCommand('copy') }
      copy.textContent = t('panel.action.copied')
    } } }, t('panel.action.copy'))
    return h('section', { class: 'draft' }, area, h('div', { class: 'row' }, copy))
  }

  async function update(patch, quiet) {
    try {
      await call('update', { id: state.selected, ...patch })
      if (!quiet) await load()
      return true
    } catch (e) { notice('danger', t('panel.error.action')); return false }
  }

  async function regenerate() {
    const progress = awd.ui.progress($('detail'), { title: t('panel.detail.brief') })
    try { await call('brief', { id: state.selected }); await loadDetail(state.selected) }
    catch (e) { notice('danger', t('panel.error.action')) }
    finally { progress.clear() }
  }

  function leadFacts(d) {
    const c = d.contact || {}
    return [
      'Company: ' + (c.company || '-'), 'Contact: ' + [c.name, c.role].filter(Boolean).join(', '), 'Email: ' + (c.email || '-'),
      'Brief: ' + (d.brief ? d.brief.headline + ' Next step: ' + d.brief.nextStep : '-'),
      'Answers: ' + d.answers.map((a) => a.title.en + ' — ' + a.items.map((i) => i.question.en + ' ' + i.answer.en).join('; ')).join(' | '),
      'Visitor note: ' + (c.note || '-'),
      'Briefing we gave them: ' + (d.briefing && d.briefing.title ? d.briefing.title : '-'),
      'Chat excerpt: ' + d.transcript.filter((m) => m.role === 'user').slice(-6).map((m) => m.content).join(' / '),
    ].join('\n')
  }

  async function draftEmail() {
    if (noticeSource === 'action') notice(null)
    const d = state.detail
    state.draft = t('panel.action.drafting'); renderDetail()
    try {
      state.draft = await awd.ai.request(
        'Write a short follow-up email (under 160 words) from a lawyer at ' + (d.firm || state.summary.firm || 'our firm') + ' to this visitor we met at ' + pick(d.eventName || state.summary.event) +
        '. Reference what they asked about, propose a 30-minute call this week, and do not give legal advice or quote fees. ' +
        'Write it in ' + (d.lang === 'zht' ? 'Traditional Chinese (Taiwan usage)' : d.lang === 'zh' ? 'Simplified Chinese' : 'English') + '. Output only the email with a subject line.\n\n' + leadFacts(d),
        { purpose: 'event-lead-follow-up', timeoutMs: 90000 })
      if (!state.draft) throw new Error('empty draft')
    } catch (e) {
      state.draft = null; notice('danger', t('panel.error.ai', { reason: e.message || e.code || '' }))
    }
    renderDetail()
  }

  async function handToAssistant() {
    const d = state.detail
    try {
      await awd.chat.send('A visitor we met at ' + pick(d.eventName || state.summary.event) + ' wants legal help. Prepare a one-page intake memo (issues to clarify on the first call, documents to request, likely engagement scope across the areas they raised), answering in ' + t('panel.prompt.lang') + '.\n\n' + leadFacts(d))
      awd.ui.toast(t('panel.toast.handed')).catch(() => {})
    } catch (e) { notice('danger', t('panel.error.ai', { reason: e.message || e.code || '' })) }
  }

  async function showQr() {
    try {
      const qr = await call('qr', state.event ? { event: state.event } : {})
      const doc = new DOMParser().parseFromString(qr.svg, 'image/svg+xml')
      const svg = doc.documentElement
      if (svg.nodeName !== 'svg' || svg.querySelector('script, foreignObject')) throw new Error('bad svg')
      $('qr-svg').replaceChildren(document.importNode(svg, true))
      $('qr-url').textContent = qr.url
      $('qr-dialog').hidden = false
      $('qr-close').focus()
    } catch (e) { notice('danger', t('panel.error.action')) }
  }

  const csvCell = (v) => {
    let s = String(v == null ? '' : v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // spreadsheet formula injection guard
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  async function exportCsv() {
    try {
      const { rows } = await call('export', state.event ? { event: state.event } : {})
      const cols = ['createdAt', 'event', 'company', 'name', 'email', 'phone', 'role', 'topics', 'heat', 'score', 'status', 'owner', 'headline', 'nextStep', 'notes']
      const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n')
      await awd.call('files.download', { name: 'event-leads-' + new Date().toISOString().slice(0, 10) + '.csv', data: new TextEncoder().encode(csv) })
      awd.ui.toast(t('panel.toast.exported', { n: rows.length })).catch(() => {})
    } catch (e) {
      notice('danger', e.code === 'unknown_method' ? t('panel.error.upgrade') : t('panel.error.action'))
    }
  }

  let searchTimer = null
  $('search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = e.target.value.trim(); load() }, 300) })
  $('status').addEventListener('change', (e) => { state.status = e.target.value; load() })
  $('event').addEventListener('change', (e) => { state.event = e.target.value; state.topic = ''; state.selected = null; state.detail = null; state.seenHot = null; renderDetailEmpty(); load() })
  $('anon').addEventListener('change', (e) => { state.anon = e.target.checked; load() })
  $('btn-refresh').addEventListener('click', load)
  $('btn-qr').addEventListener('click', showQr)
  $('btn-export').addEventListener('click', exportCsv)
  $('qr-close').addEventListener('click', () => { $('qr-dialog').hidden = true })
  $('qr-dialog').addEventListener('click', (e) => { if (e.target === $('qr-dialog')) $('qr-dialog').hidden = true })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('qr-dialog').hidden = true })
  $('qr-copy').addEventListener('click', () => { navigator.clipboard.writeText($('qr-url').textContent).then(() => { $('qr-copy').textContent = t('panel.action.copied') }).catch(() => {}) })

  window.ELP = { t, pick, h, isZh: () => zh, isZht: () => zht, locale: () => uiLocale }

  awd.ready().then((ctx) => {
    applyLanguage(ctx.language)
    if (window.FIRM && window.FIRM.events === false) return
    awd.events.on('account.changed', () => { state.selected = null; state.detail = null; state.seenHot = null; load() })
    load()
    setInterval(() => { if (!document.hidden) load() }, POLL_MS)
  })
})()
