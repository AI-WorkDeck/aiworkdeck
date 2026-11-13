// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 客户管理：客户列表（按客户看收入/在办/应收/最近往来）、客户档案（联系人、关联关系与间接股权、项目、收费、
// 利冲记录、往来）、收案表单「选择已有客户」。数据在本机台账（lawfirm.request 的 listClients/getClient/
// saveClient/logClientContact/searchParties/saveRelation/deleteRelation），与收案、利冲共用同一份主体数据。
(function () {
  'use strict';

  const TABLE = window.AWD_LAWFIRM_EXPENSE_L10N || {};
  const $ = (id) => document.getElementById(id);
  const request = (action, params = {}) => awd.call('lawfirm.request', { action, params });

  let locale = 'zh-CN';
  const state = { list: null, filters: { query: '', ownerUserId: '', staleDays: '', sort: 'revenue' }, profile: null, editing: null, pickOptions: [] };

  function t(key, vars) {
    let s = TABLE[locale]?.[key] ?? TABLE['en-US']?.[key] ?? TABLE['zh-CN']?.[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
    return s;
  }

  function pickLocale(lang) {
    if (!lang) return 'zh-CN';
    if (TABLE[lang]) return lang;
    return String(lang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  }

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c === undefined || c === null || c === false) continue;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }

  function money(cents) {
    const v = Number(cents || 0) / 100;
    return '¥' + v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function errorText(err) {
    if (err?.code === 'permission_denied') return t('client.err.permission');
    return (typeof err?.message === 'string' && err.message.trim()) ? err.message.trim().slice(0, 500) : t('client.err.generic');
  }

  function status(text, isError = false) {
    const n = $('clients-status');
    if (!n) return;
    n.textContent = text || '';
    n.dataset.error = String(Boolean(isError));
  }

  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      status(errorText(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function lastInteraction(row) {
    if (row.lastInteractionDays === null || row.lastInteractionDays === undefined) return t('client.last.none');
    const when = row.lastInteractionDays === 0 ? t('client.last.today') : t('client.last.daysAgo', { days: row.lastInteractionDays });
    return `${when} · ${t('client.signal.' + row.lastInteractionSource)}`;
  }

  function staleClass(days) {
    if (days === null || days === undefined || days > 90) return 'badge badge-red';
    if (days > 30) return 'badge badge-yellow';
    return 'badge badge-green';
  }

  function kpi(label, value, sub) {
    return el('div', { class: 'kpi-card' }, el('div', { class: 'kpi-label' }, label), el('strong', { class: 'kpi-value' }, value), sub ? el('div', { class: 'kpi-sub' }, sub) : null);
  }

  function table(headers, rows) {
    return el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))),
      el('tbody', {}, rows)));
  }

  function card(title, hint, ...body) {
    return el('article', { class: 'card' },
      el('header', { class: 'card-header' }, el('div', {}, el('h2', {}, title), hint ? el('p', { class: 'hint' }, hint) : null)),
      ...body);
  }

  // ---- 列表（管理视图） ----

  async function loadList() {
    const f = state.filters;
    state.list = await request('listClients', {
      query: f.query, ownerUserId: f.ownerUserId || undefined, staleDays: f.staleDays || undefined, sort: f.sort
    });
    const badge = $('badge-clients-count');
    if (badge) badge.textContent = String(state.list?.totals?.clientCount ?? 0);
  }

  function renderList() {
    const root = $('clients-root');
    if (!root) return;
    const data = state.list || { clients: [], totals: {}, users: [] };
    const tot = data.totals || {};
    const f = state.filters;

    const search = el('input', { type: 'search', id: 'clients-search', value: f.query, placeholder: t('client.list.search'), 'aria-label': t('client.list.search') });
    const owner = el('select', { id: 'clients-owner', 'aria-label': t('client.list.owner') },
      el('option', { value: '' }, t('client.list.ownerAll')),
      (data.users || []).map((u) => el('option', { value: String(u.id), selected: String(u.id) === String(f.ownerUserId) }, u.displayName)));
    const stale = el('select', { id: 'clients-stale', 'aria-label': t('client.list.stale') },
      ['', '30', '90', '180'].map((d) => el('option', { value: d, selected: d === String(f.staleDays) }, d ? t('client.list.staleOver', { days: d }) : t('client.list.staleAll'))));
    const sort = el('select', { id: 'clients-sort', 'aria-label': t('client.list.sort') },
      ['revenue', 'ar', 'stale', 'name'].map((s) => el('option', { value: s, selected: s === f.sort }, t('client.list.sort.' + s))));
    const apply = () => run(null, async () => {
      Object.assign(state.filters, { query: search.value.trim(), ownerUserId: owner.value, staleDays: stale.value, sort: sort.value });
      await loadList();
      renderList();
    });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    for (const s of [owner, stale, sort]) s.addEventListener('change', apply);

    const rows = (data.clients || []).map((c) => el('tr', { class: 'client-row', 'data-client-id': c.id, tabindex: '0', onclick: () => openProfile(c.id), onkeydown: (e) => { if (e.key === 'Enter') openProfile(c.id); } },
      el('td', {}, el('strong', {}, c.name), el('div', { class: 'hint' }, c.clientNo || '')),
      el('td', {}, c.ownerName || t('client.none'), el('div', { class: 'hint' }, c.partnerName ? t('client.partnerShort', { name: c.partnerName }) : '')),
      el('td', { class: 'num' }, `${c.activeMatterCount} / ${c.matterCount}`),
      el('td', { class: 'num' }, money(c.collectedThisYearCents)),
      el('td', { class: 'num' }, money(c.arCents)),
      el('td', {}, el('span', { class: staleClass(c.lastInteractionDays) }, lastInteraction(c)))));

    root.replaceChildren(
      el('div', { class: 'kpi-grid' },
        kpi(t('client.kpi.clients'), String(tot.clientCount ?? 0), data.restricted ? t('client.kpi.restricted') : t('client.kpi.firm')),
        kpi(t('client.kpi.activeMatters'), String(tot.activeMatterCount ?? 0)),
        kpi(t('client.kpi.revenueYear', { year: tot.year ?? new Date().getFullYear() }), money(tot.collectedThisYearCents)),
        kpi(t('client.kpi.ar'), money(tot.arCents)),
        kpi(t('client.kpi.stale'), String(tot.staleOver90Count ?? 0), t('client.kpi.staleSub'))),
      card(t('client.list.title'), t('client.list.hint'),
        el('div', { class: 'client-toolbar' }, search, owner, stale, sort,
          el('button', { type: 'button', id: 'client-new', class: 'primary', onclick: () => openEditor(null) }, t('client.list.new'))),
        rows.length ? table([t('client.col.client'), t('client.col.owner'), t('client.col.matters'), t('client.col.revenueYear'), t('client.col.ar'), t('client.col.last')], rows)
          : el('p', { class: 'hint' }, t('client.list.empty'))),
      el('div', { id: 'clients-status', role: 'status', 'aria-live': 'polite' }));
  }

  // ---- 客户档案 ----

  async function openProfile(clientId) {
    await run(null, async () => {
      const res = await request('getClient', { clientId });
      state.profile = res.client;
      state.editing = null;
      renderProfile();
    });
  }

  function back() {
    state.profile = null;
    state.editing = null;
    return run(null, async () => { await loadList(); renderList(); });
  }

  function section(title, hint, ...body) {
    return card(title, hint, ...body);
  }

  function renderProfile() {
    const root = $('clients-root');
    const c = state.profile;
    if (!root || !c) return;
    const facts = [
      c.creditCode ? `${t('client.field.creditCode')}：${c.creditCode}` : null,
      c.partyType ? t('client.type.' + c.partyType) : null,
      c.industry ? `${t('client.field.industry')}：${c.industry}` : null,
      c.address ? `${t('client.field.address')}：${c.address}` : null
    ].filter(Boolean).join(' · ');

    root.replaceChildren(
      el('div', { class: 'client-head' },
        el('button', { type: 'button', id: 'client-back', onclick: back }, t('client.back')),
        el('div', { class: 'client-title' }, el('h2', {}, c.name), el('span', { class: 'hint' }, c.clientNo || '')),
        c.canEdit ? el('button', { type: 'button', id: 'client-edit', onclick: () => openEditor(c) }, t('client.edit')) : null),
      el('p', { class: 'hint' }, facts),
      el('p', {}, `${t('client.field.owner')}：${c.ownerName || t('client.none')}　${t('client.field.partner')}：${c.partnerName || t('client.none')}`),
      el('div', { class: 'kpi-grid' },
        kpi(t('client.kpi.matters'), `${c.activeMatterCount} / ${c.matterCount}`, t('client.kpi.mattersSub')),
        kpi(t('client.kpi.contracted'), money(c.contractedCents)),
        kpi(t('client.kpi.billed'), money(c.billedCents), t('client.kpi.collectedSub', { amount: money(c.collectedCents) })),
        kpi(t('client.kpi.revenueYear', { year: new Date().getFullYear() }), money(c.collectedThisYearCents)),
        kpi(t('client.kpi.ar'), money(c.arCents)),
        kpi(t('client.kpi.last'), lastInteraction(c), c.lastInteractionProject || '')),
      el('div', { id: 'clients-status', role: 'status', 'aria-live': 'polite' }),
      contactsSection(c),
      relationsSection(c),
      mattersSection(c),
      financeSection(c),
      conflictsSection(c),
      interactionsSection(c));
  }

  function contactsSection(c) {
    const rows = (c.contacts || []).map((p) => el('tr', {}, el('td', {}, p.name), el('td', {}, p.title || ''), el('td', {}, el('span', { class: 'ltr' }, p.phone || '')), el('td', {}, el('span', { class: 'ltr' }, p.email || ''))));
    return section(t('client.contacts.title'), null,
      rows.length ? table([t('client.contacts.name'), t('client.contacts.role'), t('client.contacts.phone'), t('client.contacts.email')], rows) : el('p', { class: 'hint' }, t('client.contacts.empty')));
  }

  const REL_OPTIONS = [
    'SHAREHOLDER:IN', 'SHAREHOLDER:OUT', 'ACTUAL_CONTROLLER:IN', 'ACTUAL_CONTROLLER:OUT', 'SUPPLIER:IN', 'SUPPLIER:OUT',
    'GUARANTOR:IN', 'GUARANTOR:OUT', 'SPOUSE:BOTH', 'FAMILY:BOTH', 'CONCERTED_ACTOR:BOTH', 'AFFILIATE:BOTH', 'OTHER:BOTH'
  ];

  function relLabel(type, direction) {
    if (direction === 'NETWORK') return t('client.rel.network');
    return t(`client.rel.${type}.${direction === 'BOTH' ? 'BOTH' : direction}`);
  }

  function relationsSection(c) {
    const direct = (c.relations || []).map((r) => el('tr', { 'data-relation-id': r.id },
      el('td', {}, relLabel(r.relationType, r.direction)),
      el('td', {}, el('strong', {}, r.partyName), r.partyIsClient ? el('span', { class: 'badge badge-neutral' }, t('client.rel.isClient')) : null),
      el('td', {}, r.description),
      el('td', {}, c.canEdit ? el('button', { type: 'button', class: 'danger', onclick: (e) => run(e.currentTarget, async () => {
        const res = await request('deleteRelation', { clientId: c.id, relationId: r.id });
        state.profile = res.client;
        renderProfile();
        status(t('client.rel.deleted'));
      }) }, t('client.rel.delete')) : null)));

    const chain = (list) => list.map((r) => el('tr', {},
      el('td', {}, el('strong', {}, r.partyName), r.partyIsClient ? el('span', { class: 'badge badge-neutral' }, t('client.rel.isClient')) : null),
      el('td', { class: 'num' }, t('client.rel.levels', { n: r.depth })),
      el('td', { class: 'num' }, r.effectiveBps === null || r.effectiveBps === undefined ? '—' : (r.effectiveBps / 100).toLocaleString(locale, { maximumFractionDigits: 2 }) + '%'),
      el('td', {}, r.path)));
    const up = chain(c.indirectShareholders || []);
    const down = chain(c.indirectSubsidiaries || []);
    const chainHead = [t('client.rel.party'), t('client.rel.depth'), t('client.rel.effective'), t('client.rel.path')];

    return section(t('client.rel.title'), t('client.rel.hint'),
      direct.length ? table([t('client.rel.type'), t('client.rel.party'), t('client.rel.description'), ''], direct) : el('p', { class: 'hint' }, t('client.rel.empty')),
      c.canEdit ? relationForm(c) : null,
      el('h3', {}, t('client.rel.indirectUp')),
      up.length ? table(chainHead, up) : el('p', { class: 'hint' }, t('client.rel.indirectEmpty')),
      el('h3', {}, t('client.rel.indirectDown')),
      down.length ? table(chainHead, down) : el('p', { class: 'hint' }, t('client.rel.indirectEmpty')));
  }

  function relationForm(c) {
    // 关系的这一端：客户本身，或其关系网中的主体（补登多层股权链用）
    const subject = el('select', { id: 'rel-subject', 'aria-label': t('client.rel.subject') },
      el('option', { value: String(c.id) }, c.name),
      ...(c.network || []).map((n) => el('option', { value: String(n.id) }, n.name)));
    const type = el('select', { id: 'rel-type', 'aria-label': t('client.rel.type') },
      REL_OPTIONS.map((o) => { const [ty, dir] = o.split(':'); return el('option', { value: o }, relLabel(ty, dir)); }));
    const listId = 'rel-party-options';
    const party = el('input', { id: 'rel-party', type: 'text', list: listId, maxlength: 256, placeholder: t('client.rel.partyPlaceholder'), 'aria-label': t('client.rel.party') });
    const datalist = el('datalist', { id: listId });
    const code = el('input', { id: 'rel-party-code', type: 'text', maxlength: 128, placeholder: t('client.rel.codePlaceholder'), 'aria-label': t('client.field.creditCode') });
    const ptype = el('select', { id: 'rel-party-type', 'aria-label': t('client.field.type') },
      el('option', { value: 'ORGANIZATION' }, t('client.type.ORGANIZATION')), el('option', { value: 'INDIVIDUAL' }, t('client.type.INDIVIDUAL')));
    const pct = el('input', { id: 'rel-share', type: 'number', min: '0', max: '100', step: '0.01', placeholder: t('client.rel.sharePlaceholder'), 'aria-label': t('client.rel.share') });
    const note = el('input', { id: 'rel-note', type: 'text', maxlength: 256, placeholder: t('client.rel.notePlaceholder'), 'aria-label': t('client.rel.note') });
    const syncShare = () => { pct.hidden = !type.value.startsWith('SHAREHOLDER'); };
    type.addEventListener('change', syncShare);
    syncShare();
    let options = [];
    party.addEventListener('input', () => {
      const q = party.value.trim();
      if (q.length < 1) return;
      request('searchParties', { query: q }).then((res) => {
        options = (res?.parties || []).filter((p) => String(p.id) !== subject.value);
        datalist.replaceChildren(...options.map((p) => el('option', { value: p.name }, p.client ? `${p.clientNo || ''} ${t('client.rel.isClient')}` : (p.creditCode || ''))));
      }).catch(() => {});
    });
    const save = el('button', { type: 'button', id: 'rel-save', class: 'primary' }, t('client.rel.add'));
    save.addEventListener('click', () => run(save, async () => {
      const [relationType, direction] = type.value.split(':');
      const name = party.value.trim();
      if (!name) throw new Error(t('client.rel.needParty'));
      const picked = options.find((p) => p.name === name);
      const res = await request('saveRelation', {
        clientId: c.id, subjectPartyId: Number(subject.value), relationType, direction: direction === 'BOTH' ? 'OUT' : direction,
        partyId: picked ? picked.id : undefined, partyName: picked ? undefined : name,
        partyCreditCode: picked ? undefined : code.value.trim(), partyType: ptype.value,
        sharePercent: relationType === 'SHAREHOLDER' ? pct.value.trim() : undefined, note: note.value.trim()
      });
      state.profile = res.client;
      renderProfile();
      status(t('client.rel.saved'));
    }));
    return el('div', { class: 'client-rel-form' },
      el('span', { class: 'hint' }, t('client.rel.subject')), subject, type, party, datalist, code, ptype, pct, note, save);
  }

  function mattersSection(c) {
    const rows = (c.matters || []).map((m) => el('tr', {},
      el('td', {}, el('strong', {}, m.title || ''), el('div', { class: 'hint' }, m.intakeNo || '')),
      el('td', {}, t('client.status.' + (m.status || 'DRAFT'))),
      el('td', {}, m.leadLawyerName || ''),
      el('td', {}, m.counterpartyName || ''),
      el('td', { class: 'num' }, money(m.contractAmountCents)),
      el('td', {}, m.projectName || '')));
    const extra = (c.workbenchProjects || []).map((p) => el('li', {}, p.name));
    return section(t('client.matters.title'), t('client.matters.hint'),
      rows.length ? table([t('client.matters.colTitle'), t('client.matters.status'), t('client.matters.lead'), t('client.matters.counterparty'), t('client.matters.contract'), t('client.matters.project')], rows)
        : el('p', { class: 'hint' }, t('client.matters.empty')),
      extra.length ? el('div', {}, el('p', { class: 'hint' }, t('client.matters.workbench')), el('ul', {}, extra)) : null);
  }

  function financeSection(c) {
    const inv = (c.invoices || []).map((v) => el('tr', {},
      el('td', {}, v.invoiceAppNo || ''), el('td', {}, v.matterTitle || ''), el('td', {}, t('client.invoice.' + (v.status || 'ISSUED'))),
      el('td', { class: 'num' }, money(v.amountCents)), el('td', { class: 'num' }, money(v.collectedAmountCents))));
    const col = (c.collections || []).map((x) => el('tr', {},
      el('td', {}, x.collectionNo || ''), el('td', {}, x.matterTitle || ''), el('td', {}, x.receivedDate || ''), el('td', { class: 'num' }, money(x.amountCents))));
    return section(t('client.finance.title'), t('client.finance.hint'),
      inv.length ? table([t('client.finance.invoiceNo'), t('client.finance.matter'), t('client.finance.status'), t('client.finance.amount'), t('client.finance.collected')], inv) : el('p', { class: 'hint' }, t('client.finance.noInvoices')),
      col.length ? table([t('client.finance.collectionNo'), t('client.finance.matter'), t('client.finance.date'), t('client.finance.amount')], col) : el('p', { class: 'hint' }, t('client.finance.noCollections')));
  }

  function conflictsSection(c) {
    const rows = (c.conflicts || []).map((x) => el('tr', {},
      el('td', {}, t('client.conflict.' + x.kind)),
      el('td', {}, el('strong', {}, x.title || ''), el('div', { class: 'hint' }, x.intakeNo || '')),
      el('td', {}, el('span', { class: `badge badge-${x.riskLevel === 'RED' ? 'red' : x.riskLevel === 'YELLOW' ? 'yellow' : 'green'}` }, t('client.risk.' + (x.riskLevel || 'GREEN')))),
      el('td', {}, x.relationPath || x.matchedPartyName || '')));
    return section(t('client.conflict.title'), t('client.conflict.hint'),
      rows.length ? table([t('client.conflict.kind'), t('client.conflict.matter'), t('client.conflict.level'), t('client.conflict.detail')], rows) : el('p', { class: 'hint' }, t('client.conflict.empty')));
  }

  function interactionsSection(c) {
    const rows = (c.signals || []).map((s) => el('tr', {},
      el('td', {}, s.date), el('td', {}, t('client.signal.' + s.source)),
      el('td', {}, s.source === 'MANUAL' ? [s.channel ? t('client.channel.' + s.channel) : '', s.note ? ` · ${s.note}` : ''].join('') : (s.projectName || ''))));
    const date = el('input', { id: 'contact-date', type: 'date', value: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), 'aria-label': t('client.contact.date') });
    const channel = el('select', { id: 'contact-channel', 'aria-label': t('client.contact.channel') },
      ['MEETING', 'CALL', 'EMAIL', 'VISIT', 'MESSAGE', 'OTHER'].map((ch) => el('option', { value: ch }, t('client.channel.' + ch))));
    const note = el('input', { id: 'contact-note', type: 'text', maxlength: 500, placeholder: t('client.contact.notePlaceholder'), 'aria-label': t('client.contact.note') });
    const save = el('button', { type: 'button', id: 'contact-save', class: 'primary' }, t('client.contact.save'));
    save.addEventListener('click', () => run(save, async () => {
      const res = await request('logClientContact', { clientId: c.id, date: date.value, channel: channel.value, note: note.value.trim() });
      state.profile = res.client;
      renderProfile();
      status(t('client.contact.saved'));
    }));
    return section(t('client.signal.title'), t('client.signal.hint'),
      el('div', { class: 'client-rel-form' }, date, channel, note, save),
      rows.length ? table([t('client.signal.date'), t('client.signal.source'), t('client.signal.detail')], rows) : el('p', { class: 'hint' }, t('client.signal.empty')));
  }

  // ---- 新建/编辑 ----

  function openEditor(c) {
    state.editing = c || {};
    const root = $('clients-root');
    const users = state.list?.users || [];
    const v = state.editing;
    const input = (id, label, value, attrs = {}) => el('label', {}, el('span', {}, label), el('input', { id, type: 'text', value: value || '', ...attrs }));
    const userSelect = (id, label, selectedId) => el('label', {}, el('span', {}, label), el('select', { id },
      el('option', { value: '' }, t('client.none')),
      users.map((u) => el('option', { value: String(u.id), selected: String(u.id) === String(selectedId ?? '') }, u.displayName))));
    const contactRows = el('div', { id: 'client-contacts-edit', class: 'stack-list' });
    const addContact = (p = {}) => contactRows.append(el('div', { class: 'client-contact-row' },
      el('input', { type: 'text', value: p.name || '', placeholder: t('client.contacts.name'), 'aria-label': t('client.contacts.name'), 'data-f': 'name' }),
      el('input', { type: 'text', value: p.title || '', placeholder: t('client.contacts.role'), 'aria-label': t('client.contacts.role'), 'data-f': 'title' }),
      el('input', { type: 'text', value: p.phone || '', placeholder: t('client.contacts.phone'), 'aria-label': t('client.contacts.phone'), 'data-f': 'phone' }),
      el('input', { type: 'text', value: p.email || '', placeholder: t('client.contacts.email'), 'aria-label': t('client.contacts.email'), 'data-f': 'email' }),
      el('button', { type: 'button', onclick: (e) => e.currentTarget.parentElement.remove() }, t('client.contacts.remove'))));
    (v.contacts || []).forEach(addContact);
    if (!(v.contacts || []).length) addContact();

    const save = el('button', { type: 'button', id: 'client-save', class: 'primary' }, t('client.save'));
    save.addEventListener('click', () => run(save, async () => {
      const name = $('client-f-name').value.trim();
      if (!name) throw new Error(t('client.err.needName'));
      const contacts = [...contactRows.querySelectorAll('.client-contact-row')].map((row) => Object.fromEntries(
        [...row.querySelectorAll('input')].map((i) => [i.dataset.f, i.value.trim()]))).filter((p) => p.name);
      const res = await request('saveClient', {
        clientId: v.id, name, creditCode: $('client-f-code').value.trim(), partyType: $('client-f-type').value,
        industry: $('client-f-industry').value.trim(), address: $('client-f-address').value.trim(), notes: $('client-f-notes').value.trim(),
        ownerUserId: $('client-f-owner').value || undefined, partnerUserId: $('client-f-partner').value || undefined, contacts
      });
      state.profile = res.client;
      state.editing = null;
      renderProfile();
      status(t('client.saved'));
    }));

    root.replaceChildren(card(v.id ? t('client.editTitle') : t('client.newTitle'), t('client.editHint'),
      el('div', { class: 'form-grid' },
        input('client-f-name', t('client.field.name'), v.name, { maxlength: 256, required: true }),
        input('client-f-code', t('client.field.creditCode'), v.creditCode, { maxlength: 128 }),
        el('label', {}, el('span', {}, t('client.field.type')), el('select', { id: 'client-f-type' },
          ['ORGANIZATION', 'INDIVIDUAL'].map((ty) => el('option', { value: ty, selected: ty === (v.partyType || 'ORGANIZATION') }, t('client.type.' + ty))))),
        input('client-f-industry', t('client.field.industry'), v.industry, { maxlength: 128 }),
        userSelect('client-f-owner', t('client.field.owner'), v.ownerUserId),
        userSelect('client-f-partner', t('client.field.partner'), v.partnerUserId),
        el('label', { class: 'field-span-2' }, el('span', {}, t('client.field.address')), el('input', { id: 'client-f-address', type: 'text', value: v.address || '', maxlength: 512 })),
        el('label', { class: 'field-span-2' }, el('span', {}, t('client.field.notes')), el('textarea', { id: 'client-f-notes', rows: 3, maxlength: 4000 }, v.notes || ''))),
      el('h3', {}, t('client.contacts.title')),
      contactRows,
      el('button', { type: 'button', onclick: () => addContact() }, t('client.contacts.add')),
      el('div', { class: 'form-actions' }, save,
        el('button', { type: 'button', id: 'client-cancel', onclick: () => (v.id ? openProfile(v.id) : back()) }, t('client.cancel'))),
      el('div', { id: 'clients-status', role: 'status', 'aria-live': 'polite' })));
  }

  // ---- 收案表单：选择已有客户 ----

  function setupIntakePicker() {
    const nameInput = $('intake-client-name');
    const codeInput = $('intake-client-code');
    const form = $('intake-form');
    if (!nameInput || !form || $('intake-client-pick')) return;
    const hidden = el('input', { type: 'hidden', id: 'intake-client-id', name: 'clientId', value: '' });
    const select = el('select', { id: 'intake-client-pick', 'aria-label': t('client.intake.pick') });
    const hint = el('p', { id: 'intake-client-hint', class: 'hint' });
    const label = el('label', { class: 'field-span-2' }, el('span', {}, t('client.intake.pick')), select, hint, hidden);
    nameInput.closest('label').before(label);

    const fill = () => {
      select.replaceChildren(el('option', { value: '' }, t('client.intake.newClient')),
        ...state.pickOptions.map((c) => el('option', { value: String(c.id) }, c.clientNo ? `${c.name}（${c.clientNo}）` : c.name)));
      select.value = hidden.value;
    };
    const apply = () => {
      const picked = state.pickOptions.find((c) => String(c.id) === select.value);
      hidden.value = picked ? String(picked.id) : '';
      nameInput.readOnly = Boolean(picked);
      if (codeInput) codeInput.readOnly = Boolean(picked);
      if (picked) {
        nameInput.value = picked.name;
        if (codeInput) codeInput.value = picked.creditCode || '';
        hint.textContent = t('client.intake.picked', { no: picked.clientNo || '' });
      } else {
        hint.textContent = '';
      }
    };
    const refresh = () => request('listClients', { sort: 'name' }).then((res) => {
      state.pickOptions = res?.clients || [];
      fill();
    }).catch(() => {});
    select.addEventListener('focus', refresh);
    select.addEventListener('change', apply);
    nameInput.addEventListener('input', () => {
      if (hidden.value) return;
      const typed = nameInput.value.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toUpperCase();
      const hit = state.pickOptions.find((c) => c.name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toUpperCase() === typed);
      hint.textContent = hit ? t('client.intake.matched', { name: hit.name, no: hit.clientNo || '' }) : '';
    });
    form.addEventListener('reset', () => setTimeout(() => { select.value = ''; apply(); }, 0));
    return fill;
  }

  // 宿主还不认识客户管理动作（0.85.x 及更早）：律所管理后端回「不支持的律所管理操作」
  function unsupportedHost(err) {
    const msg = String(err?.message || '');
    return msg.includes('不支持的律所管理操作') || msg.includes('Unsupported law firm management action');
  }

  // 旧宿主上整个客户管理不出现：标签与面板隐藏，收案表单不加客户下拉，收案与利冲照旧
  function hideForOldHost() {
    const tab = $('tab-clients');
    const panel = $('panel-clients');
    if (tab) tab.hidden = true;
    if (panel) panel.hidden = true;
    if (tab && tab.getAttribute('aria-selected') === 'true') $('tab-intake')?.click();
  }

  async function init(ctx) {
    locale = pickLocale(ctx?.language || ctx?.locale);
    for (const n of document.querySelectorAll('[data-c]')) n.textContent = t(n.dataset.c);
    const tab = $('tab-clients');
    try {
      // 首次加载只发一次 listClients（旧收案归集在这一次里完成），收案表单的客户下拉直接复用结果
      await loadList();
    } catch (err) {
      if (unsupportedHost(err)) { hideForOldHost(); return; }
      const root = $('clients-root');
      if (root) root.replaceChildren(el('p', { class: 'hint' }, errorText(err)));
      return;
    }
    if (tab) {
      tab.addEventListener('click', () => {
        if (state.profile || state.editing) return;
        run(null, async () => { await loadList(); renderList(); });
      });
    }
    const fillPicker = setupIntakePicker();
    renderList();
    state.pickOptions = [...(state.list?.clients || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    if (fillPicker) fillPicker();
  }


  window.AWD_LAWFIRM_CLIENTS = { t, openProfile };
  if (typeof awd !== 'undefined' && awd.ready) awd.ready().then(init).catch(() => {});
}());
