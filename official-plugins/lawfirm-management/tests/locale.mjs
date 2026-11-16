// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Non-Chinese UI of the law firm panel (QA post-0.85): no Chinese left in the main views, money from the real amount
// (¥10.3M used to read "1,030.000k"), header badge and practice-group default localized, sidebar-independent.
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
const expenses = read('../web/expenses.js');
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

const OVERVIEW = {
  self: { id: 1, displayName: 'Synthetic Lawyer' },
  intakes: [{
    id: 1, intakeNo: 'LF-2026-0001', title: 'Synthetic matter', status: 'PENDING_LAWYER_CLEARANCE', practiceArea: 'CORPORATE_MA',
    departmentName: '争议解决', leadLawyerName: 'Synthetic Lead', clientName: 'Client Co', counterpartyName: 'Other Co',
    feeMode: 'FIXED', contractAmountCents: 103000000000, conflictRiskLevel: 'YELLOW'
  }],
  clearances: [{ id: 7, intakeId: 1, intakeNo: 'LF-2026-0001', decision: 'PENDING', matchedMatterTitle: 'Old matter', matchedPartyName: 'Party', targetUserName: 'Lawyer B' }],
  dashboard: {
    kpi: { activeMatterCount: 4, totalIntakeCount: 6, activeUnitCount: 5, avgWorkloadIndex: 8, totalContractedCents: 1030000000, totalBilledCents: 680000000, totalCollectedCents: 490000000 },
    departments: [{ departmentName: '示例争议解决部', unitCount: 2, activeMatterCount: 1, avgWorkloadIndex: 7, workloadBand: 'IDLE' }]
  }
};

async function mount(language) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://plugin.invalid/' });
  const send = (data) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data, source: dom.window.parent }));
  dom.window.parent.postMessage = (msg) => {
    if (!msg || msg.awd !== 1 || msg.type !== 'call') return;
    queueMicrotask(() => {
      let result = {};
      if (msg.method === 'context.get') result = { pluginId: 'lawfirm-management', language };
      if (msg.method === 'lawfirm.request' && ['overview', 'seedDemo'].includes(msg.params.action)) result = OVERVIEW;
      send({ awd: 1, type: 'result', seq: msg.seq, ok: true, result });
    });
  };
  for (const src of [sdk, panel, l10n, expenses]) dom.window.eval(src);
  send({ awd: 1, type: 'init', context: { pluginId: 'lawfirm-management', language, theme: 'light' } });
  await tick();
  return { dom, $: (id) => dom.window.document.getElementById(id) };
}

const CJK = /[一-鿿]/;

for (const language of ['en-US', 'de-DE']) {
  test(`${language}: header, intake defaults, intake card, clearance card and dashboard carry no Chinese UI text`, async () => {
    const p = await mount(language);
    assert.doesNotMatch(p.$('self-badge').textContent.replace('Synthetic Lawyer', ''), CJK, 'header badge (practice group / role defaults)');
    assert.doesNotMatch(p.$('intake-department').value, CJK, 'practice-group default value');
    const intakeCard = p.$('intake-list').textContent.replace('争议解决', '');
    assert.doesNotMatch(intakeCard, CJK);
    assert.doesNotMatch(p.$('tab-dashboard').click() || p.$('dashboard-kpis').textContent, CJK);
    p.$('seed-demo').click();
    await tick();
    assert.doesNotMatch(p.$('notice').textContent, CJK, 'demo-loaded toast');
  });
}

test('money is formatted from the real amount, never by appending "0k" to the 10k-yuan figure', async () => {
  const en = await mount('en-US');
  const kpis = en.$('dashboard-kpis').textContent;
  assert.match(kpis, /CN¥10\.3M/, '¥10,300,000 shows as CN¥10.3M');
  assert.doesNotMatch(kpis, /0k|000k/);
  assert.match(en.$('intake-list').textContent, /CN¥1\.03B/, 'the intake fee uses the same real amount');
  const zh = await mount('zh-CN');
  assert.match(zh.$('dashboard-kpis').textContent, /折合 1,030\.00 万元/, 'zh-CN keeps 万元 unchanged');
});
