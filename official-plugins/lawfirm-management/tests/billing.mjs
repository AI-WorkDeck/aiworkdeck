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
const script = read('../web/billing.js');
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

const entry = (over = {}) => ({
  id: 1, userId: 7, timekeeperName: '周律师', intakeId: 3, matterTitle: '数据合规专项', clientName: '甲公司', workDate: '2026-10-05',
  minutes: 90, billedMinutes: 90, capturedMinutes: null, description: '起草隐私政策', billable: true, source: 'MANUAL',
  status: 'SUBMITTED', rateCents: 180000, amountCents: 270000, audit: [], ...over
});

function harness({ language = 'zh-CN', responses = {} } = {}) {
  const dom = new JSDOM(html, { url: 'https://plugin.test', runScripts: 'outside-only' });
  const calls = [];
  dom.window.awd = {
    ready: async () => ({ language }),
    call: async (method, { action, params }) => {
      assert.equal(method, 'lawfirm.request');
      calls.push({ action, params: JSON.parse(JSON.stringify(params)) }); // 跨 realm 对象转成本 realm 再比较
      const r = responses[action];
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? r(params) : (r ?? {});
    }
  };
  dom.window.eval(l10nScript);
  dom.window.eval(script);
  const doc = dom.window.document;
  const $ = (id) => doc.getElementById(id);
  const click = async (node) => { node.click(); await tick(); };
  return { dom, doc, $, calls, click };
}

test('every billing.* key used by the panel exists in zh-CN and en-US', () => {
  const zh = JSON.parse(read('../l10n/zh-CN.json'));
  const en = JSON.parse(read('../l10n/en-US.json'));
  const used = [...html.matchAll(/data-hb(?:-placeholder)?="([^"]+)"/g), ...script.matchAll(/\bt\('(billing\.[^']+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 40);
  for (const key of used) {
    assert.ok(zh[key], `zh-CN missing ${key}`);
    assert.ok(en[key], `en-US missing ${key}`);
  }
  const billingKeys = (o) => Object.keys(o).filter((k) => k.startsWith('billing.')).sort();
  assert.deepEqual(billingKeys(zh), billingKeys(en));
  for (const k of billingKeys(zh)) {
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(ph(zh[k]), ph(en[k]), `placeholders differ for ${k}`);
  }
});

test('review groups by client and matter, approves, writes down with reason and shows the trail', async (t) => {
  let list = [
    entry(),
    entry({ id: 2, timekeeperName: '陈律师', status: 'APPROVED', billedMinutes: 30, minutes: 60, rateCents: 100000, amountCents: 50000,
      audit: [{ action: 'WRITE_DOWN', actorName: '林合伙人', reason: '行政性工作', at: '2026-11-01T10:00:00Z', detail: { billedMinutes: { from: 60, to: 30 } } }] }),
    entry({ id: 3, intakeId: null, matterTitle: null, clientName: null, projectName: '未立案', rateCents: null, amountCents: null })
  ];
  const h = harness({ responses: {
    timeReviewList: () => ({ entries: list }),
    timeReview: (p) => ({ entry: { workDate: '2026-10-05' } }),
    timeApproveAll: () => ({ approved: 1, failed: [] })
  } });
  t.after(() => h.dom.window.close());
  await h.click(h.$('tab-hourly'));
  const groups = h.$('hb-review-list').querySelectorAll('article.card');
  assert.equal(groups.length, 2);
  assert.match(groups[0].textContent, /甲公司 · 数据合规专项/);
  assert.match(groups[0].textContent, /可收费 2 小时，按适用费率 ¥3,200\.00/);
  assert.match(groups[1].textContent, /未立案项目/);
  assert.equal(groups[1].querySelector('[data-action="approve-all"]'), null, 'no approve-all for entries without a matter');

  const card2 = h.doc.querySelector('[data-entry-id="2"]');
  assert.match(card2.textContent, /1 → 0\.5 小时/);
  await h.click(card2.querySelector('[data-action="audit"]'));
  assert.match(h.doc.querySelector('[data-entry-id="2"] .hb-audit').textContent, /林合伙人 核减 1 → 0\.5 小时（理由：行政性工作）/);

  await h.click(h.doc.querySelector('[data-entry-id="1"] [data-action="approve"]'));
  assert.deepEqual(h.calls.find((c) => c.action === 'timeReview').params, { id: 1, op: 'APPROVE' });

  await h.click(h.doc.querySelector('[data-entry-id="1"] [data-action="edit"]'));
  const form = h.doc.querySelector('[data-entry-id="1"] .hb-edit');
  form.querySelector('[data-field="billedHours"]').value = '1';
  form.querySelector('[data-field="reason"]').value = '重复劳动';
  form.querySelector('[data-field="description"]').value = '起草个人信息处理规则';
  await h.click(form.querySelector('[data-action="save-adjust"]'));
  assert.deepEqual(h.calls.filter((c) => c.action === 'timeReview').at(-1).params,
    { id: 1, op: 'ADJUST', billedHours: '1', description: '起草个人信息处理规则', reason: '重复劳动' });

  await h.click(groups[0].querySelector('[data-action="approve-all"]'));
  assert.deepEqual(h.calls.find((c) => c.action === 'timeApproveAll').params, { ids: [1] });
  assert.match(h.$('hb-status').textContent, /已通过 1 条/);
});

test('bill preview shows exact totals, creates, sends and records client confirmation', async (t) => {
  const bill = { id: 9, billNo: 'TB202611-0001', clientName: '甲公司', matterTitle: '数据合规专项', periodFrom: '2026-10-01', periodTo: '2026-10-31',
    status: 'DRAFT', entryCount: 2, billedMinutes: 210, subtotalCents: 590000, discountBps: 1000, discountCents: 59000, capCents: 900000,
    capReductionCents: 0, totalCents: 531000, standardAmountCents: 700000, lines: [] };
  let bills = [];
  const h = harness({ responses: {
    timeReviewList: { entries: [] },
    billingRates: { matters: [{ intakeId: 3, title: '数据合规专项', clientName: '甲公司', feeMode: 'HOURLY' }], timekeepers: [], levels: [] },
    billPreview: { ...bill, lines: [{ workDate: '2026-10-05', timekeeperName: '周律师', level: 'SENIOR_ASSOCIATE', description: '起草', minutes: 180, billedMinutes: 180, rateCents: 180000, amountCents: 540000 }],
      capRemainingCents: 900000, pendingCount: 1, noChargeCount: 1 },
    billCreate: () => { bills = [bill]; return { bill }; },
    billList: () => ({ bills }),
    billSend: () => { bills = [{ ...bill, status: 'SENT' }]; return {}; },
    billConfirm: () => ({ bill: { invoiceAppNo: 'INV-1' } })
  } });
  t.after(() => h.dom.window.close());
  h.$('hb-month').value = '2026-10';
  h.$('hb-month').dispatchEvent(new h.dom.window.Event('change'));
  await tick();
  await h.click(h.$('hb-nav-bills'));
  assert.equal(h.$('hb-bill-matter').value, '3');
  h.$('hb-bill-discount').value = '10';
  await h.click(h.$('hb-preview-btn'));
  assert.deepEqual(h.calls.find((c) => c.action === 'billPreview').params, { intakeId: '3', from: '2026-10-01', to: '2026-10-31', discountPercent: '10' });
  const preview = h.$('hb-preview').textContent;
  assert.match(preview, /还有 1 条工时待审核/);
  assert.match(preview, /资深律师/);
  assert.match(preview, /工时小计¥5,900\.00/);
  assert.match(preview, /折扣（10%）-¥590\.00/);
  assert.match(preview, /本单应收¥5,310\.00/);
  // 预览后改了折扣：旧预览作废，不能照旧画面出单
  h.$('hb-bill-discount').value = '20';
  h.$('hb-bill-discount').dispatchEvent(new h.dom.window.Event('input'));
  assert.equal(h.$('hb-preview').textContent, '');
  h.$('hb-bill-discount').value = '10';
  await h.click(h.$('hb-preview-btn'));
  await h.click(h.$('hb-preview').querySelector('[data-action="create-bill"]'));
  assert.deepEqual(h.calls.find((c) => c.action === 'billCreate').params,
    { intakeId: '3', from: '2026-10-01', to: '2026-10-31', discountPercent: '10', expectedTotalCents: 531000, expectedEntryCount: 1 });
  assert.match(h.$('hb-status').textContent, /TB202611-0001/);
  const card = () => h.doc.querySelector('[data-bill-id="9"]');
  assert.match(card().textContent, /草稿/);
  await h.click(card().querySelector('[data-action="send-bill"]'));
  assert.match(card().textContent, /待客户确认/);
  const form = card().querySelector('.hb-confirm');
  form.querySelector('[data-field="confirmedBy"]').value = '王总';
  form.querySelector('[data-field="invoiceType"]').value = 'DIGITAL_SPECIAL';
  await h.click(form.querySelector('[data-action="confirm-bill"]'));
  const confirm = h.calls.find((c) => c.action === 'billConfirm').params;
  assert.equal(confirm.id, 9);
  assert.equal(confirm.confirmedBy, '王总');
  assert.equal(confirm.invoiceType, 'DIGITAL_SPECIAL');
  assert.match(h.$('hb-status').textContent, /INV-1/);
});

test('metrics table formats hours, money and realization; errors surface in the status line', async (t) => {
  const h = harness({ responses: {
    timeReviewList: { entries: [] },
    billingMetrics: { lawyers: [{ name: '陈律师', level: 'ASSOCIATE', recordedMinutes: 240, billableMinutes: 90, writtenDownMinutes: 150, wipMinutes: 0,
      standardValueCents: 300000, billedAmountCents: 45000, collectedCents: 25424, realizationPercent: '8.5' },
      { name: '新律师', level: null, recordedMinutes: 6, billableMinutes: 6, writtenDownMinutes: 0, wipMinutes: 6, standardValueCents: 0, billedAmountCents: 0, collectedCents: 0, realizationPercent: null }],
      total: { recordedMinutes: 246, billableMinutes: 96, writtenDownMinutes: 150, wipMinutes: 6, standardValueCents: 300000, billedAmountCents: 45000, collectedCents: 25424, realizationPercent: '8.5' } },
    billingRates: new Error('无权查看：全所收费台账与看板仅限律所管理员')
  } });
  t.after(() => h.dom.window.close());
  await h.click(h.$('hb-nav-metrics'));
  const rows = [...h.$('hb-metrics').rows].map((r) => [...r.cells].map((c) => c.textContent));
  assert.deepEqual(rows[0], ['陈律师', '律师', '4', '1.5', '2.5', '0', '¥3,000.00', '¥450.00', '¥254.24', '8.5%']);
  assert.equal(rows[1][9], '—', 'no realization without settled time');
  assert.equal(rows[2][0], '全所合计');
  await h.click(h.$('hb-nav-rates'));
  assert.equal(h.$('hb-status').dataset.error, 'true');
  assert.match(h.$('hb-status').textContent, /仅限律所管理员/);
});

test('English UI uses tokenized strings', async (t) => {
  const h = harness({ language: 'en-US', responses: { timeReviewList: { entries: [] } } });
  t.after(() => h.dom.window.close());
  await tick();
  assert.equal(h.$('tab-hourly').textContent.trim(), 'Hourly billing');
  assert.equal(h.$('hb-nav-metrics').textContent, 'Billable hours & realization');
  assert.equal(h.$('hb-review-status').options[0].textContent, 'To review');
});
