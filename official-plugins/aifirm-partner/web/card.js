// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict'
  const OFFICES = (window.FIRM && window.FIRM.offices) || ['tw', 'sv'] // from the firm profile
  const $ = (id) => document.getElementById(id)
  let dict = {}
  const t = (k, v) => { let s = dict['panel.' + k] || (window.ELP_L10N['en-US'] || {})['panel.' + k] || k; for (const x in v || {}) s = s.split('{' + x + '}').join(v[x]); return s }
  const h = (tag, attrs, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') for (const [e, f] of Object.entries(v)) el.addEventListener(e, f); else el.setAttribute(k, v) } for (const c of kids.flat()) if (c != null) el.append(c); return el }
  const get = (office) => awd.connections.request('intake', 'matters', office === 'sv' ? {} : { office }, { timeoutMs: 30000 })
  const getPreview = (office) => awd.connections.request('intake', 'marketplacePreview', office === 'sv' ? {} : { office }, { timeoutMs: 30000 })
  async function render() {
    let active = false
    try { active = Boolean((await awd.billing.status()).active) } catch { active = false }
    let preview = null
    try { preview = await getPreview(OFFICES[0] || 'tw') } catch { /* preview unavailable */ }
    if (!active) {
      const openCount = preview ? Number(preview.openCount || 0) : 0
      $('card').replaceChildren(
        h('button', { class: 'card-head', type: 'button', on: { click: () => awd.ui.openWorkspace().catch(() => {}) } },
          h('span', { class: 'card-title' }, t('m.title')), h('span', { class: 'card-count' }, t('card.mpLocked'))),
        h('button', { class: 'card-row', type: 'button', on: { click: () => awd.ui.openWorkspace().catch(() => {}) } },
          h('span', { class: 'card-who' }, t('card.mpOpen', { n: openCount })),
          h('span', { class: 'card-what' }, t('card.mpUnlock'))))
      return
    }
    let rows = []
    for (const o of OFFICES) {
      try { const r = await get(o); rows = rows.concat((r.matters || []).filter((m) => m.attention).map((m) => ({ ...m, office: o }))) } catch { /* office unavailable */ }
    }
    rows.sort((a, b) => String(b.attentionAt).localeCompare(String(a.attentionAt)))
    const mpOpen = preview ? Number(preview.openCount || 0) : 0
    $('card').replaceChildren(
      h('button', { class: 'card-head', type: 'button', on: { click: () => awd.ui.openWorkspace().catch(() => {}) } },
        h('span', { class: 'card-title' }, t('m.title')), h('span', { class: 'card-count' }, rows.length ? t('card.needs', { n: rows.length }) : t('card.mpOpen', { n: mpOpen }))),
      ...(!rows.length ? [
        h('button', { class: 'card-row', type: 'button', on: { click: () => { awd.storage.set('open', { office: OFFICES[0] || 'tw', tab: 'plaza' }).catch(() => {}); awd.ui.openWorkspace().catch(() => {}) } } },
          h('span', { class: 'card-who' }, t('card.mpOpen', { n: mpOpen })),
          h('span', { class: 'card-what' }, t('card.clear'))),
      ] : []),
      ...rows.slice(0, 4).map((m) => h('button', { class: 'card-row', type: 'button', on: { click: () => { awd.storage.set('open', { office: m.office, id: m.id, tab: 'matters' }).catch(() => {}); awd.ui.openWorkspace().catch(() => {}) } } },
        h('span', { class: 'card-who' }, m.company || m.client || '—'),
        h('span', { class: 'card-what' }, t('m.office.' + m.office) + ' · ' + t('card.' + m.attention)))))
  }
  awd.ready().then((ctx) => {
    const all = window.ELP_L10N || {}
    dict = all[ctx.language] || all[Object.keys(all).find((k) => k.split('-')[0] === String(ctx.language || '').split('-')[0])] || all['en-US'] || {}
    awd.events.on('billing.changed', render)
    render(); setInterval(() => { if (!document.hidden) render() }, 60000)
  })
})()
