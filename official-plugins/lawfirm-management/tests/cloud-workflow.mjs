// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const { JSDOM } = createRequire(new URL('../../../frontend/package.json', import.meta.url))('jsdom');
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../web/workflow.js', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
const id = '12345678-1234-1234-1234-123456789012';
async function harness({ self = { userId: 11, name: '合成申请人', firmAdmin: false }, failFirst = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://plugin.test', runScripts: 'outside-only' });
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto });
  const calls = [], listeners = new Map();
  const data = { self, committee: [{ id, version: 7, member: { userId: 33, name: '合成委员' }, state: self.userId === 33 ? 'PENDING' : 'ACCEPTED' }], records: [] };
  dom.window.awd = { ready: async () => ({}), events: { on: (name, fn) => listeners.set(name, fn) }, call: async (method, payload) => {
    calls.push(JSON.parse(JSON.stringify(payload)));
    if (payload.action === 'workflowOverview') return data;
    if (payload.action === 'workflowLookup') return { member: { userId: 22, name: '合成关联律师' } };
    if (payload.action === 'workflowSubmit') {
      if (failFirst) { failFirst = false; throw new Error('合成网络断开，请重试'); }
      return { id: payload.params.requestId };
    }
    if (payload.action === 'workflowAppointmentDecision') { data.committee[0].state = payload.params.decision; return {}; }
    return {};
  } };
  dom.window.eval(script); await tick();
  const $ = key => dom.window.document.getElementById(key);
  return { dom, $, calls, listeners, data, refresh: async () => { $('workflow-refresh').click(); await tick(); } };
}
test('cloud controls use verified identities, require explicit send consent, and do not change legacy finance', async t => {
  const h = await harness(); t.after(() => h.dom.window.close());
  assert.equal(h.calls.length, 0, 'opening the plugin does not upload a local case');
  await h.refresh(); assert.equal(h.$('workflow-admin').hidden, true);
  h.$('workflow-identifier').value = 'synthetic@example.test'; h.$('workflow-lookup').click(); await tick();
  h.$('workflow-title').value = '合成案件'; h.$('workflow-client').value = '合成委托人';
  h.$('workflow-related').value = '22'; h.$('workflow-summary').value = '仅给本人核查的摘要';
  h.$('workflow-form').dispatchEvent(new h.dom.window.Event('submit', { cancelable: true })); await tick();
  assert.equal(h.calls.filter(x => x.action === 'workflowSubmit').length, 0);
  h.$('workflow-consent').checked = true;
  h.$('workflow-form').dispatchEvent(new h.dom.window.Event('submit', { cancelable: true })); await tick();
  const sent = h.calls.find(x => x.action === 'workflowSubmit').params;
  assert.equal(sent.leadId, 11); assert.equal(sent.committeeId, 33); assert.equal(sent.related[0].userId, 22);
  assert.equal(sent.related[0].summary, '仅给本人核查的摘要'); assert.ok(h.$('panel-finance'));
});
test('unknown send result retries same request ID and payload; editing still cannot duplicate committed request', async t => {
  const h = await harness({ failFirst: true }); t.after(() => h.dom.window.close()); await h.refresh();
  h.$('workflow-title').value = '合成案件'; h.$('workflow-client').value = '合成委托人'; h.$('workflow-consent').checked = true;
  const submit = async () => { h.$('workflow-form').dispatchEvent(new h.dom.window.Event('submit', { cancelable: true })); await tick(); };
  await submit(); assert.equal(h.$('workflow-title').disabled, true); assert.match(h.$('workflow-status').textContent, /重试/);
  await submit(); const sends = h.calls.filter(x => x.action === 'workflowSubmit');
  assert.deepEqual(sends[0].params, sends[1].params); assert.equal(h.$('workflow-title').disabled, false);
});
test('notification navigation only reads; appointment acceptance requires the recipient button', async t => {
  const h = await harness({ self: { userId: 33, name: '合成委员', firmAdmin: false } }); t.after(() => h.dom.window.close());
  h.listeners.get('lawfirm.navigate')({ tab: 'conflicts', recordId: id }); await tick();
  assert.ok(h.calls.every(c => c.action === 'workflowOverview'));
  const accept = [...h.$('workflow-appointments').querySelectorAll('button')].find(b => b.textContent === '接受委员指派');
  assert.ok(accept); accept.click(); await tick();
  assert.equal(h.calls.filter(c => c.action === 'workflowAppointmentDecision').length, 1);
  assert.equal(h.calls.find(c => c.action === 'workflowAppointmentDecision').params.expectedVersion, 7);
  assert.equal(h.data.committee[0].state, 'ACCEPTED');
  h.listeners.get('account.changed')(); assert.equal(h.$('workflow-content').hidden, true); assert.equal(h.$('workflow-appointments').textContent, '');
});
test('consulted lawyer sees the current application parties before personally confirming', async t => {
  const h = await harness({ self: { userId: 22, name: '合成关联律师', firmAdmin: false } });
  t.after(() => h.dom.window.close());
  h.data.records = [{ id, title: '合成新业务', status: 'PENDING_LAWYER_CLEARANCE', risk: 'YELLOW',
    consultationContext: { title: '合成新业务', clientName: '本次合成委托人', counterpartyName: '本次合成对方' },
    clearances: [{ targetId: 22, decision: 'PENDING', summary: '仅本人可见的旧案核查摘要' }] }];
  await h.refresh();
  const context = h.$('workflow-records').querySelector('[aria-label="本次申请核查信息"]');
  assert.match(context.textContent, /合成新业务/); assert.match(context.textContent, /本次合成委托人/); assert.match(context.textContent, /本次合成对方/);
  h.$('workflow-records').querySelector('textarea').value = '本人对照双方信息后确认';
  [...h.$('workflow-records').querySelectorAll('button')].find(b => b.textContent === '本人确认放行').click(); await tick();
  assert.deepEqual(h.calls.find(c => c.action === 'workflowClearance').params,
    { recordId: id, decision: 'APPROVED', comment: '本人对照双方信息后确认' });
});
