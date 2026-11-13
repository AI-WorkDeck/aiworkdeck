// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 计时收费：合伙人月底审核工时（核减、改描述、不收费、通过、退回，留痕）→ 生成账单（约定费率、折扣、封顶）
// → 客户确认后生成「发票与财务收费」里的发票申请 → 按真实回款看律师实现率。
// 律师的工时来自宿主「设置 › 工作记录 › 计费工时」（工作记录汇总 + 补录），这里不另设录入表。
// 金额一律以分（整数）由后端 LawFirmBillingService 计算，本文件只做展示。
(function () {
  'use strict';

  const TABLE = window.AWD_LAWFIRM_EXPENSE_L10N || {};
  const $ = (id) => document.getElementById(id);
  const call = (action, params = {}) => awd.call('lawfirm.request', { action, params });

  let locale = 'zh-CN';
  const state = { cloud: null, view: 'review', month: '', review: [], rates: null, bills: [], preview: null, metrics: null, openAudit: new Set(), openEdit: new Set(), openBill: new Set() };

  function t(key, vars) {
    const raw = TABLE[locale]?.[key] ?? TABLE['en-US']?.[key] ?? TABLE['zh-CN']?.[key] ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : raw;
  }

  function pickLocale(lang) {
    if (!lang) return 'zh-CN';
    if (TABLE[lang]) return lang;
    return String(lang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  }

  function el(tag, text, className) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  }

  function button(text, action, onClick, cls) {
    const b = el('button', text, cls);
    b.type = 'button';
    b.dataset.action = action;
    b.addEventListener('click', () => run(b, onClick));
    return b;
  }

  function input(value, attrs = {}) {
    const n = document.createElement('input');
    n.value = value == null ? '' : String(value);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  function labeled(label, control) {
    const l = el('label');
    l.append(el('span', label), control);
    return l;
  }

  function yuan(cents) {
    if (cents == null) return '—';
    const neg = cents < 0;
    const abs = Math.abs(Number(cents));
    const whole = Math.floor(abs / 100).toLocaleString('en-US');
    return (neg ? '-¥' : '¥') + whole + '.' + String(abs % 100).padStart(2, '0');
  }

  function hours(minutes) {
    return String(Number(((Number(minutes) || 0) / 60).toFixed(2)));
  }

  function pct(bps) {
    return String(Number(((Number(bps) || 0) / 100).toFixed(2)));
  }

  function status(text, isError) {
    const n = $('hb-status');
    n.textContent = text || '';
    n.dataset.error = String(Boolean(isError));
  }

  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      status(err?.message || t('billing.failed'), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function monthRange() {
    const [y, m] = state.month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${state.month}-01`, to: `${state.month}-${String(last).padStart(2, '0')}` };
  }

  function defaultMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // ───────────── 工时审核 ─────────────

  async function loadReview() {
    const filter = $('hb-review-status').value;
    const res = await call('timeReviewList', { ...monthRange(), status: filter === 'ALL' ? '' : filter });
    state.review = res?.entries || [];
    renderReview();
  }

  function groupByMatter(entries) {
    const groups = new Map();
    for (const e of entries) {
      const key = e.intakeId ? `i${e.intakeId}` : 'none';
      if (!groups.has(key)) groups.set(key, { intakeId: e.intakeId, title: e.matterTitle, client: e.clientName, rows: [] });
      groups.get(key).rows.push(e);
    }
    // 未立案项目排在最后；其余按客户、事项名排序
    return [...groups.values()].sort((a, b) => (!a.intakeId) - (!b.intakeId)
      || String(a.client || '').localeCompare(String(b.client || '')) || String(a.title || '').localeCompare(String(b.title || '')));
  }

  function auditLine(a) {
    // 后端给的是 UTC 时刻（Instant），按本机时区显示
    const d0 = new Date(a.at);
    const pad = (n) => String(n).padStart(2, '0');
    const at = Number.isNaN(d0.getTime()) ? '' : `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())} ${pad(d0.getHours())}:${pad(d0.getMinutes())}`;
    let what = t(`billing.audit.${a.action}`);
    const d = a.detail || {};
    if (d.billedMinutes) what += ' ' + t('billing.audit.hoursChange', { from: hours(d.billedMinutes.from), to: hours(d.billedMinutes.to) });
    if (d.description) what += ' ' + t('billing.audit.descChange', { from: d.description.from || '', to: d.description.to || '' });
    if (d.billNo) what += ' ' + (d.billNo.to || d.billNo.from || '');
    return `${at} ${a.actorName || ''} ${what}${a.reason ? t('billing.reasonSuffix', { reason: a.reason }) : ''}`;
  }

  function reviewOp(e, op, extra = {}) {
    return async () => {
      const res = await call('timeReview', { id: e.id, op, ...extra });
      state.openEdit.delete(e.id);
      await loadReview();
      status(t(`billing.done.${op}`, { date: res?.entry?.workDate || e.workDate, name: e.timekeeperName }));
    };
  }

  function entryCard(e) {
    const card = el('div', null, 'item-card');
    card.dataset.entryId = e.id;
    const head = el('div', null, 'item-head');
    const hoursText = e.billedMinutes !== e.minutes
      ? t('billing.hoursWrittenDown', { from: hours(e.minutes), to: hours(e.billedMinutes) })
      : t('billing.hoursValue', { h: hours(e.minutes) });
    head.append(el('strong', `${e.workDate} · ${e.timekeeperName} · ${hoursText}`));
    head.append(el('span', t(`billing.status.${e.status}`), e.status === 'SUBMITTED' ? 'badge badge-yellow' : 'badge badge-green'));
    if (!e.billable) head.append(el('span', t('billing.noCharge'), 'badge badge-red'));
    if (e.billable && e.rateCents != null) head.append(el('span', t('billing.rateAmount', { rate: yuan(e.rateCents), amount: yuan(e.amountCents) }), 'badge badge-neutral'));
    if (e.billable && e.rateCents == null) head.append(el('span', t('billing.noRate'), 'badge badge-red'));
    card.append(head);
    card.append(el('p', e.description || '', 'item-meta cell-text'));
    const src = e.source === 'WORK_RECORD' ? t('billing.sourceWorkLog', { h: hours(e.capturedMinutes) })
      : e.source === 'CLOUD' ? t('billing.sourceCloud') : t('billing.sourceManual');
    if (e.cloudSyncPending) head.append(el('span', t('billing.cloudSyncPending'), 'badge badge-yellow'));
    card.append(el('p', src, 'hint'));

    const actions = el('div', null, 'action-row');
    if (e.status === 'SUBMITTED' || e.status === 'APPROVED') {
      if (e.status === 'SUBMITTED') actions.append(button(t('billing.approve'), 'approve', reviewOp(e, 'APPROVE'), 'primary'));
      actions.append(button(t('billing.edit'), 'edit', async () => { toggle(state.openEdit, e.id); renderReview(); }));
      if (!e.billable) actions.append(button(t('billing.charge'), 'charge', reviewOp(e, 'CHARGE')));
    }
    const audits = e.audit || [];
    actions.append(button(t('billing.auditToggle', { n: audits.length }), 'audit', async () => { toggle(state.openAudit, e.id); renderReview(); }));
    card.append(actions);

    if (state.openEdit.has(e.id)) {
      const form = el('div', null, 'form-grid hb-edit');
      const billed = input(hours(e.billedMinutes), { inputmode: 'decimal', 'data-field': 'billedHours' });
      const desc = input(e.description, { 'data-field': 'description' });
      const reason = input('', { 'data-field': 'reason', placeholder: t('billing.reasonPlaceholder') });
      form.append(labeled(t('billing.billedHours', { h: hours(e.minutes) }), billed), labeled(t('billing.reason'), reason));
      const descLabel = labeled(t('billing.description'), desc);
      descLabel.className = 'field-span-2';
      form.append(descLabel);
      const row = el('div', null, 'form-actions field-span-2');
      row.append(
        button(t('billing.saveAdjust'), 'save-adjust', () => reviewOp(e, 'ADJUST', { billedHours: billed.value, description: desc.value, reason: reason.value })()),
        button(t('billing.markNoCharge'), 'no-charge', () => reviewOp(e, 'NO_CHARGE', { reason: reason.value })()),
        button(t('billing.returnToLawyer'), 'return', () => reviewOp(e, 'RETURN', { reason: reason.value })())
      );
      form.append(row);
      card.append(form);
    }
    if (state.openAudit.has(e.id)) {
      const list = el('ul', null, 'hb-audit');
      for (const a of audits) list.append(el('li', auditLine(a)));
      if (!audits.length) list.append(el('li', t('billing.auditEmpty')));
      card.append(list);
    }
    return card;
  }

  function toggle(set, id) {
    if (set.has(id)) set.delete(id); else set.add(id);
  }

  function renderReview() {
    const box = $('hb-review-list');
    box.replaceChildren();
    if (!state.review.length) {
      box.append(el('p', t('billing.reviewEmpty'), 'hint'));
      return;
    }
    for (const g of groupByMatter(state.review)) {
      const section = el('article', null, 'card');
      section.dataset.intakeId = g.intakeId || '';
      const header = el('header', null, 'card-header');
      const titleBox = el('div');
      titleBox.append(el('h2', g.intakeId ? `${g.client || '—'} · ${g.title}` : t('billing.noMatterGroup')));
      const pending = g.rows.filter((r) => r.status === 'SUBMITTED');
      const amount = g.rows.reduce((s, r) => s + (r.billable && r.amountCents ? r.amountCents : 0), 0);
      const mins = g.rows.reduce((s, r) => s + (r.billable ? r.billedMinutes : 0), 0);
      titleBox.append(el('p', g.intakeId
        ? t('billing.groupSummary', { n: g.rows.length, pending: pending.length, h: hours(mins), amount: yuan(amount) })
        : t('billing.noMatterHint'), 'hint'));
      header.append(titleBox);
      if (g.intakeId && pending.length) {
        header.append(button(t('billing.approveAll', { n: pending.length }), 'approve-all', async () => {
          const res = await call('timeApproveAll', { ids: pending.map((r) => r.id) });
          await loadReview();
          status(t('billing.approvedAll', { n: res?.approved || 0 }) + (res?.failed?.length ? ' ' + res.failed.join('；') : ''), Boolean(res?.failed?.length));
        }, 'primary'));
      }
      if (g.intakeId) {
        header.append(button(t('billing.toBill'), 'to-bill', async () => {
          await ensureRates();
          switchView('bills');
          $('hb-bill-matter').value = String(g.intakeId);
          dropPreview();
          await loadBills();
        }));
      }
      section.append(header);
      const list = el('div', null, 'stack-list');
      for (const e of g.rows) list.append(entryCard(e));
      section.append(list);
      box.append(section);
    }
  }

  // ───────────── 账单 ─────────────

  async function ensureRates() {
    if (!state.rates) state.rates = await call('billingRates', {});
    fillMatterSelect();
  }

  function fillMatterSelect() {
    const sel = $('hb-bill-matter');
    const keep = sel.value;
    sel.replaceChildren();
    for (const m of state.rates?.matters || []) {
      const o = el('option', `${m.clientName || '—'} · ${m.title}${m.feeMode === 'HOURLY' ? '' : ' ' + t('billing.notHourly')}`);
      o.value = String(m.intakeId);
      sel.append(o);
    }
    if (keep) sel.value = keep;
  }

  function billParams() {
    const p = { intakeId: $('hb-bill-matter').value, ...monthRange() };
    const d = $('hb-bill-discount').value.trim();
    if (d) p.discountPercent = d;
    return p;
  }

  function totalsBlock(b) {
    const dl = el('dl', null, 'hb-totals');
    const row = (k, v, cls) => { dl.append(el('dt', k), el('dd', v, cls)); };
    row(t('billing.subtotal'), yuan(b.subtotalCents));
    row(t('billing.discount', { pct: pct(b.discountBps) }), '-' + yuan(b.discountCents));
    if (b.capCents != null) row(t('billing.capReduction', { cap: yuan(b.capCents) }), '-' + yuan(b.capReductionCents));
    row(t('billing.total'), yuan(b.totalCents), 'hb-total');
    row(t('billing.standardValue'), yuan(b.standardAmountCents));
    return dl;
  }

  function linesTable(lines) {
    const wrap = el('div', null, 'table-wrap');
    const table = el('table');
    const head = el('tr');
    for (const k of ['date', 'lawyer', 'level', 'desc', 'hours', 'rate', 'amount']) head.append(el('th', t(`billing.col.${k}`)));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const l of lines || []) {
      const tr = el('tr');
      const h = l.billedMinutes !== l.minutes ? t('billing.hoursWrittenDown', { from: hours(l.minutes), to: hours(l.billedMinutes) }) : hours(l.billedMinutes);
      tr.append(el('td', l.workDate), el('td', l.timekeeperName), el('td', l.level ? t(`billing.level.${l.level}`) : '—'),
        el('td', l.description, 'cell-text'), el('td', h), el('td', yuan(l.rateCents)), el('td', yuan(l.amountCents)));
      body.append(tr);
    }
    table.append(thead, body);
    wrap.append(table);
    return wrap;
  }

  async function previewBill() {
    const params = billParams();
    state.preview = await call('billPreview', params);
    state.previewParams = params;
    renderPreview();
  }

  // 预览之后改了事项、折扣或月份，旧预览作废，免得照着旧画面出单
  function dropPreview() {
    state.preview = null;
    state.previewParams = null;
    renderPreview();
  }

  function renderPreview() {
    const box = $('hb-preview');
    box.replaceChildren();
    const p = state.preview;
    if (!p) return;
    if (p.pendingCount) box.append(el('p', t('billing.pendingWarn', { n: p.pendingCount }), 'badge badge-yellow'));
    if (p.noChargeCount) box.append(el('p', t('billing.noChargeInfo', { n: p.noChargeCount }), 'hint'));
    if (!p.lines.length) {
      box.append(el('p', t('billing.nothingToBill'), 'hint'));
      return;
    }
    box.append(linesTable(p.lines), totalsBlock(p));
    if (p.capCents != null) box.append(el('p', t('billing.capRemaining', { left: yuan(p.capRemainingCents) }), 'hint'));
    box.append(button(t('billing.create'), 'create-bill', async () => {
      const res = await call('billCreate', { ...state.previewParams, expectedTotalCents: p.totalCents, expectedEntryCount: p.lines.length });
      dropPreview();
      state.openBill.add(res?.bill?.id);
      await loadBills();
      status(t('billing.created', { no: res?.bill?.billNo || '' }));
    }, 'primary'));
  }

  async function loadBills() {
    const res = await call('billList', {});
    state.bills = res?.bills || [];
    renderBills();
  }

  function confirmForm(b) {
    const form = el('div', null, 'form-grid hb-confirm');
    const who = input('', { 'data-field': 'confirmedBy', placeholder: t('billing.confirmedByPlaceholder') });
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const date = input(today, { type: 'date', 'data-field': 'confirmedDate' });
    const type = el('select');
    type.dataset.field = 'invoiceType';
    for (const v of ['DIGITAL_NORMAL', 'DIGITAL_SPECIAL', 'VAT_NORMAL', 'VAT_SPECIAL']) {
      const o = el('option', t(`billing.invoiceType.${v}`));
      o.value = v;
      type.append(o);
    }
    const tax = input('', { 'data-field': 'buyerTaxId', placeholder: t('billing.taxIdPlaceholder') });
    form.append(labeled(t('billing.confirmedBy'), who), labeled(t('billing.confirmedDate'), date),
      labeled(t('billing.invoiceTypeLabel'), type), labeled(t('billing.buyerTaxId'), tax));
    const row = el('div', null, 'form-actions field-span-2');
    row.append(button(t('billing.confirm'), 'confirm-bill', async () => {
      const res = await call('billConfirm', { id: b.id, confirmedBy: who.value, confirmedDate: date.value, invoiceType: type.value, buyerTaxId: tax.value });
      await loadBills();
      status(res?.bill?.invoiceAppNo ? t('billing.confirmedWithInvoice', { no: res.bill.invoiceAppNo }) : t('billing.confirmedNoInvoice'));
    }, 'primary'));
    form.append(row);
    return form;
  }

  function billCard(b) {
    const card = el('div', null, 'item-card');
    card.dataset.billId = b.id;
    const head = el('div', null, 'item-head');
    head.append(el('strong', `${b.billNo} · ${b.clientName || '—'} · ${b.matterTitle} · ${yuan(b.totalCents)}`));
    const cls = { DRAFT: 'badge-neutral', SENT: 'badge-yellow', CONFIRMED: 'badge-green', CANCELLED: 'badge-red' }[b.status] || 'badge-neutral';
    head.append(el('span', t(`billing.billStatus.${b.status}`), `badge ${cls}`));
    card.append(head);
    card.append(el('p', t('billing.billMeta', { from: b.periodFrom, to: b.periodTo, n: b.entryCount, h: hours(b.billedMinutes) }), 'item-meta'));
    if (b.status === 'CONFIRMED') {
      card.append(el('p', t('billing.confirmedInfo', { who: b.confirmedBy || '', note: b.confirmNote || '' }), 'hint'));
      if (b.invoiceAppNo) {
        card.append(el('p', t('billing.invoiceInfo', {
          no: b.invoiceAppNo, status: t(`billing.invoiceStatus.${b.invoiceStatus}`), collected: yuan(b.collectedCents)
        }), 'hint'));
      }
    }
    const actions = el('div', null, 'action-row');
    actions.append(button(t(state.openBill.has(b.id) ? 'billing.hideDetail' : 'billing.showDetail'), 'detail', async () => { toggle(state.openBill, b.id); renderBills(); }));
    if (b.status === 'DRAFT') actions.append(button(t('billing.send'), 'send-bill', async () => { await call('billSend', { id: b.id }); state.openBill.add(b.id); await loadBills(); status(t('billing.sent')); }, 'primary'));
    const voided = ['VOIDED', 'RED_INVOICED'].includes(b.invoiceStatus) || (b.status === 'CONFIRMED' && !b.invoiceId);
    if (b.status === 'DRAFT' || b.status === 'SENT' || (b.status === 'CONFIRMED' && voided)) {
      actions.append(button(t('billing.cancel'), 'cancel-bill', async () => {
        const res = await call('billCancel', { id: b.id });
        await loadBills();
        const resend = res?.recalculated || [];
        status(t('billing.cancelled') + (resend.length ? ' ' + t('billing.recalculated', { nos: resend.join('、') }) : ''));
      }));
    }
    if (b.status === 'CONFIRMED' && b.invoiceId) actions.append(button(t('billing.goInvoice'), 'go-invoice', async () => { $('refresh-data')?.click(); $('tab-finance')?.click(); }));
    card.append(actions);
    if (state.openBill.has(b.id)) {
      card.append(linesTable(b.lines), totalsBlock(b));
      if (b.status === 'SENT') card.append(el('p', t('billing.sentHint'), 'hint'), confirmForm(b));
    }
    return card;
  }

  function renderBills() {
    const box = $('hb-bill-list');
    box.replaceChildren();
    if (!state.bills.length) box.append(el('p', t('billing.billsEmpty'), 'hint'));
    for (const b of state.bills) box.append(billCard(b));
  }

  // ───────────── 费率与约定 ─────────────

  async function loadRates() {
    state.rates = await call('billingRates', {});
    renderRates();
    fillMatterSelect();
  }

  function levelSelect(value) {
    const sel = el('select');
    sel.append(Object.assign(el('option', t('billing.levelUnset')), { value: '' }));
    for (const lv of state.rates.levels) {
      const o = el('option', t(`billing.level.${lv}`));
      o.value = lv;
      sel.append(o);
    }
    sel.value = value || '';
    return sel;
  }

  function renderRates() {
    const people = $('hb-timekeepers');
    people.replaceChildren();
    for (const p of state.rates.timekeepers) {
      const tr = el('tr');
      tr.dataset.userId = p.userId;
      const lv = levelSelect(p.level);
      const rate = input(p.standardRateCents == null ? '' : (p.standardRateCents / 100).toFixed(2), { inputmode: 'decimal' });
      const save = button(t('billing.save'), 'save-timekeeper', async () => {
        state.rates = await call('billingSaveTimekeeper', { userId: p.userId, level: lv.value, standardRateYuan: rate.value });
        renderRates();
        status(t('billing.saved'));
      });
      const c1 = el('td'); c1.append(lv);
      const c2 = el('td'); c2.append(rate);
      const c3 = el('td'); c3.append(save);
      tr.append(el('td', p.name, 'cell-text'), c1, c2, c3);
      people.append(tr);
    }
    const box = $('hb-terms');
    box.replaceChildren();
    for (const m of state.rates.matters) {
      const card = el('div', null, 'item-card');
      card.dataset.intakeId = m.intakeId;
      const head = el('div', null, 'item-head');
      head.append(el('strong', `${m.clientName || '—'} · ${m.title}`));
      if (m.feeMode === 'HOURLY') head.append(el('span', t('billing.hourlyBadge'), 'badge badge-green'));
      head.append(el('span', t('billing.billedToDate', { amount: yuan(m.billedToDateCents) }), 'badge badge-neutral'));
      const published = Object.values(state.cloud?.published || {}).map(String).includes(String(m.intakeId));
      if (published) head.append(el('span', t('billing.cloudPublished'), 'badge badge-green'));
      if (state.cloud?.enabled && state.cloud?.firmAdmin) {
        head.append(button(t(published ? 'billing.cloudRepublish' : 'billing.cloudPublish'), 'cloud-publish', async () => {
          state.cloud = await call('cloudBillingPublish', { intakeId: m.intakeId });
          renderCloud();
          renderRates();
          status(t('billing.cloudPublishedDone', { title: m.title }));
        }));
      }
      card.append(head);
      const form = el('div', null, 'form-grid');
      const discount = input(pct(m.discountBps), { inputmode: 'decimal', 'data-field': 'discount' });
      const cap = input(m.capCents == null ? '' : (m.capCents / 100).toFixed(2), { inputmode: 'decimal', 'data-field': 'cap', placeholder: t('billing.capPlaceholder') });
      form.append(labeled(t('billing.discountPercent'), discount), labeled(t('billing.cap'), cap));
      const levelInputs = {};
      for (const lv of state.rates.levels) {
        const v = m.levelRates?.[lv];
        levelInputs[lv] = input(v == null ? '' : (v / 100).toFixed(2), { inputmode: 'decimal', 'data-level': lv, placeholder: t('billing.useStandard') });
        form.append(labeled(t('billing.agreedRate', { level: t(`billing.level.${lv}`) }), levelInputs[lv]));
      }
      const row = el('div', null, 'form-actions field-span-2');
      row.append(button(t('billing.save'), 'save-terms', async () => {
        const levelRates = Object.fromEntries(Object.entries(levelInputs).map(([k, n]) => [k, n.value.trim()]));
        state.rates = await call('billingSaveTerms', { intakeId: m.intakeId, discountPercent: discount.value, capYuan: cap.value, levelRates });
        renderRates();
        status(t('billing.saved'));
      }));
      form.append(row);
      card.append(form);
      box.append(card);
    }
  }

  // ───────────── 实现率 ─────────────

  async function loadMetrics() {
    state.metrics = await call('billingMetrics', monthRange());
    renderMetrics();
  }

  function metricRow(m, isTotal) {
    const tr = el('tr', null, isTotal ? 'hb-total-row' : '');
    const realization = m.realizationPercent == null ? '—' : `${m.realizationPercent}%`;
    tr.append(
      el('td', isTotal ? t('billing.firmTotal') : m.name, 'cell-text'),
      el('td', isTotal || !m.level ? '—' : t(`billing.level.${m.level}`)),
      el('td', hours(m.recordedMinutes)), el('td', hours(m.billableMinutes)), el('td', hours(m.writtenDownMinutes)),
      el('td', hours(m.wipMinutes)), el('td', yuan(m.standardValueCents)), el('td', yuan(m.billedAmountCents)),
      el('td', yuan(m.collectedCents)), el('td', realization)
    );
    return tr;
  }

  function renderMetrics() {
    const body = $('hb-metrics');
    body.replaceChildren();
    const m = state.metrics;
    for (const row of m?.lawyers || []) body.append(metricRow(row, false));
    if (m?.lawyers?.length) body.append(metricRow(m.total, true));
    else {
      const tr = el('tr');
      const td = el('td', t('billing.metricsEmpty'), 'cell-text');
      td.colSpan = 10;
      tr.append(td);
      body.append(tr);
    }
  }

  // ───────────── 框架 ─────────────

  const VIEWS = ['review', 'bills', 'rates', 'metrics'];

  function switchView(view) {
    state.view = VIEWS.includes(view) ? view : 'review';
    for (const v of VIEWS) {
      $(`hb-view-${v}`).hidden = v !== state.view;
      $(`hb-nav-${v}`).setAttribute('aria-selected', String(v === state.view));
    }
  }

  // 律所云端工时汇总：开关在共用的「律所云端」页；这里只显示状态、取回同事交来的工时、发布事项
  async function loadCloud() {
    try {
      state.cloud = await call('cloudBillingStatus', {});
    } catch (err) {
      state.cloud = { available: false, reason: err?.message || '' };
    }
    renderCloud();
  }

  function renderCloud() {
    const box = $('hb-cloud');
    box.replaceChildren();
    const c = state.cloud;
    if (!c) return;
    const line = el('p', null, 'hint');
    if (!c.available) {
      line.textContent = t('billing.cloudUnavailable', { reason: c.reason || '' });
      box.append(line);
      return;
    }
    if (!c.enabled) {
      line.textContent = t('billing.cloudOff');
      box.append(line, button(t('billing.cloudOpenSettings'), 'cloud-settings', async () => { $('tab-cloud')?.click(); }));
      return;
    }
    const n = Object.keys(c.published || {}).length;
    line.textContent = t('billing.cloudOn', { n }) + (c.pendingSync ? ' ' + t('billing.cloudPending', { n: c.pendingSync }) : '');
    box.append(line);
    if (c.firmAdmin) {
      box.append(button(t('billing.cloudPull'), 'cloud-pull', async () => {
        const res = await call('cloudBillingPull', {});
        await loadCloud();
        if (state.view === 'review') await loadReview();
        status(t('billing.cloudPulled', { created: res?.created || 0, refreshed: res?.refreshed || 0 })
          + (res?.unmapped ? ' ' + t('billing.cloudUnmapped', { n: res.unmapped }) : '')
          + (res?.pendingSync ? ' ' + t('billing.cloudPending', { n: res.pendingSync }) : ''), Boolean(res?.pendingSync));
      }, 'primary'), button(t('billing.cloudOpenSettings'), 'cloud-settings', async () => { $('tab-cloud')?.click(); }));
    }
  }

  async function refresh() {
    status('');
    if (!state.cloud) await loadCloud();
    if (state.view === 'review') await loadReview();
    if (state.view === 'bills') { await ensureRates(); await loadBills(); }
    if (state.view === 'rates') await loadRates();
    if (state.view === 'metrics') await loadMetrics();
  }

  function applyStaticText() {
    for (const n of document.querySelectorAll('[data-hb]')) n.textContent = t(n.dataset.hb);
    for (const n of document.querySelectorAll('[data-hb-placeholder]')) n.setAttribute('placeholder', t(n.dataset.hbPlaceholder));
  }

  state.month = defaultMonth();
  $('hb-month').value = state.month;
  $('hb-month').addEventListener('change', () => run(null, async () => {
    if (/^\d{4}-\d{2}$/.test($('hb-month').value)) state.month = $('hb-month').value;
    dropPreview();
    await refresh();
  }));
  $('hb-bill-matter').addEventListener('change', dropPreview);
  $('hb-bill-discount').addEventListener('input', dropPreview);
  for (const v of VIEWS) $(`hb-nav-${v}`).addEventListener('click', () => run(null, async () => { switchView(v); await refresh(); }));
  $('hb-review-status').addEventListener('change', () => run(null, loadReview));
  $('hb-preview-btn').addEventListener('click', () => run($('hb-preview-btn'), previewBill));
  $('hb-seed').addEventListener('click', () => run($('hb-seed'), async () => {
    const res = await call('billingSeedDemo', {});
    state.month = String(res?.from || '').slice(0, 7) || state.month;
    $('hb-month').value = state.month;
    state.rates = null;
    switchView('review');
    await refresh();
    status(t('billing.seeded', { n: res?.created || 0 }));
  }));
  $('tab-hourly')?.addEventListener('click', () => run(null, refresh));
  applyStaticText();
  switchView('review');
  awd.ready().then((ctx) => {
    locale = pickLocale(ctx?.language);
    applyStaticText();
  }).catch(() => {});
}());
