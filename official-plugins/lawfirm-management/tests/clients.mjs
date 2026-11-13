// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { JSDOM } = createRequire(new URL('../../../frontend/package.json', import.meta.url))('jsdom');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../web/index.html');
const sdk = read('../../../sdk/plugin-sdk/awd-plugin-sdk.js');
const panel = read('../web/panel.js');
const l10n = read('../web/expenses-l10n.js');
const clients = read('../web/clients.js');
const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const LIST = {
  clients: [
    { id: 7, clientNo: 'KH-2026-0007', name: '远航物流有限公司', ownerUserId: 2, ownerName: '许嘉宁', partnerName: '陈思远',
      matterCount: 3, activeMatterCount: 2, collectedThisYearCents: 1250000, arCents: 300000,
      lastInteractionDays: 12, lastInteractionSource: 'WORK_LOG', creditCode: '91310000MA1K000000' },
    { id: 8, clientNo: 'KH-2026-0008', name: '南湖地产有限公司', ownerName: null, matterCount: 1, activeMatterCount: 0,
      collectedThisYearCents: 0, arCents: 0, lastInteractionDays: null, lastInteractionSource: null }
  ],
  totals: { clientCount: 2, activeMatterCount: 2, collectedThisYearCents: 1250000, arCents: 300000, staleOver90Count: 1, year: 2026 },
  users: [{ id: 1, displayName: '陈思远' }, { id: 2, displayName: '许嘉宁' }],
  restricted: false
};

const PROFILE = {
  ...LIST.clients[0], canEdit: true, partyType: 'ORGANIZATION', contacts: [{ name: '王敏', title: '法务总监', phone: '13800000000', email: 'wm@example.test' }],
  relations: [{ id: 31, relationType: 'ACTUAL_CONTROLLER', direction: 'IN', partyId: 40, partyName: '周启明', partyIsClient: false, description: '周启明是远航物流有限公司的实际控制人' }],
  indirectShareholders: [{ partyId: 41, partyName: '林海', partyIsClient: false, depth: 2, effectiveBps: 4400, path: '林海持有远航控股 80% 股权；远航控股持有远航物流有限公司 55% 股权' }],
  indirectSubsidiaries: [],
  matters: [{ id: 1, intakeNo: 'LF-1', title: '远航仓储租赁纠纷', status: 'APPROVED_FILED', leadLawyerName: '陈思远', counterpartyName: '某仓储', contractAmountCents: 800000, projectName: '远航仓储' }],
  workbenchProjects: [], invoices: [], collections: [],
  conflicts: [{ kind: 'AGAINST', intakeNo: 'LF-9', title: '对抗远航', riskLevel: 'YELLOW', relationPath: '周启明是远航物流有限公司的实际控制人' }],
  signals: [{ date: '2026-10-31', source: 'WORK_LOG', projectName: '远航仓储' }]
};

const CLOUD_LIST = {
  clients: [
    { id: 41, clientNo: 'KH-2026-0001', name: '星河医疗器械有限公司', ownerName: '许嘉宁', partnerName: '陈思远', restricted: false, canEdit: true, version: 3 },
    { id: 42, clientNo: 'KH-2026-0002', name: '东方航运有限公司', ownerName: '周铭泽', restricted: true, canEdit: false, version: 1 }
  ]
};

async function mount({ language = 'zh-CN', oldHost = false, cloud = null } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://plugin.invalid/' });
  const calls = [];
  const send = (data) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data, source: dom.window.parent }));
  dom.window.parent.postMessage = (msg) => {
    if (!msg || msg.awd !== 1 || msg.type !== 'call') return;
    calls.push(msg);
    queueMicrotask(() => {
      let result = {};
      if (msg.method === 'context.get') result = { pluginId: 'lawfirm-management', language };
      if (msg.method === 'lawfirm.request') {
        const { action, params } = msg.params;
        // 0.85.x 宿主：后端不认识客户管理动作
        if (oldHost && ['listClients', 'getClient', 'saveClient', 'saveRelation', 'searchParties'].includes(action)) {
          send({ awd: 1, type: 'result', seq: msg.seq, ok: false, error: { code: 'invoke_failed', message: '不支持的律所管理操作：' + action } });
          return;
        }
        if (action === 'conflictPreview') result = { riskLevel: 'GREEN', summary: '未发现利益冲突', hits: [] };
        if (action === 'overview') result = { self: { id: 1, displayName: '陈思远' }, intakes: [], restricted: false };
        if (action === 'listClients') result = LIST;
        if (action === 'getClient') result = { client: PROFILE };
        if (action === 'searchParties') result = { parties: [{ id: 41, name: '林海', client: false }] };
        if (action === 'saveRelation') result = { client: { ...PROFILE, relations: [...PROFILE.relations, { id: 32, relationType: 'SHAREHOLDER', direction: 'IN', partyId: 41, partyName: '林海', description: '林海持有远航物流有限公司 30% 股权' }] } };
        if (action === 'submitIntake') result = { intake: { id: 2, clientId: params.clientId } };
        if (action === 'cloud.settings.get') {
          if (!cloud) { send({ awd: 1, type: 'result', seq: msg.seq, ok: false, error: { code: 'invoke_failed', message: 'not connected' } }); return; }
          result = cloud;
        }
        if (action === 'clients.list') result = CLOUD_LIST;
        if (action === 'clients.get') result = { client: CLOUD_LIST.clients.find((c) => c.id === params.partyId) };
        if (action === 'clients.save') {
          if (params.expectedVersion !== 3) { send({ awd: 1, type: 'result', seq: msg.seq, ok: false, error: { code: 'invoke_failed', message: '该记录已被同事修改，请刷新后再改' } }); return; }
          result = { client: { ...CLOUD_LIST.clients[0], version: 4 } };
        }
        if (action === 'clients.conflictSearch') result = { riskLevel: 'YELLOW', hits: [{ ruleTitle: '新案对方当事人与本所客户存在关联关系（含间接股权）', clientName: '星河医疗器械有限公司', clientNo: 'KH-2026-0001', ownerName: '许嘉宁', relationPath: '林海持有星河控股 80% 股权' }] };
        if (action === 'uploadClientsToCloud') result = { uploadedClients: 2, created: 1, matched: 1 };
      }
      send({ awd: 1, type: 'result', seq: msg.seq, ok: true, result });
    });
  };
  for (const src of [sdk, panel, l10n, clients]) dom.window.eval(src);
  send({ awd: 1, type: 'init', context: { pluginId: 'lawfirm-management', language, theme: 'light' } });
  await tick();
  const $ = (id) => dom.window.document.getElementById(id);
  const actions = (name) => calls.filter((c) => c.method === 'lawfirm.request' && c.params.action === name).map((c) => c.params.params);
  return { dom, $, calls, actions };
}

test('client list: tab is labelled, KPIs and rows show revenue, receivables and last interaction source', async () => {
  const p = await mount();
  assert.equal(p.$('tab-clients').textContent.replace(/\s+/g, ''), '客户管理2');
  p.$('tab-clients').click();
  await tick();
  assert.equal(p.$('panel-clients').hidden, false);
  const text = p.$('clients-root').textContent;
  assert.match(text, /2026 年实收/);
  assert.match(text, /超过 90 天无往来/);
  const rows = p.dom.window.document.querySelectorAll('tr.client-row');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /远航物流有限公司.*KH-2026-0007/);
  assert.match(rows[0].textContent, /12 天前 · 工作记录/);
  assert.match(rows[1].textContent, /暂无往来记录/);
  assert.equal(rows[1].querySelector('.badge').className, 'badge badge-red');
});

test('client profile: relations, derived indirect shareholder with chain, conflicts via relationship path', async () => {
  const p = await mount();
  p.dom.window.document.querySelector('tr.client-row').click();
  await tick();
  assert.equal(p.actions('getClient').at(-1).clientId, 7);
  const text = p.$('clients-root').textContent;
  assert.match(text, /实际控制人（对方控制本客户）周启明/);
  assert.match(text, /林海.*第 2 层.*44%.*林海持有远航控股 80% 股权/);
  assert.match(text, /他案命中本客户.*对抗远航/);
  assert.match(text, /王敏/);
});

test('adding a relationship picks an existing party from search and sends direction and shareholding', async () => {
  const p = await mount();
  p.dom.window.document.querySelector('tr.client-row').click();
  await tick();
  p.$('rel-type').value = 'SHAREHOLDER:IN';
  p.$('rel-type').dispatchEvent(new p.dom.window.Event('change'));
  assert.equal(p.$('rel-share').hidden, false);
  p.$('rel-party').value = '林海';
  p.$('rel-party').dispatchEvent(new p.dom.window.Event('input'));
  await tick();
  p.$('rel-share').value = '30';
  p.$('rel-save').click();
  await tick();
  const sent = p.actions('saveRelation').at(-1);
  assert.equal(sent.clientId, 7);
  assert.equal(sent.relationType, 'SHAREHOLDER');
  assert.equal(sent.direction, 'IN');
  assert.equal(sent.partyId, 41, 'picked existing party is referenced by id, not re-created by name');
  assert.equal(sent.sharePercent, '30');
  assert.match(p.$('clients-root').textContent, /林海持有远航物流有限公司 30% 股权/);

  p.$('rel-type').value = 'SPOUSE:BOTH';
  p.$('rel-type').dispatchEvent(new p.dom.window.Event('change'));
  assert.equal(p.$('rel-share').hidden, true, 'shareholding only for shareholder relations');
});

test('intake form: choosing an existing client locks the name and sends clientId; reset unlocks', async () => {
  const p = await mount();
  const pick = p.$('intake-client-pick');
  assert.ok(pick, 'picker is inserted into the intake form');
  pick.dispatchEvent(new p.dom.window.Event('focus'));
  await tick();
  pick.value = '7';
  pick.dispatchEvent(new p.dom.window.Event('change'));
  assert.equal(p.$('intake-client-name').value, '远航物流有限公司');
  assert.equal(p.$('intake-client-name').readOnly, true);
  assert.equal(p.$('intake-client-code').value, '91310000MA1K000000');
  p.$('intake-title').value = '远航新案';
  p.$('btn-submit-intake').click();
  await tick();
  assert.equal(p.actions('submitIntake').at(-1).clientId, 7);
  await tick();
  assert.equal(p.$('intake-client-name').readOnly, false, 'form reset after submit unlocks the client fields');
  assert.equal(p.$('intake-client-id').value, '');

  p.$('intake-client-name').value = ' 南湖地产 有限公司';
  p.$('intake-client-name').dispatchEvent(new p.dom.window.Event('input'));
  assert.match(p.$('intake-client-hint').textContent, /KH-2026-0008/, 'typing an existing client name points to its record');
});

test('English locale renders client UI from l10n keys', async () => {
  const p = await mount({ language: 'en-US' });
  assert.match(p.$('tab-clients').textContent, /Clients/);
  assert.match(p.$('clients-root').textContent, /Collected in 2026/);
  assert.match(p.dom.window.document.querySelector('tr.client-row').textContent, /12 days ago · Work record/);
});

test('host without client actions (0.85.x): Clients tab and intake picker are hidden, intake and conflict check work as before', async () => {
  const p = await mount({ oldHost: true });
  assert.equal(p.$('tab-clients').hidden, true);
  assert.equal(p.$('panel-clients').hidden, true);
  assert.equal(p.$('intake-client-pick'), null, 'no client picker on a host that cannot resolve clients');
  assert.equal(p.$('client-error'), null);
  p.$('intake-title').value = '旧宿主上的收案';
  p.$('intake-client-name').value = '某委托人有限公司';
  p.$('intake-counterparty-name').value = '某对方有限公司';
  p.$('btn-preview-conflict').click();
  await tick();
  assert.equal(p.actions('conflictPreview').length, 1);
  assert.match(p.$('conflict-preview-card').textContent, /未发现利益冲突/);
  p.$('btn-submit-intake').click();
  await tick();
  const sent = p.actions('submitIntake').at(-1);
  assert.equal(sent.clientName, '某委托人有限公司');
  assert.equal('clientId' in sent && sent.clientId !== undefined, false, 'old host receives the same intake payload as before');
test('firm cloud off or unavailable: local ledger only, with a pointer to the shared settings', async () => {
  const p = await mount({ cloud: { clientsEnabled: false, timeEnabled: false, version: 0 } });
  assert.match(p.$('client-cloud-bar').textContent, /律所云端未开启/);
  assert.equal(p.$('client-mode-cloud'), null);
  const q = await mount();
  assert.equal(q.$('client-cloud-bar'), null, 'no cloud bar when the cloud status cannot be read');
});

test('firm cloud on: cloud list shows visibility, restricted profile hides details, stale edit shows the server message', async () => {
  const p = await mount({ cloud: { clientsEnabled: true, timeEnabled: false, version: 2 } });
  p.$('client-mode-cloud').click();
  await tick();
  const rows = p.dom.window.document.querySelectorAll('tr.client-row');
  assert.equal(rows.length, 2);
  assert.match(rows[1].textContent, /仅名称与维护人/);
  rows[1].click();
  await tick();
  assert.equal(p.actions('clients.get').at(-1).partyId, 42);
  assert.match(p.$('client-restricted').textContent, /只显示名称与维护人/);
  assert.equal(p.$('client-edit'), null);

  p.$('client-back').click();
  await tick();
  p.dom.window.document.querySelector('tr.client-row').click();
  await tick();
  p.$('client-edit').click();
  await tick();
  assert.equal(p.$('client-f-owner'), null, 'cloud owner is a cloud account, not picked from local users');
  p.$('client-save').click();
  await tick();
  assert.equal(p.actions('clients.save').at(-1).expectedVersion, 3);
  // 同事已改过：再次保存带上的是旧版本，服务器拒绝，界面原样提示
  p.$('client-edit').click();
  await tick();
  p.$('client-save').click();
  await tick();
  assert.equal(p.actions('clients.save').at(-1).expectedVersion, 4);
  assert.match(p.$('clients-status').textContent, /该记录已被同事修改，请刷新后再改/);

  p.$('client-cancel').click();
  await tick();
  p.$('client-back').click();
  await tick();
  p.$('client-upload').click();
  await tick();
  assert.match(p.$('clients-status').textContent, /已上传 2 位客户（新建 1，与云端已有档案对上 1）/);
});

test('intake precheck also searches firm cloud parties when the firm cloud is on', async () => {
  const p = await mount({ cloud: { clientsEnabled: true, timeEnabled: false, version: 2 } });
  p.$('intake-client-name').value = '另一委托人有限公司';
  p.$('intake-counterparty-name').value = '林海';
  p.$('btn-preview-conflict').click();
  await tick();
  assert.equal(p.actions('clients.conflictSearch').at(-1).counterpartyName, '林海');
  assert.match(p.$('cloud-conflict-card').textContent, /星河医疗器械有限公司（KH-2026-0001）· 维护人：许嘉宁/);
  assert.match(p.$('cloud-conflict-card').textContent, /林海持有星河控股 80% 股权/);
});
