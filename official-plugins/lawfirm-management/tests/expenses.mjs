// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { JSDOM } = createRequire(new URL('../../../frontend/package.json', import.meta.url))('jsdom');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../web/index.html');
const l10nScript = read('../web/expenses-l10n.js');
const script = read('../web/expenses.js');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

async function harness({ stored = null, language = 'zh-CN', quota = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://plugin.test', runScripts: 'outside-only' });
  const store = { expenses: stored };
  dom.window.awd = {
    ready: async () => ({ language }),
    storage: {
      get: async (key) => (store[key] == null ? null : JSON.parse(JSON.stringify(store[key]))),
      set: async (key, value) => {
        if (quota) throw Object.assign(new Error('quota'), { code: 'quota_exceeded' });
        store[key] = JSON.parse(JSON.stringify(value));
      }
    }
  };
  dom.window.eval(l10nScript);
  dom.window.eval(script);
  await tick();
  const doc = dom.window.document;
  const $ = (id) => doc.getElementById(id);
  const add = async (fields) => {
    for (const [id, value] of Object.entries(fields)) $(id).value = value;
    $('ex-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await tick();
  };
  const button = async (id, action) => { doc.querySelector(`[data-expense-id="${id}"] [data-action="${action}"]`).click(); await tick(); };
  const summary = () => [...$('ex-summary').rows].map((tr) => [...tr.cells].map((td) => td.textContent));
  return { dom, $, store, add, button, summary };
}

test('generated l10n table matches l10n/*.json and every used key exists in zh-CN and en-US', () => {
  const window = {};
  new Function('window', l10nScript)(window);
  const table = window.AWD_LAWFIRM_EXPENSE_L10N;
  for (const locale of ['zh-CN', 'en-US']) {
    const all = JSON.parse(read(`../l10n/${locale}.json`));
    const expected = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('expense.')));
    assert.deepEqual(table[locale], expected, `${locale} is out of sync; run build.sh`);
  }
  assert.deepEqual(Object.keys(table['zh-CN']).sort(), Object.keys(table['en-US']).sort());
  const used = [...html.matchAll(/data-ex(?:-placeholder)?="([^"]+)"/g), ...script.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
  for (const key of used) assert.ok(table['zh-CN'][key], `missing l10n key ${key}`);
});

test('amounts are parsed as exact cents and invalid input is rejected', async (t) => {
  const h = await harness(); t.after(() => h.dom.window.close());
  await h.add({ 'ex-matter': '', 'ex-amount': '100' });
  assert.equal(h.store.expenses, null);
  assert.match(h.$('ex-status').textContent, /请填写事项/);
  for (const bad of ['0', '-5', '1.234', 'abc', '']) {
    await h.add({ 'ex-matter': '蓝海案', 'ex-amount': bad });
    assert.equal(h.store.expenses, null, `rejects ${JSON.stringify(bad)}`);
  }
  await h.add({ 'ex-matter': '蓝海案', 'ex-amount': '1,234.5', 'ex-category': 'COURT_FEE', 'ex-voucher': '法院收据 No.1' });
  const [entry] = h.store.expenses.entries;
  assert.equal(entry.amountCents, 123450);
  assert.equal(entry.paidBy, 'FIRM');
  assert.equal(entry.settled, false);
  assert.equal(h.$('ex-amount').value, '', 'amount is cleared after saving');
  assert.equal(h.$('ex-matter').value, '蓝海案', 'matter is kept for the next entry');
});

test('summary separates firm advances, pending settlement, missing vouchers and client-paid costs', async (t) => {
  const h = await harness(); t.after(() => h.dom.window.close());
  await h.add({ 'ex-matter': '蓝海案', 'ex-amount': '0.1', 'ex-category': 'COURT_FEE', 'ex-paid-by': 'FIRM', 'ex-voucher': '收据 1' });
  await h.add({ 'ex-matter': '蓝海案', 'ex-amount': '0.2', 'ex-category': 'TRAVEL', 'ex-paid-by': 'FIRM', 'ex-voucher': '' });
  await h.add({ 'ex-matter': '蓝海案', 'ex-amount': '500', 'ex-category': 'APPRAISAL', 'ex-paid-by': 'CLIENT', 'ex-voucher': '' });
  await h.add({ 'ex-matter': '华星案', 'ex-amount': '80', 'ex-category': 'POSTAGE', 'ex-paid-by': 'FIRM', 'ex-voucher': '快递单' });
  const rows = Object.fromEntries(h.summary().map(([m, ...rest]) => [m, rest]));
  assert.deepEqual(rows['蓝海案'], ['¥0.30', '¥0.30', '¥0.20 缺凭证', '¥500.00'], 'cent arithmetic has no float drift');
  assert.deepEqual(rows['华星案'], ['¥80.00', '¥80.00', '¥0.00', '¥0.00']);
  const travel = h.store.expenses.entries.find((e) => e.category === 'TRAVEL');
  await h.button(travel.id, 'settle');
  assert.equal(h.store.expenses.entries.find((e) => e.id === travel.id).settled, true);
  assert.deepEqual(Object.fromEntries(h.summary().map(([m, ...rest]) => [m, rest]))['蓝海案'], ['¥0.30', '¥0.10', '¥0.00', '¥500.00']);
  const clientPaid = h.store.expenses.entries.find((e) => e.paidBy === 'CLIENT');
  assert.equal(h.dom.window.document.querySelector(`[data-expense-id="${clientPaid.id}"] [data-action="settle"]`), null, 'client-paid costs are not settled by the firm');
  await h.button(travel.id, 'delete');
  assert.equal(h.store.expenses.entries.length, 3);
  assert.match(h.$('ex-status').textContent, /已删除/);
});

test('saved ledger is restored and storage quota errors keep the previous ledger', async (t) => {
  const stored = { entries: [{ id: 'ex-1', date: '2026-11-01', matter: '常年顾问', category: 'NOTARY', amountCents: 30000, paidBy: 'FIRM', voucher: '', settled: false }] };
  const h = await harness({ stored, quota: true }); t.after(() => h.dom.window.close());
  assert.match(h.$('ex-list').textContent, /2026-11-01 · 常年顾问 · ¥300\.00/);
  assert.match(h.$('ex-list').textContent, /缺凭证/);
  await h.add({ 'ex-matter': '常年顾问', 'ex-amount': '10' });
  assert.match(h.$('ex-status').textContent, /64 KB/);
  assert.equal(h.store.expenses.entries.length, 1);
  assert.equal(h.$('ex-list').querySelectorAll('.item-card').length, 1);
});

test('English UI uses tokenized strings', async (t) => {
  const h = await harness({ language: 'en-US' }); t.after(() => h.dom.window.close());
  assert.equal(h.$('tab-expense').textContent.trim(), 'Matter expenses');
  assert.equal(h.$('ex-add').textContent, 'Record expense');
  assert.equal(h.$('ex-category').options[0].textContent, 'Court / arbitration fee');
  assert.equal(h.$('ex-voucher').getAttribute('placeholder'), 'e.g. Court receipt No.0012345; leave blank if none');
});
