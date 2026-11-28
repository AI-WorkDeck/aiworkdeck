// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict'
  const CONN = 'intake'
  const POLL_MS = 30000
  const STATUS_TABS = ['', 'review', 'in_review', 'awaiting_client', 'drafted', 'signed']
  const $ = (id) => document.getElementById(id)
  const OFFICES = (window.FIRM && window.FIRM.offices) || ['tw', 'sv'] // from the firm profile
  const S = {
    office: ((window.FIRM && window.FIRM.offices && window.FIRM.offices[0]) || 'tw'),
    mode: 'matters',
    tab: 'plaza',
    billing: { active: false, expiresAt: null, accountConnected: false },
    preview: null,
    mp: { openLeads: [], myBids: [], mySelectedCount: 0, profileComplete: false, profile: null, maxBids: 3 },
    plazaSelected: null,
    plazaDetail: null,
    status: '',
    q: '',
    list: [],
    counts: {},
    selected: null,
    detail: null,
    version: null,
    ctx: null,
    intakeUrl: '',
  }
  let E // window.ELP from panel.js: { t, pick, h, isZh, isZht }

  const call = (op, params) => {
    const needsOffice = (op.startsWith('matter') || op.startsWith('marketplace')) && S.office !== 'sv'
    return awd.connections.request(CONN, op, needsOffice ? { ...(params || {}), office: S.office } : params || {}, { timeoutMs: 90000 })
  }
  const t = (k, v) => E.t('panel.m.' + k, v)
  const h = (...a) => E.h(...a)
  const toast = (m) => awd.ui.toast(m).catch(() => {})

  function notice(kind, text) {
    const el = $('m-notice')
    if (!kind) { el.hidden = true; el.replaceChildren(); return }
    el.hidden = false
    el.className = 'awd-notice ' + (kind === 'danger' ? 'awd-notice-danger' : kind === 'warning' ? 'awd-notice-warning' : 'awd-notice-success')
    el.setAttribute('role', kind === 'danger' ? 'alert' : 'status')
    el.replaceChildren(h('span', {}, text))
  }
  // AI 额度只给一条用量条和百分比，不显示金额（用户决定 2026-11-23：律师看到美元额度会误以为要自己付费）
  function budgetNotice(b) {
    const low = Boolean(b && b.limit && b.remaining != null && b.remaining < b.limit * 0.3)
    if (low) {
      const pct = Math.max(0, Math.min(100, Math.round((b.remaining / b.limit) * 100)))
      notice('warning', t('budget.low', { pct }))
      $('m-notice').append(h('span', { class: 'budget-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
        h('span', { class: 'budget-bar-fill', style: `width:${pct}%` })))
    }
    else if ($('m-notice').dataset.budget) notice()
    $('m-notice').dataset.budget = low ? '1' : ''
  }
  const fail = (e, key = 'panel.error.action') => notice('danger', (e && e.code === 'unknown_method') ? E.t('panel.error.upgrade') : E.t(key) + (e && e.message ? ' (' + e.message + ')' : ''))

  function setMode(mode) {
    S.mode = mode
    awd.storage.set('mode', mode).catch(() => {})
    document.querySelectorAll('#mode [data-mode]').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)) })
    $('matters').hidden = mode !== 'matters'
    $('leads-view').hidden = mode !== 'leads'
    $('leads-actions').hidden = mode !== 'leads'
    $('m-client-link').hidden = mode !== 'matters' || !S.intakeUrl
    $('m-notice').hidden = mode !== 'matters' || !$('m-notice').childNodes.length
    if (mode === 'matters') { $('title').textContent = t('title'); document.querySelector('.awd-subtitle').textContent = t('subtitle'); load() }
    else { document.querySelector('.awd-subtitle').textContent = E.t('panel.subtitle'); $('btn-refresh').click() }
  }

  let loading = false, queued = false
  function formatMoney(n, cur) {
    const prefix = cur === 'TWD' ? 'NT$ ' : cur === 'USD' ? 'US$ ' : '¥ '
    return prefix + Number(n || 0).toLocaleString()
  }
  function formatDate(iso) {
    if (!iso) return ''
    try { return new Date(iso).toLocaleDateString(E.locale()) } catch { return String(iso).slice(0, 10) }
  }
  const VALID_CT = new Set(['startup', 'sme', 'foreign_invest', 'individual', 'other'])
  const VALID_URG = new Set(['asap_48h', 'this_week', 'this_month', 'flexible'])
  const VALID_BUD = new Set(['under_30k', '30k_100k', '100k_300k', 'over_300k', 'usd_under_2k', 'usd_2k_5k', 'usd_5k_plus', 'discuss'])
  function screeningBadges(sc) {
    if (!sc) return []
    const out = []
    if (VALID_CT.has(sc.clientType)) out.push(h('span', { class: 'awd-badge' }, t('mp.screening.clientType.' + sc.clientType)))
    if (VALID_URG.has(sc.urgency)) out.push(h('span', { class: 'awd-badge ' + (sc.urgency === 'asap_48h' ? 'awd-badge-danger' : 'awd-badge-gold') }, t('mp.screening.urgency.' + sc.urgency)))
    if (VALID_BUD.has(sc.budgetTier)) out.push(h('span', { class: 'awd-badge awd-badge-accent' }, t('mp.screening.budget.' + sc.budgetTier)))
    return out
  }
  function setTab(tab) {
    S.tab = tab
    awd.storage.set('tab', tab).catch(() => {})
    renderSubscribedTabs()
    $('mp-plaza').hidden = tab !== 'plaza'
    $('mp-bids').hidden = tab !== 'bids'
    $('mp-desk').hidden = tab !== 'matters'
    // us-framing:start
    if ($('mp-framing')) $('mp-framing').hidden = tab !== 'framing'
    // us-framing:end
  }
  function updateHeaderBilling() {
    const active = Boolean(S.billing && S.billing.active)
    const badge = $('mp-sub-badge')
    const profBtn = $('btn-profile')
    if (active && S.billing.expiresAt) {
      badge.textContent = t('mp.subBadge', { date: formatDate(S.billing.expiresAt) })
      badge.hidden = false
    } else {
      badge.hidden = true
    }
    if (profBtn) profBtn.hidden = !active
  }
  function renderOfficeTabs() {
    // One office (e.g. a Taipei-only edition): no switcher, it would be a lone tab in an empty bar.
    $('m-office').hidden = OFFICES.length < 2
    $('m-office').replaceChildren(...OFFICES.map((o) => h('button', {
      type: 'button',
      class: 'awd-subnav-item' + (S.office === o ? ' is-active' : ''),
      'aria-pressed': String(S.office === o),
      on: { click: () => { if (S.office === o) return; S.office = o; S.selected = null; S.detail = null; S.plazaSelected = null; S.plazaDetail = null; S.status = ''; awd.storage.set('office', o).catch(() => {}); load() } },
    }, t('office.' + o))))
  }
  function leadPreviewCard(item) {
    const title = item.templateTitle ? E.pick(item.templateTitle) : (item.area ? t('area.' + item.area) : '—')
    const srcBadge = item.source === 'sample'
      ? h('span', { class: 'awd-badge' }, t('mp.src.sample'))
      : item.source === 'recent_completed'
        ? h('span', { class: 'awd-badge awd-badge-info' }, t('mp.src.recent_completed'))
        : h('span', { class: 'awd-badge awd-badge-success' }, t('mp.src.live'))
    return h('div', { class: 'mp-lead-card' },
      h('div', { class: 'top' }, h('div', { class: 'tags' }, item.area ? areaBadge(item.area) : null, srcBadge), h('span', { class: 'when muted small' }, item.createdAt ? ago(item.createdAt) : '')),
      h('div', { class: 'mp-title' }, title),
      h('div', { class: 'tags' },
        ...screeningBadges(item.screening),
        item.flagCount ? h('span', { class: 'awd-badge awd-badge-warning' }, t('mp.flagsCount', { n: item.flagCount })) : null,
        item.versionCount ? h('span', { class: 'awd-badge' }, t('mp.versionsCount', { n: item.versionCount })) : null),
      h('div', { class: 'mp-slots' }, t('mp.slots', { used: item.slotsUsed || 0, max: item.maxBids || 3 })))
  }
  async function startCheckout(btn) {
    if (btn) { btn.disabled = true; btn.textContent = t('mp.paywall.unlocking') }
    try {
      const r = await awd.billing.checkout()
      if (r && r.subscribed) {
        toast(t('mp.paywall.unlocked'))
        await load()
      }
    } catch (e) {
      if (!e || !/cancel/i.test(String(e.code || e.message || ''))) fail(e)
    } finally {
      if (btn && !(S.billing && S.billing.active)) { btn.disabled = false; btn.textContent = t('mp.paywall.cta') }
    }
  }
  function renderPaywall() {
    const p = S.preview || { openCount: 0, thisWeekCount: 0, maxBids: 3, items: [] }
    const items = Array.isArray(p.items) ? p.items : []
    // Free browsing (Morris, 2026-11-24): an unsubscribed lawyer sees every open request (type, area, risk count,
    // budget band, quote slots) unblurred; membership is what lets them quote. The rules box sits below the list.
    const ctaBtn = h('button', { type: 'button', class: 'awd-btn awd-btn-primary', on: { click: () => startCheckout(ctaBtn) } }, t('mp.paywall.cta'))
    $('m-paywall').replaceChildren(
      h('div', { class: 'mp-hero' },
        h('div', { class: 'mp-hero-top' },
          h('div', {}, h('h2', {}, t('mp.paywall.heroTitle')), h('p', { class: 'muted' }, t('mp.paywall.heroDesc'))),
          h('div', {}, ctaBtn)),
        h('div', { class: 'mp-hero-stats' },
          h('div', { class: 'mp-stat-card' }, h('div', { class: 'mp-stat-val' }, String(p.openCount || 0)), h('div', { class: 'mp-stat-lbl' }, t('mp.paywall.openCount'))),
          h('div', { class: 'mp-stat-card' }, h('div', { class: 'mp-stat-val' }, String(p.thisWeekCount || 0)), h('div', { class: 'mp-stat-lbl' }, t('mp.paywall.weekCount'))),
          h('div', { class: 'mp-stat-card' }, h('div', { class: 'mp-stat-val' }, String(p.maxBids || 3)), h('div', { class: 'mp-stat-lbl' }, t('mp.paywall.limitCount'))))),
      items.length ? h('div', { class: 'mp-preview-grid' }, ...items.map(leadPreviewCard)) : null,
      h('div', { class: 'mp-gate-box mp-gate-inline' },
        h('h3', {}, t('mp.paywall.gateTitle')),
        h('ul', { class: 'mp-rules-list' },
          h('li', {}, t('mp.paywall.rule1')),
          h('li', {}, t('mp.paywall.rule2')),
          h('li', {}, t('mp.paywall.rule3')),
          h('li', {}, t('mp.paywall.rule4'))),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'awd-btn awd-btn-primary', on: { click: (ev) => startCheckout(ev.currentTarget) } }, t('mp.paywall.cta')))))
  }
  function renderSubscribedTabs() {
    const mp = S.mp || {}
    const tabs = [
      ['plaza', t('mp.tab.plaza', { n: (mp.openLeads || []).length })],
      ['bids', t('mp.tab.bids', { n: (mp.myBids || []).length })],
      ['matters', t('mp.tab.matters', { n: S.list.length })],
    ]
    // us-framing:start
    // Framing calls (US office only; web/framing.js): founders who booked a lawyer before any drafting.
    if (S.office === 'sv' && window.AIF_FRAMING) tabs.push(['framing', t('fr.tab', { n: S.frCount || 0 })])
    else if (S.tab === 'framing') S.tab = 'plaza'
    // us-framing:end
    $('mp-tabs').replaceChildren(...tabs.map(([k, label]) => h('button', {
      type: 'button',
      class: 'awd-subnav-item' + (S.tab === k ? ' is-active' : ''),
      'aria-pressed': String(S.tab === k),
      on: { click: () => setTab(k) },
    }, label)))
    const banner = $('mp-profile-banner')
    if (!mp.profileComplete) {
      banner.hidden = false
      banner.replaceChildren(
        h('span', {}, t('mp.profileWarn')),
        h('button', { type: 'button', class: 'awd-btn awd-btn-xs awd-btn-primary', on: { click: () => openProfileModal() } }, t('mp.profileFill')))
    } else {
      banner.hidden = true
      banner.replaceChildren()
    }
  }
  function renderPlaza() {
    const mp = S.mp || { openLeads: [], maxBids: 3 }
    const leads = mp.openLeads || []
    $('mp-plaza-kpis').replaceChildren(
      h('div', { class: 'awd-kpi-card' }, h('div', { class: 'awd-kpi-label' }, t('mp.paywall.openCount')), h('div', { class: 'awd-kpi-value' }, String(leads.length))),
      h('div', { class: 'awd-kpi-card' }, h('div', { class: 'awd-kpi-label' }, t('mp.tab.bids', { n: (mp.myBids || []).length })), h('div', { class: 'awd-kpi-value' }, String((mp.myBids || []).filter((x) => x.bid.status === 'active').length))),
      h('div', { class: 'awd-kpi-card' }, h('div', { class: 'awd-kpi-label' }, t('mp.tab.matters', { n: S.list.length })), h('div', { class: 'awd-kpi-value' }, String(mp.mySelectedCount || S.list.length))))
    const listEl = $('mp-plaza-list')
    if (!leads.length) {
      listEl.replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-title' }, t('mp.plaza.emptyTitle')), h('p', { class: 'awd-empty-desc' }, t('mp.plaza.emptyDesc'))))
      $('mp-plaza-detail').replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-desc' }, t('mp.plaza.select'))))
      return
    }
    listEl.replaceChildren(...leads.map((l) => {
      const title = l.templateTitle ? E.pick(l.templateTitle) : (l.area ? t('area.' + l.area) : '—')
      return h('button', {
        type: 'button',
        role: 'option',
        'aria-selected': String(S.plazaSelected === l.id),
        class: 'lead' + (S.plazaSelected === l.id ? ' is-active' : ''),
        on: { click: () => loadPlazaDetail(l.id) },
      },
      h('div', { class: 'top' }, l.area ? areaBadge(l.area) : null, h('span', { class: 'name', title }, title), h('span', { class: 'when' }, l.createdAt ? ago(l.createdAt) : '')),
      h('div', { class: 'tags' },
        ...screeningBadges(l.screening),
        l.myBidStatus === 'active' ? h('span', { class: 'awd-badge awd-badge-success' }, t('mp.bidBadge')) : null,
        h('span', { class: 'awd-badge' }, t('mp.slots', { used: l.slotsUsed || 0, max: l.maxBids || 3 })),
        l.flagCount ? h('span', { class: 'awd-badge awd-badge-warning' }, t('mp.flagsCount', { n: l.flagCount })) : null))
    }))
    if (!S.plazaDetail || !leads.some((x) => x.id === S.plazaSelected)) {
      $('mp-plaza-detail').replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-desc' }, t('mp.plaza.select'))))
    } else {
      renderPlazaDetail()
    }
  }
  async function loadPlazaDetail(id) {
    S.plazaSelected = id
    renderPlaza()
    try {
      S.plazaDetail = await call('marketplaceLead', { id })
      renderPlazaDetail()
      if (window.innerWidth < 760) $('mp-plaza-detail').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) {
      fail(e)
    }
  }
  // Fact labels: the template's own label when the portal sends one (d.fields like the matter detail), else the key made readable.
  function factLabel(d, key) {
    const f = Array.isArray(d.fields) ? d.fields.find((x) => x && x.key === key) : null
    if (f && f.label) return E.pick(f.label)
    const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  function renderPlazaDetail() {
    const d = S.plazaDetail
    const lead = d && d.lead
    if (!lead) return
    const title = lead.templateTitle ? E.pick(lead.templateTitle) : (lead.area ? t('area.' + lead.area) : '—')
    const sc = d.screening || lead.screening
    const facts = Object.entries(d.factsRedacted || {})
    const flags = Array.isArray(d.flags) ? d.flags : []
    const myBid = d.myBid
    let actionArea
    if (myBid && myBid.status === 'active') {
      actionArea = h('div', { class: 'mp-quote-box' },
        h('div', { class: 'row' }, h('strong', {}, t('mp.plaza.myBidTitle')), h('span', { class: 'awd-badge awd-badge-success' }, t('mp.bidStatus.active'))),
        h('div', {}, formatMoney(myBid.feeMin, myBid.currency) + ' – ' + formatMoney(myBid.feeMax, myBid.currency) + ' · ' + myBid.turnaroundDays + 'd'),
        h('p', { class: 'muted' }, myBid.pitch),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: () => withdrawBid(lead.id) } }, t('mp.plaza.withdrawBtn'))))
    } else if ((lead.slotsUsed || 0) >= (lead.maxBids || 3)) {
      actionArea = h('div', { class: 'awd-notice awd-notice-warning' }, t('mp.plaza.fullNotice'))
    } else {
      actionArea = h('div', { class: 'row' },
        h('button', { type: 'button', class: 'awd-btn awd-btn-primary', on: { click: () => openBidModal(lead) } }, t('mp.plaza.bidBtn')))
    }

    $('mp-plaza-detail').replaceChildren(
      h('div', { class: 'head' },
        h('div', { class: 'section' }, h('h2', {}, title), h('div', { class: 'muted' }, t('office.' + (d.office || S.office)) + (lead.createdAt ? ' · ' + ago(lead.createdAt) : ''))),
        h('div', { class: 'tags' }, lead.area ? areaBadge(lead.area) : null, ...screeningBadges(sc), h('span', { class: 'awd-badge' }, t('mp.slots', { used: lead.slotsUsed || 0, max: lead.maxBids || 3 })))),
      h('div', { class: 'mp-rule-banner' }, t('mp.plaza.ruleReminder')),
      actionArea,
      h('section', { class: 'section' },
        h('span', { class: 'section-title' }, t('mp.plaza.factsTitle')),
        facts.length ? h('dl', { class: 'qa' }, ...facts.flatMap(([k, v]) => [h('dt', {}, factLabel(d, k)), h('dd', {}, String(v))])) : h('p', { class: 'muted' }, t('mp.plaza.noFacts'))),
      h('section', { class: 'section red-flags' },
        h('span', { class: 'section-title' }, t('mp.plaza.flagsTitle', { n: flags.length })),
        flags.length ? h('ul', { class: 'flags' }, ...flags.map((f) => h('li', {},
          h('div', { class: 'tags' }, h('span', { class: 'awd-badge ' + (f.level === 'high' ? 'awd-badge-danger' : 'awd-badge-warning') }, t('flag.' + (f.level === 'high' ? 'high' : 'medium'))),
            h('strong', {}, (f.section ? f.section + ': ' : '') + f.title)),
          h('div', {}, f.risk)))) : h('p', { class: 'muted' }, t('mp.plaza.noFlags'))))
  }
  async function withdrawBid(matterId) {
    try {
      await call('marketplaceWithdraw', { matterId })
      toast(t('mp.plaza.withdrawnToast'))
      await load()
      if (S.plazaSelected === matterId) await loadPlazaDetail(matterId)
    } catch (e) { fail(e) }
  }
  function openProfileModal(onSaved) {
    const p = (S.mp && S.mp.profile) || {}
    const fullName = h('input', { class: 'awd-input', value: p.fullName || '' })
    const barJurisdiction = h('input', { class: 'awd-input', value: p.barJurisdiction || (S.office === 'tw' ? '台北律師公會' : '') })
    const barNumber = h('input', { class: 'awd-input', value: p.barNumber || '' })
    const firmName = h('input', { class: 'awd-input', value: p.firmName || '' })
    const yearsPractice = h('input', { class: 'awd-input', type: 'number', min: '0', max: '80', value: String(p.yearsPractice || 3) })
    const specialties = h('input', { class: 'awd-input', value: Array.isArray(p.specialties) ? p.specialties.join(', ') : '' })
    const bio = h('textarea', { class: 'awd-textarea' }); bio.value = p.bio || ''
    const contactEmail = h('input', { class: 'awd-input', type: 'email', value: p.contactEmail || '' })
    const phone = h('input', { class: 'awd-input', type: 'tel', value: p.phone || '' })
    dialog(t('mp.profile.title'), t('mp.profile.desc'), [
      h('div', { class: 'row' }, field(t('mp.profile.fullName'), fullName), field(t('mp.profile.firmName'), firmName)),
      h('div', { class: 'row' }, field(t('mp.profile.jurisdiction'), barJurisdiction), field(t('mp.profile.barNumber'), barNumber), field(t('mp.profile.years'), yearsPractice)),
      field(t('mp.profile.specialties'), specialties),
      field(t('mp.profile.bio'), bio),
      h('div', { class: 'row' }, field(t('mp.profile.email'), contactEmail), field(t('mp.profile.phone'), phone)),
    ], t('mp.profile.save'), async () => {
      if (!fullName.value.trim() || !barJurisdiction.value.trim() || !barNumber.value.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.value.trim())) {
        throw userErr(t('mp.profile.invalid'))
      }
      const r = await call('lawyerProfileSave', {
        fullName: fullName.value.trim(),
        barJurisdiction: barJurisdiction.value.trim(),
        barNumber: barNumber.value.trim(),
        firmName: firmName.value.trim(),
        yearsPractice: Number(yearsPractice.value) || 0,
        specialties: specialties.value,
        bio: bio.value,
        contactEmail: contactEmail.value.trim(),
        phone: phone.value.trim(),
      })
      S.mp.profile = r.profile
      S.mp.profileComplete = Boolean(r.complete)
      toast(t('mp.profile.saved'))
      renderSubscribedTabs()
      if (typeof onSaved === 'function') setTimeout(() => onSaved(), 0)
    })
  }
  function mpErrMsg(e) {
    const code = String((e && (e.code || e.message)) || '')
    if (code.includes('profile_incomplete')) return t('mp.err.profileIncomplete')
    if (code.includes('slots_full')) return t('mp.err.slotsFull')
    if (code.includes('already_bid')) return t('mp.err.alreadyBid')
    if (code.includes('already_selected')) return t('mp.err.alreadySelected')
    if (code.includes('bid_closed')) return t('mp.err.bidClosed')
    if (code.includes('invalid_bid')) return t('mp.err.invalidBid')
    return (e && e.message) || E.t('panel.error.action')
  }
  function openBidModal(lead) {
    if (!S.mp || !S.mp.profileComplete) {
      openProfileModal(() => openBidModal(lead))
      return
    }
    const isTw = S.office === 'tw'
    const currency = h('select', { class: 'awd-select' }, ['TWD', 'USD', 'CNY'].map((c) => h('option', { value: c, selected: c === (isTw ? 'TWD' : 'USD') }, c)))
    const feeMin = h('input', { class: 'awd-input', type: 'number', min: '0', value: isTw ? '30000' : '1500' })
    const feeMax = h('input', { class: 'awd-input', type: 'number', min: '0', value: isTw ? '60000' : '3000' })
    const days = h('input', { class: 'awd-input', type: 'number', min: '1', max: '90', value: '3' })
    const pitch = h('textarea', { class: 'awd-textarea tall', placeholder: t('mp.bidModal.pitchPlaceholder') })
    dialog(t('mp.bidModal.title'), t('mp.bidModal.desc'), [
      h('div', { class: 'row' }, field(t('mp.bidModal.currency'), currency), field(t('mp.bidModal.feeMin'), feeMin), field(t('mp.bidModal.feeMax'), feeMax), field(t('mp.bidModal.days'), days)),
      field(t('mp.bidModal.pitch'), pitch),
    ], t('mp.bidModal.submit'), async () => {
      const fMin = Math.floor(Number(feeMin.value))
      const fMax = Math.floor(Number(feeMax.value))
      const td = Math.floor(Number(days.value))
      if (!Number.isFinite(fMin) || !Number.isFinite(fMax) || fMin < 0 || fMax < fMin || !Number.isFinite(td) || td < 1 || td > 90 || pitch.value.trim().length < 10) {
        throw userErr(t('mp.err.invalidBid'))
      }
      try {
        await call('marketplaceBid', { matterId: lead.id, currency: currency.value, feeMin: fMin, feeMax: fMax, turnaroundDays: td, pitch: pitch.value.trim() })
      } catch (e) {
        throw userErr(mpErrMsg(e))
      }
      toast(t('mp.bidModal.sent'))
      await load()
      if (S.plazaSelected === lead.id) await loadPlazaDetail(lead.id)
    })
  }
  function renderBids() {
    const bids = (S.mp && S.mp.myBids) || []
    if (!bids.length) {
      $('mp-bids-list').replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-desc' }, t('mp.bids.empty'))))
      return
    }
    $('mp-bids-list').replaceChildren(...bids.map((item) => {
      const b = item.bid || {}, l = item.lead
      const title = (l && l.templateTitle) ? E.pick(l.templateTitle) : ((l && l.area) ? t('area.' + l.area) : b.matterId)
      const cls = b.status === 'selected' ? 'awd-badge-success' : b.status === 'active' ? 'awd-badge-info' : b.status === 'not_selected' ? 'awd-badge-warning' : ''
      const actions = []
      if (b.status === 'selected') {
        actions.push(h('button', { type: 'button', class: 'awd-btn awd-btn-sm awd-btn-primary', on: { click: () => { setTab('matters'); loadDetail(b.matterId) } } }, t('mp.bids.openMatter')))
      } else if (b.status === 'active' && l) {
        actions.push(h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: () => { setTab('plaza'); loadPlazaDetail(l.id) } } }, t('mp.bids.viewLead')))
        actions.push(h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: () => withdrawBid(b.matterId) } }, t('mp.plaza.withdrawBtn')))
      }
      return h('div', { class: 'mp-bid-item' },
        h('div', { class: 'top' },
          h('strong', {}, title),
          h('div', { class: 'tags' }, h('span', { class: 'awd-badge ' + cls }, t('mp.bidStatus.' + b.status)), h('span', { class: 'awd-badge' }, formatMoney(b.feeMin, b.currency) + ' – ' + formatMoney(b.feeMax, b.currency)))),
        l ? h('div', { class: 'tags' }, l.area ? areaBadge(l.area) : null, ...screeningBadges(l.screening)) : null,
        b.pitch ? h('p', { class: 'muted' }, b.pitch) : null,
        actions.length ? h('div', { class: 'row' }, ...actions) : null)
    }))
  }

  async function load() {
    if (S.mode !== 'matters') return
    if (loading) { queued = true; return }
    loading = true
    try {
      $('matters').hidden = false
      renderOfficeTabs()
      let bill = { active: false, expiresAt: null, accountConnected: false }
      try {
        bill = await awd.billing.status()
      } catch (e) {
        if (e && e.code === 'unknown_method') { notice('danger', E.t('panel.error.upgrade')); return }
        throw e
      }
      S.billing = bill || { active: false, expiresAt: null, accountConnected: false }
      updateHeaderBilling()

      if (!S.billing.active) {
        $('m-subscribed').hidden = true
        $('m-paywall').hidden = false
        $('m-client-link').hidden = true
        S.preview = await call('marketplacePreview')
        if ($('m-notice').classList.contains('awd-notice-danger')) notice()
        renderPaywall()
        return
      }

      $('m-paywall').hidden = true
      $('m-subscribed').hidden = false
      const params = {}
      if (S.status) params.status = S.status
      if (S.q) params.q = S.q
      let mpRes, matRes
      try {
        ;[mpRes, matRes] = await Promise.all([call('marketplaceLeads'), call('matters', params)])
      } catch (e) {
        const msg = String((e && (e.code || e.message)) || '')
        if (msg.includes('subscription_required') || msg.includes('402')) {
          S.billing = { ...S.billing, active: false }
          updateHeaderBilling()
          $('m-subscribed').hidden = true
          $('m-paywall').hidden = false
          S.preview = await call('marketplacePreview')
          renderPaywall()
          return
        }
        throw e
      }
      S.mp = mpRes || { openLeads: [], myBids: [], mySelectedCount: 0, profileComplete: false, profile: null, maxBids: 3 }
      S.list = (matRes && matRes.matters) || []
      S.counts = (matRes && matRes.counts) || {}
      S.intakeUrl = (matRes && matRes.intakeUrl) || ''
      $('m-client-link').href = S.intakeUrl
      $('m-client-link').hidden = !S.intakeUrl
      if ($('m-notice').classList.contains('awd-notice-danger')) notice()
      budgetNotice(matRes && matRes.aiBudget)
      setTab(S.tab)
      renderPlaza()
      renderBids()
      renderKpis(); renderTabs(); renderList()
      notifyNew(S.list)
      if (S.tab === 'plaza' && S.plazaSelected) await loadPlazaDetail(S.plazaSelected)
      if (S.tab === 'matters' && S.selected) await loadDetail(S.selected, true)
      // us-framing:start
      if (S.office === 'sv' && window.AIF_FRAMING) await window.AIF_FRAMING.refresh()
      // us-framing:end
    } catch (e) { fail(e, 'panel.error.load') } finally {
      loading = false
      if (queued) { queued = false; load() }
    }
  }

  function renderKpis() {
    const kpi = (k) => h('button', { type: 'button', class: 'awd-kpi-card kpi-btn' + (S.status === k ? ' is-active' : ''), on: { click: () => { S.status = S.status === k ? '' : k; load() } } },
      h('div', { class: 'awd-kpi-label' }, t('kpi.' + k)), h('div', { class: 'awd-kpi-value' }, String(S.counts[k] || 0)))
    $('m-kpis').replaceChildren(...['review', 'in_review', 'awaiting_client', 'drafted', 'signed'].map(kpi))
  }
  function renderTabs() {
    renderOfficeTabs()
    $('m-status').replaceChildren(...STATUS_TABS.map((s) => h('button', { type: 'button', class: 'awd-subnav-item' + (S.status === s ? ' is-active' : ''), 'aria-pressed': String(S.status === s), on: { click: () => { S.status = s; load() } } },
      s ? t('status.' + s) : t('filter.all'))))
  }
  const statusBadge = (s) => h('span', { class: 'awd-badge ' + ({ review: 'awd-badge-danger', awaiting_client: 'awd-badge-warning', in_review: 'awd-badge-accent', signed: 'awd-badge-success' }[s] || '') }, t('status.' + s))
  const areaBadge = (a) => (a ? h('span', { class: 'awd-badge' }, t('area.' + a)) : null)
  const who = (m) => m.client || m.company || (m.consult && m.consult.name) || t('anonymous')
  const requested = (m) => Boolean(m.consult && m.consult.status === 'requested')
  const lawyerOf = (m) => E.pick(m.lawyerNames) || m.lawyerName
  const forLawyer = (m) => (m.lawyerName ? h('span', { class: 'awd-badge' }, t('consult.for', { name: lawyerOf(m) })) : null)
  const listBadge = (n) => (n ? h('span', { class: 'awd-badge awd-badge-gold' }, t('questions.badge', { n })) : null)
  function ago(iso) {
    const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
    if (m < 1) return E.t('panel.ago.now')
    if (m < 60) return E.t('panel.ago.min', { n: m })
    if (m < 1440) return E.t('panel.ago.hour', { n: Math.round(m / 60) })
    return E.t('panel.ago.day', { n: Math.round(m / 1440) })
  }

  function renderList() {
    const list = $('m-list')
    if (!S.list.length) {
      list.replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-title' }, t('empty.title')), h('p', { class: 'awd-empty-desc' }, t('empty.desc'))))
      if (!S.selected) $('m-detail').replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-desc' }, t('select'))))
      return
    }
    const rows = [...S.list.filter(requested), ...S.list.filter((m) => !requested(m))]
    list.replaceChildren(...rows.map((m) => h('button', {
      type: 'button', role: 'option', 'data-id': m.id, 'aria-selected': String(S.selected === m.id), class: 'lead' + (S.selected === m.id ? ' is-active' : ''), on: { click: () => loadDetail(m.id) },
    },
      h('div', { class: 'top' }, statusBadge(m.status), h('span', { class: 'name', title: who(m) }, who(m)), h('span', { class: 'when' }, ago(m.updatedAt))),
      h('div', { class: 'headline' }, [m.template ? E.pick(m.template) : '', m.company && m.client ? m.company : ''].filter(Boolean).join(' · ') || (m.consult && m.consult.note) || ''),
      h('div', { class: 'tags' }, requested(m) ? h('span', { class: 'awd-badge awd-badge-danger call-req' }, t('consult.badge')) : null, forLawyer(m), listBadge(m.forLawyerCount), areaBadge(m.area), m.versions ? h('span', { class: 'awd-badge' }, m.versions === 1 ? t('oneVersion') : t('versions', { n: m.versions })) : null,
        m.wantsCall ? h('span', { class: 'awd-badge awd-badge-gold' }, t('wantsCall')) : null))))
    if (!S.selected) $('m-detail').replaceChildren(h('div', { class: 'awd-empty' }, h('p', { class: 'awd-empty-desc' }, t('select'))))
  }

  async function notifyNew(list) {
    if (!awd.notifications) return
    let seen = {}
    try { seen = (await awd.storage.get('notified')) || {} } catch { /* */ }
    let changed = false
    for (const m of list) {
      const key = 'review/' + m.id
      if (m.status === 'review' && !seen[key]) {
        try {
          await awd.notifications.publish({ eventKey: key, title: t('notify.title', { doc: m.template ? E.pick(m.template) : '' }), body: t('notify.body', { client: who(m), call: m.wantsCall ? t('wantsCall') + '.' : '' }) })
          seen[key] = 1; changed = true
        } catch (e) { if (e.code === 'unknown_method' || e.code === 'permission_denied') return }
      } else if (m.status !== 'review' && seen[key] === 1) {
        try { await awd.notifications.resolve(key, 'done'); seen[key] = 2; changed = true } catch { /* */ }
      }
    }
    if (changed) awd.storage.set('notified', seen).catch(() => {})
  }

  async function loadDetail(id, quiet) {
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && $('m-detail').contains(document.activeElement)
    if (quiet && (typing || !$('m-dialog').hidden)) return
    if (S.selected !== id) S.version = null
    S.selected = id
    if (!quiet) renderList()
    try {
      S.detail = await call('matter', { id })
      renderDetail()
      if (!quiet && window.innerWidth < 760) $('m-detail').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) { if (!quiet) fail(e) }
  }

  function inline(text) {
    return String(text).split(/(\*\*[^*]+\*\*|\[●[^\]]*\])/g).filter(Boolean).map((p) => (/^\*\*[^*]+\*\*$/.test(p) ? h('strong', {}, p.slice(2, -2)) : /^\[●/.test(p) ? h('mark', { class: 'ph' }, p) : p))
  }
  function docNodes(md) {
    const out = []; let list = null
    for (const raw of String(md || '').split('\n')) {
      const line = raw.trim(); let m
      if (!line) { list = null; continue }
      if ((m = /^#\s+(.+)/.exec(line))) { list = null; out.push(h('h3', { class: 'doc-title' }, inline(m[1]))); continue }
      if ((m = /^#{2,}\s+(.+)/.exec(line))) { list = null; out.push(h('h4', { class: 'doc-h' }, inline(m[1]))); continue }
      if ((m = /^(?:[-*•])\s+(.+)/.exec(line))) { if (!list) { list = h('ul', {}); out.push(list) } list.append(h('li', {}, inline(m[1]))); continue }
      list = null; out.push(h('p', { class: /^\([a-z0-9]+\)\s/i.test(line) ? 'sub' : '' }, inline(line.replace(/^>\s?/, ''))))
    }
    return out
  }

  function renderDetail() {
    const d = S.detail
    const closed = ['signed', 'closed'].includes(d.status)
    const latest = d.versions[d.versions.length - 1]
    const cur = d.versions.find((v) => v.n === S.version) || latest
    const r = d.request || {}
    const editor = hostEditor()
    const editing = editor && linkOf()?.edit
    const btn = (label, fn, opts = {}) => h('button', { type: 'button', class: 'awd-btn awd-btn-sm' + (opts.primary ? ' awd-btn-primary' : ''), disabled: opts.disabled || false, on: { click: fn } }, label)

    // One action bar: the next step first (accept / save / sign off), then the document, then the client;
    // rarely used steps go into 「更多」 so the bar never wraps into an orphan row.
    const accept = !linkOf() && !closed ? btn(t('action.accept'), acceptMatter, { primary: true }) : null
    const saveVer = editing && !closed ? btn(t('action.saveVersion'), () => saveFromAwd(), { primary: true }) : null
    const sign = btn(t('action.signoff'), signOff, { primary: !accept && !saveVer && d.status !== 'review', disabled: closed || !latest })
    const docBtns = [
      editor ? btn(t('action.editInAwd'), editInAwd, { disabled: closed || !latest }) : btn(t('action.edit'), () => editText(latest), { disabled: closed || !latest }),
      btn(t('action.word'), () => openWord(cur), { disabled: !cur }),
    ]
    const clientBtns = [btn(t('action.call'), scheduleCall, { disabled: closed }), btn(t('action.message'), messageClient, { disabled: d.status === 'closed' })]
    const moreBtns = [
      linkOf() ? null : btn(t('action.conflict'), conflictCheck),
      linkOf()?.projectId ? btn(t('action.openProject'), openProject) : null,
      btn(t('action.import'), importFile, { disabled: closed || !latest }),
    ].filter(Boolean)
    const more = moreBtns.length ? h('details', { class: 'more' }, h('summary', { class: 'awd-btn awd-btn-sm' }, t('action.more')), h('div', { class: 'more-menu' }, moreBtns)) : null
    if (more) more.querySelectorAll('.more-menu .awd-btn').forEach((b) => b.addEventListener('click', () => { more.open = false }))
    const actions = h('div', { class: 'actions' }, accept, saveVer, sign, h('span', { class: 'sep' }), ...docBtns, h('span', { class: 'sep' }), ...clientBtns, more)
    const editingNote = editing && !closed ? h('p', { class: 'muted small' }, t('awd.editing', { name: editing.path.split('/').pop() })) : null

    const facts = h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('section.facts')),
      h('dl', { class: 'qa' }, (d.fields || []).filter((f) => f.required || d.facts[f.key]).map((f) => [
        h('dt', {}, E.pick(f.label)), h('dd', { class: d.facts[f.key] ? '' : 'missing' }, d.facts[f.key] || t('missing'))])),
      d.context && d.context.length ? h('div', { class: 'section' }, h('span', { class: 'section-title' }, t('section.context')), h('ul', {}, d.context.map((c) => h('li', {}, c)))) : null)

    const request = d.request ? h('section', { class: 'section request' }, h('span', { class: 'section-title' }, t('section.request')),
      h('div', { class: 'contact' },
        h('span', {}, [r.name, r.company].filter(Boolean).join(' · ')),
        r.email ? h('a', { href: 'mailto:' + r.email, class: 'ltr', target: '_blank', rel: 'noopener' }, r.email) : null,
        r.phone ? h('span', { class: 'ltr' }, r.phone) : null),
      h('dl', { class: 'qa' },
        h('dt', {}, t('request.parties')), h('dd', {}, r.parties || '—'),
        h('dt', {}, t('request.call')), h('dd', {}, r.wantsCall ? t('yes') : t('no')),
        h('dt', {}, t('request.lawyer')), h('dd', {}, lawyerOf(d) || '—'))) : null

    const c = d.consult
    const cBtn = (label, fn, primary) => h('button', { type: 'button', class: 'awd-btn awd-btn-sm' + (primary ? ' awd-btn-primary' : ''), on: { click: fn } }, label)
    const consult = c ? h('section', { class: 'section consult', 'data-consult': c.status },
      h('div', { class: 'row' }, h('span', { class: 'section-title' }, t('consult.title')), h('span', { class: 'awd-badge ' + (c.status === 'requested' ? 'awd-badge-danger' : c.status === 'scheduled' ? 'awd-badge-accent' : 'awd-badge-success') }, t('consult.s.' + c.status))),
      h('div', { class: 'muted' }, t(c.source === 'ai' ? 'consult.by.ai' : 'consult.by.client')),
      h('div', { class: 'contact' }, h('span', {}, c.name || ''),
        c.email ? h('a', { href: 'mailto:' + c.email, class: 'ltr', target: '_blank', rel: 'noopener' }, c.email) : null,
        c.phone ? h('span', { class: 'ltr' }, c.phone) : null),
      h('dl', { class: 'qa' },
        h('dt', {}, t('consult.times')), h('dd', {}, c.times || '—'),
        h('dt', {}, t('consult.note')), h('dd', {}, c.note || '—'),
        h('dt', {}, t('consult.lawyer')), h('dd', {}, c.lawyerName || '—'),
        h('dt', {}, t('consult.at')), h('dd', {}, c.at ? new Date(c.at).toLocaleString(E.locale()) : '—'),
        c.lawyerNote ? [h('dt', {}, t('consult.lawyerNote')), h('dd', {}, c.lawyerNote)] : null),
      c.status !== 'done' ? h('div', { class: 'row' }, cBtn(t('action.call'), scheduleCall, c.status === 'requested'), cBtn(t('consult.done'), markCallDone)) : null) : null

    const questions = d.forLawyer && d.forLawyer.length ? h('section', { class: 'section for-lawyer' }, h('span', { class: 'section-title' }, t('section.questions') + ' · ' + d.forLawyer.length),
      h('p', { class: 'muted' }, t('questions.lede')),
      h('ol', {}, d.forLawyer.map((q) => h('li', {}, q.section && !q.text.startsWith(q.section) ? h('strong', {}, q.section + ' ') : null, q.text, q.version ? h('span', { class: 'muted' }, ' · V' + q.version) : null)))) : null

    const checkpoints = d.checkpoints && d.checkpoints.length ? h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('section.checkpoints')),
      h('ul', { class: 'checkpoints' }, d.checkpoints.map((c) => h('li', {}, c)))) : null

    const ln = latest && latest.notes
    const terms = ln && ln.terms && ln.terms.length ? h('section', { class: 'section term-sheet' }, h('span', { class: 'section-title' }, t('section.terms') + ' · V' + latest.n),
      h('table', { class: 'terms' }, h('colgroup', {}, h('col', { class: 'c-term' }), h('col', { class: 'c-sec' }), h('col', {})), h('thead', {}, h('tr', {}, h('th', {}, t('terms.term')), h('th', {}, t('terms.section')), h('th', {}, t('terms.text')))),
        h('tbody', {}, ln.terms.map((x) => h('tr', {}, h('td', {}, x.term), h('td', {}, x.section || ''), h('td', {}, x.text)))))) : null
    const noted = (d.flagState && d.flagState[latest && latest.n]) || {}
    const flags = ln && ln.flags && ln.flags.length ? h('section', { class: 'section red-flags' }, h('span', { class: 'section-title' }, t('section.flags') + ' · V' + latest.n),
      h('ul', { class: 'flags' }, ln.flags.map((f) => h('li', { 'data-flag': f.id },
        h('div', { class: 'tags' }, h('span', { class: 'awd-badge ' + (f.level === 'high' ? 'awd-badge-danger' : 'awd-badge-warning') }, t('flag.' + f.level)),
          h('strong', {}, (f.section ? f.section + ': ' : '') + f.title),
          noted[f.id] ? h('span', { class: 'awd-badge ' + (noted[f.id] === 'lawyer' ? 'awd-badge-gold' : 'awd-badge-success') }, t('flag.' + noted[f.id])) : null),
        h('div', {}, f.risk),
        f.options && f.options.length ? h('div', { class: 'opts' }, t('flag.options') + ': ' + f.options.join(' / ')) : null)))) : null

    const n = cur && cur.notes
    const notesEl = n && ((n.points || []).length || n.lawyer.length || n.changes.length) ? h('details', { class: 'section' },
      h('summary', { class: 'section-title' }, t('section.notes')),
      n.summary ? h('p', {}, n.summary) : null,
      n.changes.length ? [h('strong', {}, t('changes')), h('ul', {}, n.changes.map((c) => h('li', {}, c)))] : null,
      (n.points || []).length ? [h('strong', {}, t('points')), h('ul', {}, n.points.map((p) => h('li', { class: p.level }, (p.section ? p.section + ': ' : '') + p.note)))] : null,
      n.lawyer.length ? [h('strong', {}, t('lawyerDecides')), h('ul', {}, n.lawyer.map((c) => h('li', {}, c)))] : null) : null

    const docEl = cur ? h('section', { class: 'section' },
      h('div', { class: 'row' }, h('span', { class: 'section-title' }, t('section.document')),
        h('div', { class: 'versions' }, d.versions.map((v) => h('button', { type: 'button', class: 'awd-btn awd-btn-xs' + (v.n === cur.n ? ' awd-btn-primary' : ''), on: { click: () => { S.version = v.n; renderDetail() } } },
          'V' + v.n + ' · ' + (v.signed ? t('signed') : v.by === 'lawyer' ? (v.lawyer || t('by.lawyer')) : t('by.ai'))))),
        h('a', { class: 'awd-btn awd-btn-xs', href: cur.pdfUrl, target: '_blank', rel: 'noopener' }, t('open'))),
      h('div', { class: 'doc' }, docNodes(cur.markdown))) : null

    const tx = d.transcript || []
    const conv = h('details', { class: 'section' }, h('summary', { class: 'section-title' }, t('section.conversation', { n: tx.filter((m) => m.role !== 'event').length })),
      h('div', { class: 'transcript' }, tx.map((m) => m.role === 'event'
        ? h('div', { class: 'event' }, t('event.' + m.content, { n: m.version, name: m.name || '' }))
        : h('div', { class: 'bubble ' + (m.role === 'user' ? 'user' : m.role === 'lawyer' ? 'lawyer' : 'assistant') },
          h('small', {}, m.role === 'lawyer' ? (m.name || t('who.lawyer')) : t('who.' + m.role)), m.content))))
    if (tx.length && tx.length <= 14) conv.open = true

    const owner = h('input', { class: 'awd-input', value: d.owner || '', placeholder: t('owner'), 'aria-label': t('owner') })
    const notes = h('textarea', { class: 'awd-textarea', placeholder: t('notesPlaceholder'), 'aria-label': t('section.internal') }); notes.value = d.notes || ''
    const save = btn(t('save'), async () => { if (await update({ owner: owner.value, notes: notes.value }, true)) { save.textContent = t('saved'); setTimeout(() => { save.textContent = t('save') }, 1500) } })
    const internal = h('section', { class: 'section' }, h('span', { class: 'section-title' }, t('section.internal')), h('div', { class: 'row' }, owner), notes, h('div', { class: 'row' }, save))

    const activity = h('details', { class: 'section' }, h('summary', { class: 'section-title' }, t('section.activity')),
      h('ul', { class: 'activity' }, (d.activity || []).slice().reverse().map((a) => h('li', {}, h('span', { class: 'when' }, new Date(a.at).toLocaleString(E.locale())), ' ', a.what))))

    $('m-detail').replaceChildren(...[
      h('div', { class: 'head' },
        h('div', { class: 'section' }, h('h2', {}, who(d)), h('div', { class: 'muted' }, [d.template ? E.pick(d.template) : '', d.company].filter(Boolean).join(' · '))),
        h('div', { class: 'tags' }, statusBadge(d.status), requested(d) ? h('span', { class: 'awd-badge awd-badge-danger call-req' }, t('consult.badge')) : null, forLawyer(d), areaBadge(d.area), h('span', { class: 'awd-badge' }, /^zh/.test(d.lang || '') ? '中文' : 'EN'), d.wantsCall ? h('span', { class: 'awd-badge awd-badge-gold' }, t('wantsCall')) : null)),
      d.signoff ? h('div', { class: 'awd-notice awd-notice-success' }, t('event.signed', { n: d.signoff.version, name: d.signoff.name }) + ' · ' + new Date(d.signoff.at).toLocaleString(E.locale())) : null,
      actions, editingNote, nativeBlock(), consult, request, questions, terms, flags, checkpoints, facts, notesEl, docEl, conv, internal, activity].filter(Boolean))
  }

  async function update(patch, quiet) {
    try { await call('matterUpdate', { id: S.selected, ...patch }); if (!quiet) await load(); return true } catch (e) { fail(e); return false }
  }

  function dialog(title, desc, body, okLabel, onOk) {
    const box = $('m-dialog').firstElementChild
    const err = h('div', { class: 'awd-notice awd-notice-danger', hidden: true })
    const ok = h('button', { type: 'button', class: 'awd-btn awd-btn-sm awd-btn-primary' }, okLabel)
    const close = () => { $('m-dialog').hidden = true; box.replaceChildren() }
    ok.addEventListener('click', async () => {
      ok.disabled = true; err.hidden = true
      try { const msg = await onOk(); if (msg !== false) { close(); if (S.selected) loadDetail(S.selected, true) } } catch (e) { err.textContent = e.userMessage || e.message || E.t('panel.error.action'); err.hidden = false }
      ok.disabled = false
    })
    box.replaceChildren(h('h2', { class: 'awd-card-title' }, title), desc ? h('p', { class: 'muted' }, desc) : null, ...body, err,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'awd-btn awd-btn-sm', on: { click: close } }, t('cancel')), ok))
    $('m-dialog').hidden = false
    const first = box.querySelector('input, textarea, select'); if (first) first.focus()
    return close
  }
  const field = (label, el) => h('label', { class: 'field' }, h('span', {}, label), el)
  const userErr = (msg) => Object.assign(new Error(msg), { userMessage: msg })
  async function profile() { try { return (await awd.storage.get('lawyer')) || {} } catch { return {} } }

  async function messageClient(prefill) {
    const p = await profile()
    const text = h('textarea', { class: 'awd-textarea tall' }); text.value = typeof prefill === 'string' ? prefill : ''
    const name = h('input', { class: 'awd-input', value: p.name || '' })
    dialog(t('msg.title'), t('msg.desc'), [field(t('sign.name'), name), text], t('msg.send'), async () => {
      if (!text.value.trim() || !name.value.trim()) throw userErr(E.t('panel.error.action'))
      await call('matterMessage', { id: S.selected, text: text.value, lawyer: name.value })
      awd.storage.set('lawyer', { ...p, name: name.value }).catch(() => {})
      toast(t('toast.sent')); await load()
    })
  }

  async function scheduleCall() {
    const d = S.detail
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const date = h('input', { class: 'awd-input', type: 'date', value: tomorrow })
    const time = h('input', { class: 'awd-input', type: 'time', value: '10:00' })
    const tell = h('input', { type: 'checkbox', checked: true })
    const doc = d.template ? E.pick(d.template) : ''
    const p = await profile()
    const name = h('input', { class: 'awd-input', value: p.name || '' })
    dialog(t('call.title'), t('call.desc'), [h('div', { class: 'row' }, field(t('call.date'), date), field(t('call.time'), time)), field(t('sign.name'), name), h('label', { class: 'check' }, tell, t('call.tell'))], t('call.create'), async () => {
      const projectId = (linkOf() && linkOf().projectId) || S.ctx.projectId
      if (!projectId) throw userErr(t('err.noProject'))
      if (tell.checked && !name.value.trim()) throw userErr(t('sign.name'))
      try {
        await awd.services.request('calendar', 'create', { data: { projectId, type: 'MEETING', title: t('call.task', { client: who(d), doc }), dueDate: date.value, dueTime: time.value, notes: [d.request && d.request.email, d.request && d.request.phone, d.clientUrl].filter(Boolean).join('\n') } })
      } catch (e) { throw userErr(t('err.calendar', { reason: e.message || e.code })) }
      if (tell.checked) {
        // The client's own language and the office's time zone (Taipei vs Silicon Valley).
        const tw = S.office === 'tw'
        const tpl = d.lang === 'zht' ? '我建議我們在 {date} {time}（' + (tw ? '台灣時間' : '太平洋時間') + '）通話。如時間不便，請在此回覆您方便的時間。'
          : d.lang === 'zh' ? '我建议我们在 {date} {time}（' + (tw ? '台北时间' : '太平洋时间') + '）通话。如时间不便，请在此回复您方便的时间。'
          : tw ? 'I would suggest we speak on {date} at {time} (Taipei time). If that does not suit you, please reply here with a time that does.' : 'I would suggest we speak on {date} at {time} (Pacific Time). If that does not suit you, please reply here with a time that does.'
        await call('matterMessage', { id: S.selected, text: tpl.replace('{date}', date.value).replace('{time}', time.value), lawyer: name.value.trim() })
        awd.storage.set('lawyer', { ...p, name: name.value.trim() }).catch(() => {})
      }
      if (d.consult && d.consult.status !== 'done') {
        try { await call('matterConsult', { id: S.selected, status: 'scheduled', note: t('consult.scheduledNote', { date: date.value, time: time.value }) }) } catch (e) { notice('warning', t('err.consult', { reason: e.message || e.code })) }
      }
      toast(t('toast.call')); await load()
    })
  }

  async function markCallDone() {
    try { await call('matterConsult', { id: S.selected, status: 'done' }); toast(t('toast.consult')); await load() } catch (e) { fail(e) }
  }

  const linkKey = () => S.office + ':' + S.selected
  const linkOf = () => (S.links || {})[linkKey()]
  async function saveLink(v) { S.links = { ...(S.links || {}), [linkKey()]: { ...(linkOf() || {}), ...v } }; await awd.storage.set('links', S.links).catch(() => {}) }
  const lf = async (action, params) => { const r = await awd.lawfirm.request(action, params); return r && r.data !== undefined ? r.data : r }
  function partiesOf(d) {
    const r = d.request || {}
    const client = r.company || d.facts.companyName || r.name || ''
    const others = [...new Set([r.parties, d.facts.investorName, d.facts.counterparty, d.facts.partyB, d.facts.buyer, d.facts.seller, d.facts.recipient].filter(Boolean)
      .flatMap((x) => String(x).split(/[;；,，、]\s*/)).map((x) => x.replace(/[（(]演示[）)]|\(demo\)/gi, '').trim()).filter((x) => x && x !== client))]
    return { client, others }
  }
  const riskLabel = (lvl) => t('risk.' + String(lvl || 'GREEN').toUpperCase())
  async function acceptMatter() {
    const d = S.detail, r = d.request || {}
    const { client, others } = partiesOf(d)
    const doc = d.template ? E.pick(d.template) : ''
    const title = [doc, client].filter(Boolean).join(' · ')
    const p = await profile()
    const lead = h('input', { class: 'awd-input', value: E.pick(d.lawyerNames) || p.name || '' }) // the lawyer the client chose first
    const conflict = { title, clientName: client, counterpartyName: others[0] || undefined, relatedParties: others.map((name) => ({ role: 'COUNTERPARTY', name, creditCode: '' })), practiceArea: d.area || undefined }
    let check
    try { check = await lf('precheckConflict', conflict) } catch (e) { return fail(e) }
    const level = String(check.riskLevel || check.conflictLevel || 'GREEN').toUpperCase()
    const hits = check.hits || check.conflictHits || []
    const body = [
      h('ol', { class: 'steps' },
        h('li', {}, t('accept.client', { name: client || '—' })),
        h('li', {}, t('accept.conflict'), ' ', h('span', { class: 'awd-badge risk ' + level.toLowerCase() }, riskLabel(level)), check.summary ? h('div', { class: 'muted small' }, check.summary) : null,
          hits.length ? h('ul', { class: 'small' }, hits.slice(0, 8).map((x) => h('li', {}, [x.matchedPartyName, x.matchedMatterTitle, x.ruleCode || x.reason].filter(Boolean).join(' · ')))) : null),
        h('li', {}, t('accept.file'))),
      field(t('accept.lead'), lead)]
    dialog(t('accept.title'), title, body, level === 'RED' ? t('accept.blocked') : t('accept.ok'), async () => {
      if (level === 'RED') return
      if (!lead.value.trim()) throw userErr(t('accept.lead'))
      const contacts = r.name ? [{ name: r.name, email: r.email || '', phone: r.phone || '' }] : []
      const saved = await lf('saveClient', { name: client, partyType: (r.company || d.facts.companyName) ? 'ORGANIZATION' : 'INDIVIDUAL', contacts,
        notes: t('accept.note', { firm: t('title'), office: t('office.' + S.office), id: d.id }) })
      const clientRec = saved.client || saved
      const intake = await lf('submitIntake', { ...conflict, leadLawyerName: lead.value.trim(), applicantName: lead.value.trim() })
      const rec = intake.intake || intake
      let projectId = rec.projectId || null
      if (!projectId && String(rec.status || '').startsWith('PENDING_COMMITTEE')) {
        const fin = await lf('finalizeIntake', { intakeId: rec.id, decision: 'APPROVE_AND_FILE', createWorkbenchProject: true, comment: t('accept.note', { firm: t('title'), office: t('office.' + S.office), id: d.id }) })
        projectId = (fin.intake || fin).projectId || fin.projectId || null
      }
      await saveLink({ clientId: clientRec.id || clientRec.clientId, clientNo: clientRec.clientNo || '', risk: level, intakeId: rec.id, intakeNo: rec.intakeNo || '', intakeStatus: rec.status || '', projectId })
      awd.storage.set('lawyer', { ...p, name: lead.value.trim() }).catch(() => {})
      if (d.status === 'review') await call('matterUpdate', { id: d.id, status: 'in_review' })
      toast(projectId ? t('toast.filed') : t('toast.pending')); await load()
    })
  }
  async function openProject() {
    try { await awd.services.request('calendar', 'openProject', { projectId: linkOf().projectId }) } catch (e) { fail(e) }
  }
  function nativeBlock() {
    const k = linkOf(); if (!k) return null
    return h('section', { class: 'section native' }, h('span', { class: 'section-title' }, t('native.title')),
      h('dl', { class: 'qa' },
        h('dt', {}, t('native.client')), h('dd', {}, k.clientNo || '✓'),
        h('dt', {}, t('native.conflict')), h('dd', {}, h('span', { class: 'awd-badge risk ' + String(k.risk).toLowerCase() }, riskLabel(k.risk))),
        h('dt', {}, t('native.matter')), h('dd', {}, k.intakeNo ? k.intakeNo + (k.projectId ? '' : ' · ' + t('native.pending')) : '—')))
  }

  async function conflictCheck() {
    const d = S.detail
    const r = d.request || {}
    const client = r.company || d.facts.companyName || r.name || ''
    const others = [...new Set([r.parties, d.facts.investorName, d.facts.counterparty, d.facts.assignor].filter(Boolean).flatMap((x) => x.split(/[;；,，]\s*/)).map((x) => x.trim()).filter((x) => x && x !== client))].join('; ')
    const names = [client, others].filter(Boolean).join('; ')
    let body
    try {
      const data = await lf('precheckConflict', { title: d.template ? E.pick(d.template) : 'Matter', clientName: client || undefined, counterpartyName: others.split('; ')[0] || undefined, relatedParties: others ? others.split('; ').map((name) => ({ role: 'COUNTERPARTY', name, creditCode: '' })) : [] })
      const hits = Array.isArray(data) ? data : data && (data.hits || data.conflicts || data.matches || Object.values(data).find((v) => Array.isArray(v) && v.length))
      body = hits && hits.length
        ? [h('div', { class: 'awd-notice awd-notice-warning' }, t('conflict.hits')), h('ul', {}, hits.slice(0, 20).map((x) => h('li', {}, typeof x === 'string' ? x : [x.name, x.clientName, x.matterTitle, x.title, x.role, x.reason].filter(Boolean).join(' · ') || JSON.stringify(x))))]
        : [h('div', { class: 'awd-notice awd-notice-success' }, t('conflict.none', { names }))]
    } catch (e) {
      body = [h('div', { class: 'awd-notice' }, t('conflict.unavailable')), h('p', { class: 'muted small' }, (e.code || '') + ' ' + (e.message || ''))]
    }
    dialog(t('conflict.title'), names, body, E.t('panel.qr.close'), async () => {})
  }

  async function openWord(v) {
    try {
      const r = await call('matterDocx', { id: S.selected, v: String(v.n) })
      const bin = atob(r.base64); const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      await awd.call('files.download', { name: r.name, data: bytes })
      toast(t('toast.word', { name: r.name }))
    } catch (e) { fail(e) }
  }

  function textToMd(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.trim())
    const out = []; let titled = false
    for (const l of lines) {
      if (!l) { out.push(''); continue }
      if (/^#/.test(l)) { titled = true; out.push(l); continue }
      if (!titled) { out.push('# ' + l); titled = true; continue }
      if (/^(\d{1,2})\.\s+\S.{0,80}$/.test(l) && !/[.;:]$/.test(l)) { out.push('## ' + l); continue }
      out.push(l)
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n')
  }
  async function importFile() {
    let files = []
    try { files = (await awd.files.list()).filter((f) => /\.(docx|md|txt)$/i.test(f.name)) } catch (e) { return fail(e) }
    if (!files.length) return dialog(t('import.title'), t('import.none'), [], E.t('panel.qr.close'), async () => {})
    const sel = h('select', { class: 'awd-select' }, files.map((f) => h('option', { value: f.path }, f.path)))
    dialog(t('import.title'), t('import.desc'), [sel], t('import.choose'), async () => {
      if (hostEditor() && /\.docx$/i.test(sel.value)) { setTimeout(() => saveFromAwd(sel.value), 0); return }
      let content
      try { content = (await awd.files.read(sel.value)).content } catch (e) { throw userErr(t('err.file', { reason: e.message || e.code })) }
      setTimeout(() => editText({ markdown: /\.md$/i.test(sel.value) ? content : textToMd(content) }, sel.value), 0)
    })
  }

  const TOOL_PUT = 'aifirmPartnerPutDocx', TOOL_READ = 'aifirmPartnerReadDocx'
  async function tool(name, args) {
    const out = await awd.tools.invoke(name, args)
    if (/^Error/.test(out)) throw Object.assign(new Error(out.replace(/^Error:?\s*/, '')), { code: 'tool_error' })
    return JSON.parse(out)
  }
  const docTitle = (v) => ((/^#\s+(.+)$/m.exec(v.markdown) || [])[1] || t('section.document')).replace(/\*\*/g, '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80)
  const hostEditor = () => (S.ctx.capabilities || []).includes('ui.openWorkspace.projectId')
  function needsMatterProject(then) {
    const k = linkOf()
    if (!k) { dialog(t('awd.accept.title'), t('awd.accept.desc'), [], t('action.accept'), async () => { setTimeout(acceptMatter, 0) }); return true }
    if (!k.projectId) { dialog(t('awd.pending.title'), t('awd.pending.desc'), [], E.t('panel.qr.close'), async () => {}); return true }
    if (String(k.projectId) === String(S.ctx.openProjectId || '')) return false
    awd.storage.set('open', { office: S.office, id: S.selected, then })
      .then(() => awd.call('ui.openWorkspace', { projectId: k.projectId })) // the bundled SDK's wrapper takes no argument
      .catch((e) => notice('danger', t('err.tool', { reason: e.message || e.code })))
    return true
  }
  async function editInAwd() {
    const d = S.detail, v = d.versions[d.versions.length - 1]
    if (needsMatterProject('edit')) return
    const k = linkOf()
    try {
      let path = k.edit && k.edit.n === v.n ? k.edit.path : null
      if (path) {
        try { await awd.ui.openFile(path) } catch (e) { if (e.code !== 'not_found') throw e; path = null }
      }
      if (!path) {
        const r = await call('matterDocx', { id: S.selected, v: String(v.n) })
        path = (await tool(TOOL_PUT, { name: t('file.name', { title: docTitle(v), n: v.n }) + '.docx', base64: r.base64 })).path
        await saveLink({ edit: { path, n: v.n } })
        await awd.ui.openFile(path)
      }
      toast(t('toast.opened', { name: path.split('/').pop() }))
      renderDetail()
    } catch (e) {
      if (e.code === 'unknown_method') return editText(v) // an old host without tools.invoke / ui.openFile
      notice('danger', t('err.tool', { reason: e.message || e.code }))
    }
  }
  async function saveFromAwd(file) {
    if (!file && needsMatterProject('save')) return
    const d = S.detail, latest = d.versions[d.versions.length - 1]
    const edit = file ? { path: file } : linkOf().edit
    const fname = edit.path.split('/').pop()
    const p = await profile()
    const note = h('input', { class: 'awd-input' })
    const name = h('input', { class: 'awd-input', value: p.name || '' })
    const stale = edit.n && latest.n > edit.n ? h('div', { class: 'awd-notice awd-notice-warning' }, t('save.stale', { base: edit.n, latest: latest.n, n: latest.n + 1 })) : null
    dialog(t('save.title'), t('save.desc', { name: fname, n: latest.n + 1 }), [stale, field(t('edit.note'), note), field(t('sign.name'), name)].filter(Boolean), t('edit.save'), async () => {
      if (!name.value.trim()) throw userErr(t('sign.name'))
      let f
      try { f = await tool(TOOL_READ, { path: edit.path }) } catch (e) { throw userErr(/not_found/.test(e.message) ? t('err.gone', { name: fname }) : e.code === 'unknown_method' ? E.t('panel.error.upgrade') : t('err.tool', { reason: e.message || e.code })) }
      let r
      try { r = await call('matterVersionDocx', { id: S.selected, docx: f.base64, note: note.value, lawyer: name.value.trim() }) } catch (e) {
        throw userErr(/unchanged|409/.test(String(e.message) + e.code) ? t('err.unchanged', { n: latest.n }) : (e.message || E.t('panel.error.action')))
      }
      awd.storage.set('lawyer', { ...p, name: name.value.trim() }).catch(() => {})
      if (!file) await saveLink({ edit: null })
      S.version = r.n; toast(t('toast.version', { n: r.n })); await load()
    })
  }

  async function editText(v, fromFile) {
    const p = await profile()
    const area = h('textarea', { class: 'awd-textarea doc-edit', spellcheck: 'false' }); area.value = v.markdown
    const note = h('input', { class: 'awd-input', value: fromFile ? fromFile : '' })
    const name = h('input', { class: 'awd-input', value: p.name || '' })
    dialog(t('edit.title'), t('edit.desc'), [area, field(t('edit.note'), note), field(t('sign.name'), name)], t('edit.save'), async () => {
      if (!name.value.trim()) throw userErr(t('sign.name'))
      const r = await call('matterVersion', { id: S.selected, markdown: area.value, note: note.value, lawyer: name.value })
      awd.storage.set('lawyer', { ...p, name: name.value }).catch(() => {})
      S.version = r.n; toast(t('toast.version', { n: r.n })); await load()
    })
  }

  async function signOff() {
    try { S.detail = await call('matter', { id: S.selected }); renderDetail() } catch (e) { return fail(e) }
    const d = S.detail
    const v = d.versions[d.versions.length - 1]
    const p = await profile()
    const name = h('input', { class: 'awd-input', value: p.name || '' })
    const title = h('input', { class: 'awd-input', value: p.title || '' })
    const adm = h('input', { class: 'awd-input', value: p.admission || '' })
    const stmt = h('textarea', { class: 'awd-textarea' })
    const firmIn = window.FIRM?.network ? h('input', { class: 'awd-input', value: p.firm || '' }) : null
    const boxes = ['c1', 'c2', 'c3'].map((k) => { const c = h('input', { type: 'checkbox' }); return { c, el: h('label', { class: 'check' }, c, t('sign.' + k)) } })
    dialog(t('sign.title', { n: v.n }), t('sign.desc'), [field(t('sign.name'), name), h('div', { class: 'row' }, field(t('sign.titleField'), title), field(t('sign.admission'), adm)), ...(firmIn ? [field(t('sign.firm'), firmIn)] : []), field(t('sign.statement'), stmt), ...boxes.map((b) => b.el)], t('sign.confirm'), async () => {
      if (!boxes.every((b) => b.c.checked)) throw userErr(t('err.checks'))
      if (!name.value.trim()) throw userErr(t('sign.name'))
      try {
        await call('matterSignoff', { id: S.selected, version: v.n, name: name.value, title: title.value, admission: adm.value, ...(firmIn ? { firm: firmIn.value } : {}), statement: stmt.value, checks: { conflicts: true, engagement: true, reviewed: true } })
      } catch (e) { throw userErr(/version_changed|409/.test(String(e.message) + e.code) ? t('err.version') : (e.message || E.t('panel.error.action'))) }
      awd.storage.set('lawyer', { name: name.value, title: title.value, admission: adm.value, ...(firmIn ? { firm: firmIn.value } : {}) }).catch(() => {})
      notice('success', t('sign.done'))
      if (awd.notifications) awd.notifications.resolve('review/' + S.selected, 'done').catch(() => {})
      await load()
    })
  }

  function init(ctx) {
    E = window.ELP
    S.ctx = ctx
    // us-framing:start
    if (window.AIF_FRAMING) window.AIF_FRAMING.init({ call, t, h, E, S, toast, fail,
      setFramingCount: (n) => { if (S.frCount !== n) { S.frCount = n; renderSubscribedTabs() } },
      openMatter: (id) => { setTab('matters'); loadDetail(id) } })
    // us-framing:end
    let timer = null
    $('m-search').placeholder = t('filter.search')
    $('m-search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { S.q = e.target.value.trim(); load() }, 300) })
    document.querySelectorAll('#mode [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)))
    $('btn-refresh').addEventListener('click', () => { if (S.mode === 'matters') load() })
    if ($('btn-profile')) $('btn-profile').addEventListener('click', () => openProfileModal())
    $('m-dialog').addEventListener('click', (e) => { if (e.target === $('m-dialog')) $('m-dialog').hidden = true })
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('m-dialog').hidden = true })
    awd.events.on('billing.changed', () => load())
    awd.events.on('account.changed', () => { S.selected = null; S.detail = null; S.plazaSelected = null; S.plazaDetail = null; load() })
    let opened = false
    const links = awd.storage.get('links').then((v) => { S.links = v || {}; if (S.detail) renderDetail() }).catch(() => {})
    const tabPref = awd.storage.get('tab').then((tab) => { if (!opened && ['plaza', 'bids', 'matters'].includes(tab)) S.tab = tab }).catch(() => {})
    awd.storage.get('open').then((o) => {
      if (!o || !OFFICES.includes(o.office)) return
      opened = true
      awd.storage.set('open', null).catch(() => {}); S.office = o.office
      if (o.tab && ['plaza', 'bids', 'matters'].includes(o.tab)) S.tab = o.tab
      else if (o.id) S.tab = 'matters'
      Promise.all([links, tabPref]).then(load).then(() => o.id ? loadDetail(o.id) : null).then(() => {
        if (!o.id || !S.detail || S.selected !== o.id || !hostEditor()) return
        if (o.then === 'edit') editInAwd(); else if (o.then === 'save') saveFromAwd()
      })
    }).catch(() => {})
    awd.storage.get('office').then((o) => { if (!opened && OFFICES.includes(o) && o !== S.office) { S.office = o; load() } }).catch(() => {})
    if (window.FIRM && window.FIRM.events === false) { $('mode').hidden = true; tabPref.then(() => setMode('matters')) }
    else awd.storage.get('mode').then((m) => setMode(m === 'leads' ? 'leads' : 'matters')).catch(() => setMode('matters'))
    setInterval(() => { if (!document.hidden) load() }, POLL_MS)
  }
  awd.ready().then((ctx) => { if (window.ELP) init(ctx); else setTimeout(() => init(ctx), 0) })
})()
