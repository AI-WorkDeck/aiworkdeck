// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict'
  const OFFICES = (window.FIRM && window.FIRM.offices) || ['sv', 'tw', 'jp', 'sg', 'all'] // from the firm profile
  const $ = (id) => document.getElementById(id)
  let dict = {}
  const t = (k, v) => { let s = dict['panel.' + k] || (window.ELP_L10N['en-US'] || {})['panel.' + k] || k; for (const x in v || {}) s = s.split('{' + x + '}').join(v[x]); return s }
  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f); else el.setAttribute(k, v) } for (const c of kids.flat()) if (c != null) el.append(c); return el }
  const get = (office) => awd.connections.request('intake', 'matters', office === 'sv' ? {} : { office }, { timeoutMs: 30000 })
  async function render() {
    let rows = []
    for (const o of OFFICES) {
      try { const r = await get(o); rows = rows.concat((r.matters || []).filter((m) => m.attention).map((m) => ({ ...m, office: o }))) } catch { /* office unavailable or not connected */ }
    }
    rows.sort((a, b) => String(b.attentionAt).localeCompare(String(a.attentionAt)))
    $('card').replaceChildren(
      h('button', { class: 'card-head', type: 'button', on: { click: () => awd.ui.openWorkspace().catch(() => {}) } },
        h('span', { class: 'card-title' }, t('m.title')), h('span', { class: 'card-count' }, rows.length ? t('card.needs', { n: rows.length }) : t('card.clear'))),
      ...rows.slice(0, 4).map((m) => h('button', { class: 'card-row', type: 'button', on: { click: () => { awd.storage.set('open', { office: m.office, id: m.id }).catch(() => {}); awd.ui.openWorkspace().catch(() => {}) } } },
        h('span', { class: 'card-who' }, m.company || m.client || '—'),
        h('span', { class: 'card-what' }, t('m.office.' + m.office) + ' · ' + t('card.' + m.attention)))))
  }
  awd.ready().then((ctx) => {
    const all = window.ELP_L10N || {}
    dict = all[ctx.language] || all[Object.keys(all).find((k) => k.split('-')[0] === String(ctx.language || '').split('-')[0])] || all['en-US'] || {}
    render(); setInterval(() => { if (!document.hidden) render() }, 60000)
  })
})()
