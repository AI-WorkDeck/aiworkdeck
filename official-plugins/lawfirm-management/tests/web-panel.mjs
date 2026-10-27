// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { JSDOM } = (() => {
  for (const rel of ['../../../frontend/package.json', '../../../../../frontend/package.json']) {
    try {
      return createRequire(new URL(rel, import.meta.url))('jsdom');
    } catch { /* try next */ }
  }
  throw new Error('Cannot resolve jsdom from frontend/package.json');
})();

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const sdkSource = readFileSync(new URL('../../../sdk/plugin-sdk/awd-plugin-sdk.js', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../web/panel.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../web/panel.css', import.meta.url), 'utf8');

const tick = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
  }
};

function createDemoState() {
  return {
    self: {
      id: 101,
      displayName: '韩泽伟律师',
      departmentName: '资本市场与并购部',
      role: '管理合伙人 · 利冲委员会主任'
    },
    intakes: [
      {
        id: 1,
        intakeNo: 'LF-2026-0001',
        title: '华星半导体科创板IPO专项法律服务',
        practiceArea: 'CAPITAL_MARKET',
        departmentName: '资本市场与并购部',
        leadLawyerName: '韩泽伟律师',
        clientName: '华星半导体股份有限公司',
        clientCreditCode: '91110108MA001111XX',
        counterpartyName: '无',
        feeMode: 'FIXED',
        contractAmountCents: 280000000,
        conflictRiskLevel: 'GREEN',
        conflictSummary: '【G0_CLEAR】全国律协《律师执业行为规范》第五十条：经检索全所在办案件、常年顾问与历史客户，未发现利益冲突。',
        status: 'APPROVED_FILED',
        ethicalWallApplied: false,
        clientWaiverUploaded: false
      },
      {
        id: 2,
        intakeNo: 'LF-2026-0002',
        title: '蓝海光电诉华星半导体（集团）有限公司技术秘密侵权纠纷',
        practiceArea: 'IP_TECH',
        departmentName: '争议解决部',
        leadLawyerName: '林致远律师',
        clientName: '苏州蓝海光电科技有限公司',
        clientCreditCode: '91320500MA002222YY',
        counterpartyName: '华星半导体（集团）有限公司',
        feeMode: 'CONTINGENCY',
        contractAmountCents: 120000000,
        contingencyRateBps: 2000,
        conflictRiskLevel: 'YELLOW',
        conflictSummary: '【YELLOW · Y1_EXISTING_CLIENT_OTHER_MATTER】新案对方当事人与本所在办案件委托人「华星半导体股份有限公司」商号核心词干一致，需征询主办律师放行并建立信息隔离墙。',
        feeComplianceWarning: '《关于进一步规范律师服务收费的意见》分段递减上限提示：风险代理收费最高不得超过标的额的30%，且分段递减上限为：不超过100万元部分≤18%',
        status: 'PENDING_LAWYER_CLEARANCE',
        imConversationId: 'im-conv-conflict-2'
      }
    ],
    clearances: [
      {
        id: 501,
        intakeId: 2,
        intakeNo: 'LF-2026-0002',
        targetUserId: 101,
        targetUserName: '韩泽伟律师',
        matchedProjectId: 11,
        matchedMatterTitle: '华星半导体科创板IPO专项法律服务',
        matchedPartyName: '华星半导体股份有限公司',
        conflictRuleCitation: '全国律协《律师执业行为规范》第五十一条第（三）项、第五十二条第（一）项',
        decision: 'PENDING',
        comment: '',
        imConversationId: 'im-conv-conflict-2'
      }
    ],
    invoices: [
      {
        id: 801,
        invoiceAppNo: 'INV-2026-001',
        intakeId: 1,
        intakeNo: 'LF-2026-0001',
        matterTitle: '华星半导体科创板IPO专项法律服务',
        departmentName: '资本市场与并购部',
        invoiceType: 'DIGITAL_SPECIAL',
        amountCents: 180000000,
        taxRateBps: 600,
        taxAmountCents: 10188679,
        netAmountCents: 169811321,
        buyerName: '华星半导体股份有限公司',
        buyerTaxId: '91110108MA001111XX',
        status: 'ISSUED',
        invoiceNumber: 'SD-000801',
        collectedAmountCents: 120000000,
        externalSyncStatus: 'PENDING'
      }
    ],
    collections: [
      {
        id: 901,
        collectionNo: 'COL-2026-001',
        intakeId: 1,
        intakeNo: 'LF-2026-0001',
        matterTitle: '华星半导体科创板IPO专项法律服务',
        invoiceId: 801,
        invoiceAppNo: 'INV-2026-001',
        payerName: '华星半导体股份有限公司',
        amountCents: 120000000,
        paymentMethod: 'BANK_TRANSFER',
        bankVoucherNo: 'BK-20261010-7712',
        receivedDate: '2026-10-10',
        reconciliationStatus: 'RECONCILED'
      }
    ],
    dashboard: {
      kpis: {
        activeMatterCount: 8,
        totalIntakeCount: 10,
        activeUnitCount: 6,
        avgWorkloadIndex: 74,
        totalContractedCents: 650000000,
        totalBilledCents: 420000000,
        totalCollectedCents: 336000000,
        totalOutstandingCents: 84000000,
        billingRatePercent: 64.6,
        billedCollectionRatePercent: 80.0,
        contractCollectionRatePercent: 51.7
      },
      arAging: {
        under30DaysCents: 44000000,
        days30To90Cents: 25000000,
        over90DaysCents: 15000000
      },
      departments: [
        {
          departmentName: '资本市场与并购部',
          headLawyerName: '韩泽伟律师',
          unitCount: 3,
          activeMatterCount: 5,
          avgWorkloadIndex: 78,
          workloadBand: 'SATURATED',
          contractedCents: 420000000,
          billedCents: 280000000,
          collectedCents: 238000000,
          outstandingArCents: 42000000,
          billedCollectionRatePercent: 85.0,
          contractCollectionRatePercent: 56.7
        },
        {
          departmentName: '争议解决部',
          headLawyerName: '林致远律师',
          unitCount: 3,
          activeMatterCount: 3,
          avgWorkloadIndex: 66,
          workloadBand: 'OPTIMAL',
          contractedCents: 230000000,
          billedCents: 140000000,
          collectedCents: 98000000,
          outstandingArCents: 42000000,
          billedCollectionRatePercent: 70.0,
          contractCollectionRatePercent: 42.6
        }
      ],
      teamLeads: [
        {
          leadLawyerName: '韩泽伟律师',
          departmentName: '资本市场与并购部',
          teamSize: 3,
          leadMatterCount: 4,
          teamAvgWorkloadIndex: 78,
          contractedCents: 420000000,
          billedCents: 280000000,
          collectedCents: 238000000,
          billedCollectionRatePercent: 85.0,
          conflictPassRatePercent: 95.0,
          avgFilingHours: 2.4
        }
      ],
      units: [
        {
          userName: '韩泽伟律师',
          role: '管理合伙人',
          departmentName: '资本市场与并购部',
          leadMatterCount: 4,
          coMatterCount: 2,
          openTaskCount: 5,
          overdueTaskCount: 0,
          activeHours30d: 112.5,
          workloadIndex: 82,
          workloadBand: 'SATURATED',
          contractedCents: 320000000,
          collectedCents: 210000000,
          collectionRatePercent: 87.5
        },
        {
          userName: '陈静知律师',
          role: '主办律师',
          departmentName: '争议解决部',
          leadMatterCount: 6,
          coMatterCount: 4,
          openTaskCount: 9,
          overdueTaskCount: 2,
          activeHours30d: 138.0,
          workloadIndex: 102,
          workloadBand: 'OVERLOADED',
          contractedCents: 180000000,
          collectedCents: 98000000,
          collectionRatePercent: 72.0
        },
        {
          userName: '周予安律师',
          role: '协办律师',
          departmentName: '资本市场与并购部',
          leadMatterCount: 1,
          coMatterCount: 2,
          openTaskCount: 2,
          overdueTaskCount: 0,
          activeHours30d: 42.0,
          workloadIndex: 32,
          workloadBand: 'IDLE',
          contractedCents: 50000000,
          collectedCents: 40000000,
          collectionRatePercent: 90.0
        }
      ]
    }
  };
}

async function mountPanel(options = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://plugin.invalid/' });
  const calls = [];
  const state = createDemoState();

  const sendToPlugin = (msg) => {
    const event = new dom.window.MessageEvent('message', {
      data: msg,
      source: dom.window.parent
    });
    dom.window.dispatchEvent(event);
  };

  dom.window.parent.postMessage = (msg) => {
    if (!msg || msg.awd !== 1 || msg.type !== 'call') return;
    calls.push(msg);

    queueMicrotask(async () => {
      try {
        let result;
        if (options.onCall) {
          result = await options.onCall(msg, state);
        }
        if (result === undefined) {
          if (msg.method === 'context.get') {
            result = { pluginId: 'lawfirm-management', projectId: 1, language: 'zh-CN', theme: 'light' };
          } else if (msg.method === 'events.subscribe' || msg.method === 'events.unsubscribe') {
            result = { subscribed: msg.params?.events || [] };
          } else if (msg.method === 'lawfirm.request') {
            const { action, params = {} } = msg.params || {};
            switch (action) {
              case 'overview':
              case 'seedDemo':
                result = {
                  self: state.self,
                  intakes: state.intakes,
                  myPendingClearances: state.clearances,
                  clearances: state.clearances,
                  committeeQueue: state.intakes,
                  invoices: state.invoices,
                  collections: state.collections,
                  dashboard: state.dashboard
                };
                break;
              case 'conflictPreview':
                result = {
                  riskLevel: params.practiceArea === 'CRIMINAL' && params.feeMode === 'CONTINGENCY' ? 'RED' : 'YELLOW',
                  primaryRuleCode: 'Y1_EXISTING_CLIENT_OTHER_MATTER',
                  summary: '【YELLOW · Y1_EXISTING_CLIENT_OTHER_MATTER】共命中 1 项利益冲突记录（关联主办：韩泽伟律师）。法规依据：《中华人民共和国律师法》第三十九条、全国律协《律师执业行为规范》第五十一条',
                  hits: [
                    {
                      ruleCode: 'Y1_EXISTING_CLIENT_OTHER_MATTER',
                      riskLevel: 'YELLOW',
                      ruleTitle: '新案对方当事人系本所在办案件委托人',
                      statutoryCitation: '《律师法》第39条 / 《全国律协执业行为规范》第51条',
                      matchedMatterTitle: '华星半导体科创板IPO专项法律服务',
                      matchedPartyName: params.counterpartyName || '华星半导体股份有限公司',
                      handlerUserName: '韩泽伟律师'
                    }
                  ],
                  feeComplianceWarning: params.feeMode === 'CONTINGENCY' && params.practiceArea === 'CRIMINAL'
                    ? '《律师服务收费管理办法》第十一条、第十二条：刑事诉讼案件禁止实行风险代理收费'
                    : null
                };
                break;
              case 'submitIntake': {
                const newIntake = {
                  id: state.intakes.length + 1,
                  intakeNo: `LF-2026-000${state.intakes.length + 1}`,
                  title: params.title,
                  practiceArea: params.practiceArea,
                  departmentName: params.departmentName,
                  leadLawyerName: params.leadLawyerName,
                  clientName: params.clientName,
                  counterpartyName: params.counterpartyName,
                  feeMode: params.feeMode,
                  contractAmountCents: params.contractAmountCents || 60000000,
                  conflictRiskLevel: 'YELLOW',
                  conflictSummary: '【YELLOW · Y1_EXISTING_CLIENT_OTHER_MATTER】已自动向关联案件主办律师发送站内信放行征询。',
                  feeComplianceWarning: params.feeMode === 'CONTINGENCY' && params.practiceArea === 'CRIMINAL'
                    ? '《律师服务收费管理办法》第十一条：刑事诉讼禁止风险代理'
                    : null,
                  status: 'PENDING_LAWYER_CLEARANCE',
                  imConversationId: 'im-conv-new-99'
                };
                state.intakes.unshift(newIntake);
                result = newIntake;
                break;
              }
              case 'respondClearance': {
                const clr = state.clearances.find((c) => c.id === params.clearanceId);
                if (clr) {
                  clr.decision = params.decision;
                  clr.comment = params.comment;
                }
                const targetIntake = state.intakes.find((i) => i.id === clr?.intakeId);
                if (targetIntake && params.decision !== 'REJECTED') {
                  targetIntake.status = 'PENDING_COMMITTEE_REVIEW';
                  targetIntake.ethicalWallApplied = Boolean(params.ethicalWallApplied);
                }
                result = { ok: true, clearance: clr };
                break;
              }
              case 'committeeReview': {
                const intake = state.intakes.find((i) => i.id === params.intakeId);
                if (intake) {
                  intake.status = params.decision === 'APPROVE_AND_FILE' ? 'APPROVED_FILED' : 'REJECTED_CONFLICT';
                  intake.ethicalWallApplied = Boolean(params.ethicalWallApplied);
                  intake.clientWaiverUploaded = Boolean(params.clientWaiverUploaded);
                  intake.committeeComment = params.comment;
                }
                result = { ok: true, intake };
                break;
              }
              case 'submitInvoice': {
                const inv = {
                  id: state.invoices.length + 801,
                  invoiceAppNo: `INV-2026-00${state.invoices.length + 1}`,
                  intakeId: params.intakeId,
                  matterTitle: '华星半导体科创板IPO专项法律服务',
                  departmentName: '资本市场与并购部',
                  invoiceType: params.invoiceType,
                  amountCents: params.amountCents,
                  taxRateBps: params.taxRateBps,
                  taxAmountCents: Math.round((params.amountCents * params.taxRateBps) / (10000 + params.taxRateBps)),
                  buyerName: params.buyerName,
                  buyerTaxId: params.buyerTaxId,
                  status: 'PENDING',
                  collectedAmountCents: 0,
                  externalSyncStatus: 'PENDING'
                };
                state.invoices.unshift(inv);
                result = inv;
                break;
              }
              case 'issueInvoice': {
                const inv = state.invoices.find((i) => i.id === params.invoiceId);
                if (inv) {
                  inv.status = 'ISSUED';
                  inv.invoiceCode = params.invoiceCode;
                  inv.invoiceNumber = params.invoiceNumber;
                }
                result = inv || {};
                break;
              }
              case 'recordCollection': {
                const col = {
                  id: state.collections.length + 901,
                  collectionNo: `COL-2026-00${state.collections.length + 1}`,
                  intakeId: params.intakeId,
                  invoiceId: params.invoiceId,
                  matterTitle: '华星半导体科创板IPO专项法律服务',
                  invoiceAppNo: params.invoiceId ? 'INV-2026-002' : null,
                  payerName: params.payerName,
                  amountCents: params.amountCents,
                  paymentMethod: params.paymentMethod,
                  bankVoucherNo: params.bankVoucherNo,
                  receivedDate: params.receivedDate,
                  reconciliationStatus: 'RECONCILED'
                };
                state.collections.unshift(col);
                if (params.invoiceId) {
                  const inv = state.invoices.find((i) => i.id === params.invoiceId);
                  if (inv) {
                    inv.collectedAmountCents = (inv.collectedAmountCents || 0) + params.amountCents;
                    inv.status = inv.collectedAmountCents >= inv.amountCents ? 'PAID' : 'PARTIALLY_PAID';
                  }
                }
                result = col;
                break;
              }
              case 'syncErp': {
                for (const inv of state.invoices) {
                  inv.externalSyncStatus = 'SYNCED';
                  inv.externalErpRef = 'KD-VOUCHER-20261015';
                }
                result = {
                  syncedInvoiceCount: state.invoices.length,
                  batchRef: 'KD-VOUCHER-20261015',
                  summary: '已同步全部发票与回款核销记录至金蝶/用友标准凭证接口。'
                };
                break;
              }
              default:
                result = {};
            }
          } else {
            result = {};
          }
        }
        sendToPlugin({ awd: 1, type: 'result', seq: msg.seq, ok: true, result });
      } catch (err) {
        sendToPlugin({
          awd: 1,
          type: 'result',
          seq: msg.seq,
          ok: false,
          error: { code: err.code || 'invoke_failed', message: err.message }
        });
      }
    });
  };

  dom.window.eval(sdkSource);
  dom.window.eval(panelSource);

  sendToPlugin({
    awd: 1,
    type: 'init',
    context: {
      pluginId: 'lawfirm-management',
      projectId: 1,
      language: 'zh-CN',
      theme: 'light',
      themeTokens: {
        '--awd-surface': '#ffffff',
        '--awd-accent': '#426d50'
      }
    }
  });
  await tick();

  const $ = (id) => dom.window.document.getElementById(id);
  return { dom, $, calls, state, sendToPlugin };
}

test('1. Handshake init, theme token injection (light & dark), SDK lawfirm helper, and 4-tab navigation', async (t) => {
  const p = await mountPanel();
  t.after(() => p.dom.window.close());

  // Verify zero emojis in HTML/CSS/JS source files
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(html), false, 'index.html must not contain emojis');
  assert.equal(emojiRegex.test(cssSource), false, 'panel.css must not contain emojis');
  assert.equal(emojiRegex.test(panelSource), false, 'panel.js must not contain emojis');

  // Verify light theme tokens applied on init
  assert.equal(p.dom.window.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(p.dom.window.document.documentElement.style.getPropertyValue('--awd-accent'), '#426d50');
  assert.equal(typeof p.dom.window.awd.lawfirm.request, 'function');

  // Push dark theme update and verify CSS variables and classes update
  p.sendToPlugin({
    awd: 1,
    type: 'theme',
    theme: 'dark',
    tokens: { '--awd-surface': '#242a25', '--awd-accent': '#9cbe9d' }
  });
  await tick();
  assert.equal(p.dom.window.document.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(p.dom.window.document.body.classList.contains('awd-theme-dark'), true);
  assert.equal(p.dom.window.document.documentElement.style.getPropertyValue('--awd-accent'), '#9cbe9d');

  // Verify self badge and initial overview rendered
  assert.match(p.$('self-badge').textContent, /韩泽伟律师.*资本市场与并购部/);
  assert.match(p.$('intake-list').textContent, /LF-2026-0001/);
  assert.match(p.$('intake-list').textContent, /LF-2026-0002/);

  // Verify host event lawfirm.navigate switches tabs
  p.sendToPlugin({ awd: 1, type: 'event', event: 'lawfirm.navigate', data: { tab: 'dashboard' } });
  await tick();
  assert.equal(p.$('tab-dashboard').getAttribute('aria-selected'), 'true');
  assert.equal(p.$('panel-dashboard').hidden, false);
  assert.equal(p.$('panel-intake').hidden, true);
});

test('2. Real-time conflict preview and submitting a case intake with statutory warnings and 5-step progress bar', async (t) => {
  const p = await mountPanel();
  t.after(() => p.dom.window.close());

  p.$('intake-title').value = '华星高管职务侵占刑事控告与追偿专项';
  p.$('intake-practice-area').value = 'CRIMINAL';
  p.$('intake-fee-mode').value = 'CONTINGENCY';
  p.$('intake-client-name').value = '蓝海控股集团有限公司';
  p.$('intake-counterparty-name').value = '华星半导体股份有限公司';
  p.$('intake-contract-amount').value = '150';
  p.$('intake-contingency-rate').value = '25';

  p.$('btn-preview-conflict').click();
  await tick();

  const previewText = p.$('conflict-preview-card').textContent;
  assert.equal(p.$('conflict-preview-card').hidden, false);
  assert.match(previewText, /直接利冲 · 禁止代理|潜在利冲 · 需征询放行/);
  assert.match(previewText, /《律师法》第39条/);
  assert.match(previewText, /《律师服务收费管理办法》第十一条/);

  p.$('btn-submit-intake').click();
  await tick();

  const submitCalls = p.calls.filter((c) => c.method === 'lawfirm.request' && c.params.action === 'submitIntake');
  assert.equal(submitCalls.length, 1);
  assert.equal(submitCalls[0].params.params.title, '华星高管职务侵占刑事控告与追偿专项');
  assert.equal(submitCalls[0].params.params.contractAmountCents, 150000000);

  // Verify 5-step progress tracker rendered for the newly submitted intake
  assert.match(p.$('intake-list').textContent, /LF-2026-0003.*华星高管职务侵占刑事控告与追偿专项/);
  const steps = p.$('intake-list').querySelectorAll('.item-card:first-child .step-pill');
  assert.equal(steps.length, 5);
  assert.equal(steps[0].dataset.state, 'done');
  assert.equal(steps[1].dataset.state, 'done');
  assert.equal(steps[2].dataset.state, 'active');
  assert.match(steps[2].textContent, /关联律师站内信放行/);
});

test('3. Responding to a conflict clearance request with ethical wall and Committee final approval', async (t) => {
  const p = await mountPanel();
  t.after(() => p.dom.window.close());

  p.$('tab-conflict').click();
  await tick();
  assert.equal(p.$('panel-conflict').hidden, false);

  // Verify pending clearance shows statutory rule citation and IM conversation ID
  const pendingHtml = p.$('pending-clearances').textContent;
  assert.match(pendingHtml, /LF-2026-0002/);
  assert.match(pendingHtml, /全国律协《律师执业行为规范》第五十一条/);
  assert.match(pendingHtml, /im-conv-conflict-2/);

  // Register a conditional clearance in the legacy local ledger.
  const wallBtn = [...p.$('pending-clearances').querySelectorAll('button')].find((b) =>
    b.textContent.includes('本机登记附条件放行')
  );
  assert.ok(wallBtn, 'Expected ethical wall clearance button');
  wallBtn.click();
  await tick();

  const clearanceCall = p.calls.find((c) => c.method === 'lawfirm.request' && c.params.action === 'respondClearance');
  assert.ok(clearanceCall);
  assert.equal(clearanceCall.params.params.clearanceId, 501);
  assert.equal(clearanceCall.params.params.decision, 'APPROVED_WITH_WALL');
  assert.equal(clearanceCall.params.params.ethicalWallApplied, true);

  // Keep the legacy local project-creation flow available.
  assert.match(p.$('committee-queue').textContent, /待利冲委员终审/);
  const cards = [...p.$('committee-queue').querySelectorAll('.item-card')];
  const targetCard = cards.find((c) => c.textContent.includes('LF-2026-0002'));
  assert.ok(targetCard);
  const approveBtn = [...targetCard.querySelectorAll('button')].find((b) =>
    b.textContent.includes('本机登记通过并建项')
  );
  approveBtn.click();
  await tick();

  const committeeCall = p.calls.find((c) => c.method === 'lawfirm.request' && c.params.action === 'committeeReview');
  assert.ok(committeeCall);
  assert.equal(committeeCall.params.params.intakeId, 2);
  assert.equal(committeeCall.params.params.decision, 'APPROVE_AND_FILE');
  assert.match(p.$('committee-queue').textContent, /正式立案并建项/);
});

test('4. Submitting a digital invoice, issuing it, recording manual fee collection, and syncing ERP', async (t) => {
  const p = await mountPanel();
  t.after(() => p.dom.window.close());

  p.$('tab-finance').click();
  await tick();
  assert.equal(p.$('panel-finance').hidden, false);

  // Submit a new digital invoice
  p.$('invoice-amount-yuan').value = '500000';
  p.$('invoice-buyer-name').value = '华星半导体股份有限公司';
  p.$('invoice-buyer-tax-id').value = '91110108MA001111XX';
  p.$('btn-submit-invoice').click();
  await tick();

  const submitInvCall = p.calls.find((c) => c.method === 'lawfirm.request' && c.params.action === 'submitInvoice');
  assert.ok(submitInvCall);
  assert.equal(submitInvCall.params.params.amountCents, 50000000);
  assert.match(p.$('invoice-list').textContent, /INV-2026-002/);
  assert.match(p.$('invoice-list').textContent, /待开票/);

  // Issue the newly submitted invoice
  const issueBtn = p.$('invoice-list').querySelector('.btn-issue-invoice');
  assert.ok(issueBtn, 'Expected issue invoice button');
  issueBtn.click();
  await tick();

  const issueCall = p.calls.find((c) => c.method === 'lawfirm.request' && c.params.action === 'issueInvoice');
  assert.ok(issueCall);
  assert.equal(issueCall.params.params.invoiceId, 802);

  // Record manual fee collection against the issued invoice
  p.$('collection-invoice-id').value = '802';
  p.$('collection-payer-name').value = '华星半导体股份有限公司';
  p.$('collection-amount-yuan').value = '500000';
  p.$('collection-voucher-no').value = 'BK-20261015-9901';
  p.$('btn-record-collection').click();
  await tick();

  const colCall = p.calls.find((c) => c.method === 'lawfirm.request' && c.params.action === 'recordCollection');
  assert.ok(colCall);
  assert.equal(colCall.params.params.amountCents, 50000000);
  assert.equal(colCall.params.params.bankVoucherNo, 'BK-20261015-9901');
  assert.match(p.$('collection-list').textContent, /BK-20261015-9901/);
  assert.match(p.$('invoice-list').textContent, /已全额回款/);

  // Sync with Kingdee / Yonyou ERP
  p.$('btn-sync-erp').click();
  await tick();
  const erpCall = p.calls.find((c) => c.method === 'lawfirm.request' && c.params.action === 'syncErp');
  assert.ok(erpCall);
  assert.equal(erpCall.params.params.provider, 'KINGDEE_YONYOU_CSV');
  assert.equal(p.$('erp-sync-banner').hidden, false);
  assert.match(p.$('erp-sync-banner').textContent, /KD-VOUCHER-20261015/);
});

test('5. Rendering the Decision-Maker Dashboard (departments, team leads, units workload bands, AR aging, collection rates)', async (t) => {
  const p = await mountPanel();
  t.after(() => p.dom.window.close());

  p.$('tab-dashboard').click();
  await tick();

  const kpiText = p.$('dashboard-kpis').textContent;
  assert.match(kpiText, /8 件 \/ 10 件/);
  assert.match(kpiText, /账单回收率 80\.0%/);
  assert.match(kpiText, /合同回款率 51\.7%/);
  assert.match(kpiText, /<30天.*30-90天.*>90天/);

  const deptText = p.$('dept-table').textContent;
  assert.match(deptText, /资本市场与并购部/);
  assert.match(deptText, /争议解决部/);
  assert.match(deptText, /85\.0% \/ 56\.7%/);

  const leadText = p.$('lead-table').textContent;
  assert.match(leadText, /韩泽伟律师/);
  assert.match(leadText, /95\.0%/);
  assert.match(leadText, /2\.4 小时/);

  const unitText = p.$('unit-table').textContent;
  assert.match(unitText, /韩泽伟律师.*饱和 · 高负荷/);
  assert.match(unitText, /陈静知律师.*超负荷 · 预警分流/);
  assert.match(unitText, /周予安律师.*空闲 · 可优先派案/);
});
