// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 办案费用台账：诉讼费、鉴定费、差旅费等代垫/直付费用，按事项汇总待向委托人结算金额与缺凭证金额。
// 本机台账，存在插件 storage（宿主上限 64 KB）；金额一律用分（整数）计算。
(function () {
  'use strict';

  const STORE_KEY = 'expenses';
  const TABLE = window.AWD_LAWFIRM_EXPENSE_L10N || {};
  const $ = (id) => document.getElementById(id);

  let locale = 'zh-CN';
  let entries = [];

  function t(key) {
    return TABLE[locale]?.[key] ?? TABLE['en-US']?.[key] ?? TABLE['zh-CN']?.[key] ?? key;
  }

  window.AWD_LAWFIRM_T = t;

  function pickLocale(lang) {
    if (!lang) return 'zh-CN';
    if (TABLE[lang]) return lang;
    return String(lang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  }

  const pad = (n) => String(n).padStart(2, '0');
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // "1,234.5" -> 123450；非法或 <= 0 返回 null。按字符串解析，避免浮点误差。
  function parseCents(raw) {
    const m = String(raw || '').replace(/[,，\s]/g, '').match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!m) return null;
    const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
    return cents > 0 && Number.isSafeInteger(cents) ? cents : null;
  }

  function yuan(cents) {
    return '¥' + (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function status(text) {
    $('ex-status').textContent = text || '';
  }

  async function persist(next, okText) {
    try {
      await awd.storage.set(STORE_KEY, { entries: next });
    } catch (err) {
      status(err?.code === 'quota_exceeded' ? t('expense.quota') : (err?.message || String(err)));
      return false;
    }
    entries = next;
    render();
    status(okText);
    return true;
  }

  async function addEntry(event) {
    event.preventDefault();
    const matter = $('ex-matter').value.trim();
    const amountCents = parseCents($('ex-amount').value);
    if (!matter) return status(t('expense.needMatter'));
    if (amountCents == null) return status(t('expense.needAmount'));
    const entry = {
      id: `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      date: $('ex-date').value || today(), matter, category: $('ex-category').value, amountCents,
      paidBy: $('ex-paid-by').value, voucher: $('ex-voucher').value.trim(), settled: false
    };
    if (await persist([entry, ...entries], t('expense.saved'))) {
      $('ex-amount').value = '';
      $('ex-voucher').value = '';
    }
  }

  function toggleSettled(id) {
    return persist(entries.map((e) => (e.id === id ? { ...e, settled: !e.settled } : e)), t('expense.updated'));
  }

  function deleteEntry(id) {
    return persist(entries.filter((e) => e.id !== id), t('expense.deleted'));
  }

  function el(tag, text, className) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  }

  function summarize() {
    const byMatter = new Map();
    for (const e of entries) {
      const row = byMatter.get(e.matter) || { advanced: 0, pending: 0, noVoucher: 0, client: 0 };
      if (e.paidBy === 'CLIENT') {
        row.client += e.amountCents;
      } else {
        row.advanced += e.amountCents;
        if (!e.settled) row.pending += e.amountCents;
        if (!e.settled && !e.voucher) row.noVoucher += e.amountCents;
      }
      byMatter.set(e.matter, row);
    }
    return byMatter;
  }

  function renderSummary() {
    const body = $('ex-summary');
    body.replaceChildren();
    for (const [matter, row] of summarize()) {
      const tr = el('tr');
      tr.append(el('td', matter), el('td', yuan(row.advanced)), el('td', yuan(row.pending)));
      const missing = el('td', yuan(row.noVoucher));
      if (row.noVoucher) missing.append(' ', el('span', t('expense.noVoucher'), 'badge badge-yellow'));
      tr.append(missing, el('td', yuan(row.client)));
      body.append(tr);
    }
  }

  function renderList() {
    const list = $('ex-list');
    list.replaceChildren();
    if (!entries.length) {
      list.append(el('p', t('expense.empty'), 'hint'));
      return;
    }
    const sorted = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    for (const e of sorted) {
      const card = el('div', null, 'item-card');
      card.dataset.expenseId = e.id;
      const head = el('div', null, 'item-head');
      head.append(el('strong', `${e.date} · ${e.matter} · ${yuan(e.amountCents)}`));
      head.append(el('span', t(`expense.cat.${e.category}`), 'badge badge-neutral'));
      head.append(el('span', t(`expense.paid.${e.paidBy}`), 'badge badge-neutral'));
      if (e.paidBy !== 'CLIENT') {
        head.append(el('span', t(e.settled ? 'expense.settled' : 'expense.unsettled'), e.settled ? 'badge badge-green' : 'badge badge-yellow'));
        if (!e.voucher) head.append(el('span', t('expense.noVoucher'), 'badge badge-red'));
      }
      card.append(head);
      if (e.voucher) card.append(el('p', e.voucher, 'item-meta'));
      const actions = el('div', null, 'action-row');
      if (e.paidBy !== 'CLIENT') {
        const settle = el('button', t(e.settled ? 'expense.markUnsettled' : 'expense.markSettled'));
        settle.type = 'button';
        settle.dataset.action = 'settle';
        settle.addEventListener('click', () => toggleSettled(e.id));
        actions.append(settle);
      }
      const del = el('button', t('expense.delete'));
      del.type = 'button';
      del.dataset.action = 'delete';
      del.addEventListener('click', () => deleteEntry(e.id));
      actions.append(del);
      card.append(actions);
      list.append(card);
    }
  }

  function renderMatters() {
    const box = $('ex-matters');
    box.replaceChildren();
    for (const matter of new Set(entries.map((e) => e.matter))) {
      const opt = document.createElement('option');
      opt.value = matter;
      box.append(opt);
    }
  }

  function render() {
    renderSummary();
    renderList();
    renderMatters();
  }

  function applyStaticText() {
    for (const n of document.querySelectorAll('[data-ex]')) n.textContent = t(n.dataset.ex);
    for (const n of document.querySelectorAll('[data-ex-placeholder]')) n.setAttribute('placeholder', t(n.dataset.exPlaceholder));
  }

  $('ex-form').addEventListener('submit', addEntry);
  $('ex-date').value = today();
  applyStaticText();
  awd.ready().then(async (ctx) => {
    locale = pickLocale(ctx?.language);
    applyStaticText();
    const saved = await awd.storage.get(STORE_KEY);
    if (saved && Array.isArray(saved.entries)) entries = saved.entries;
    render();
  }).catch((err) => status(err?.message || String(err)));
}());
