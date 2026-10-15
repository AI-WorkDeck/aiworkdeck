// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const request = (action, params = {}) => awd.call('lawfirm.request', { action, params });

  async function requestWithFallback(primaryAction, fallbackAction, params = {}) {
    try {
      return await request(primaryAction, params);
    } catch (err) {
      if (fallbackAction && typeof err?.message === 'string' && err.message.includes('不支持的律所管理操作')) {
        return await request(fallbackAction, params);
      }
      throw err;
    }
  }

  const PRACTICE_LABELS = {
    COMMERCIAL_LITIGATION: '民商事诉讼与仲裁',
    LITIGATION: '民商事诉讼与仲裁',
    CAPITAL_MARKET: '资本市场与证券',
    IPO_CAPITAL: '资本市场/IPO',
    CORPORATE_MA: '公司并购与投融资',
    IP_TECH: '知识产权与数据合规',
    IP: '知识产权与数据合规',
    CRIMINAL: '刑事辩护与代理',
    ADMINISTRATIVE: '行政复议与诉讼',
    MARRIAGE_FAMILY: '婚姻家事与财富传承',
    RETAINER: '常年法律顾问',
    BANKRUPTCY: '破产重整与清收',
    LABOR: '劳动人事合规'
  };

  const FEE_MODE_LABELS = {
    FIXED: '固定收费',
    PROPORTIONAL: '按标的额比例',
    CONTINGENCY: '风险代理',
    HOURLY: '计时收费',
    RETAINER: '常年顾问'
  };

  const INVOICE_TYPE_LABELS = {
    DIGITAL_SPECIAL: '数电增值税专用发票',
    DIGITAL_NORMAL: '数电普通发票',
    VAT_SPECIAL: '增值税专用发票',
    VAT_NORMAL: '增值税普通发票'
  };

  const PAYMENT_METHOD_LABELS = {
    BANK_TRANSFER: '对公银行转账',
    ESCROW: '提存/监管账户划转',
    CHECK: '银行本票/支票',
    OFFLINE: '其他合规收款'
  };

  const STATUS_LABELS = {
    DRAFT: '草稿',
    CONFLICT_CHECKING: '自动利冲检索中',
    PENDING_LAWYER_CLEARANCE: '待关联律师放行',
    PENDING_COMMITTEE_REVIEW: '待利冲委员终审',
    APPROVED_FILED: '正式立案并建项',
    REJECTED_CONFLICT: '利冲驳回',
    CLOSED: '已结案归档'
  };

  const CLEARANCE_DECISION_LABELS = {
    PENDING: '待放行',
    APPROVED: '已放行',
    APPROVED_WITH_WALL: '附条件放行（信息隔离墙）',
    REJECTED: '已拒绝放行'
  };

  const WORKLOAD_BAND_META = {
    IDLE: { label: '空闲 · 可优先派案', cls: 'badge-green' },
    OPTIMAL: { label: '适中 · 良性饱和', cls: 'badge-green' },
    SATURATED: { label: '饱和 · 高负荷', cls: 'badge-yellow' },
    OVERLOADED: { label: '超负荷 · 预警分流', cls: 'badge-red' }
  };

  const state = {
    epoch: 0,
    activeTab: 'intake',
    context: null,
    self: null,
    intakes: [],
    pendingClearances: [],
    allClearances: [],
    committeeQueue: [],
    invoices: [],
    collections: [],
    dashboard: {}
  };

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }

  function notice(text = '', isError = false) {
    const el = $('notice');
    if (!el) return;
    el.textContent = text;
    el.dataset.error = String(Boolean(isError));
  }

  function failureMessage(error) {
    if (error?.code === 'permission_denied') return '当前账号或插件缺少律所管理权限（lawfirm）。';
    if (error?.code === 'unknown_method') return '当前客户端版本不支持律所管理桥接，请升级至 0.61.0 或更新版本。';
    if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim().slice(0, 500);
    return '操作未完成，请稍后重试。';
  }

  async function runAction(btn, fn) {
    const epoch = state.epoch;
    if (btn) btn.disabled = true;
    try {
      await fn(epoch);
    } catch (err) {
      if (epoch === state.epoch) notice(failureMessage(err), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function formatYuanFromCents(cents) {
    const num = Number(cents || 0) / 100;
    return '¥' + num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatWanFromCents(cents) {
    const num = Number(cents || 0) / 1000000;
    return num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 万元';
  }

  function formatPercent(val) {
    if (val === undefined || val === null || Number.isNaN(Number(val))) return '0.0%';
    return Number(val).toFixed(1) + '%';
  }

  function riskBadge(level) {
    const norm = String(level || 'GREEN').toUpperCase();
    if (norm === 'RED') return node('span', '直接利冲 · 禁止代理', 'badge badge-red');
    if (norm === 'YELLOW') return node('span', '潜在利冲 · 需征询放行', 'badge badge-yellow');
    return node('span', '无利冲 · 审查通过', 'badge badge-green');
  }

  function workloadBadge(band, indexVal) {
    const idx = Number(indexVal || 0);
    let key = String(band || '').toUpperCase();
    if (!WORKLOAD_BAND_META[key]) {
      if (idx > 95) key = 'OVERLOADED';
      else if (idx >= 76) key = 'SATURATED';
      else if (idx >= 40) key = 'OPTIMAL';
      else key = 'IDLE';
    }
    const meta = WORKLOAD_BAND_META[key];
    return node('span', `${idx} · ${meta.label}`, `badge ${meta.cls}`);
  }

  const TAB_ALIASES = {
    intake: 'intake',
    matters: 'intake',
    cases: 'intake',
    case_intake: 'intake',
    conflict: 'conflict',
    conflicts: 'conflict',
    clearance: 'conflict',
    clearances: 'conflict',
    oa: 'conflict',
    im: 'conflict',
    finance: 'finance',
    billing: 'finance',
    invoices: 'finance',
    collections: 'finance',
    dashboard: 'dashboard',
    analytics: 'dashboard',
    kpi: 'dashboard',
    team: 'dashboard'
  };

  function switchTab(tabId) {
    const raw = String(tabId || '').replace(/^tab-/, '').replace(/^panel-/, '').trim().toLowerCase();
    const normalized = TAB_ALIASES[raw] || raw;
    const valid = ['intake', 'conflict', 'finance', 'dashboard'];
    const target = valid.includes(normalized) ? normalized : 'intake';
    state.activeTab = target;
    for (const key of valid) {
      const btn = $(`tab-${key}`);
      const panel = $(`panel-${key}`);
      if (btn) btn.setAttribute('aria-selected', String(key === target));
      if (panel) panel.hidden = key !== target;
    }
  }

  function parseJsonList(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  function buildProgressSteps(intake) {
    if (Array.isArray(intake.progressSteps) && intake.progressSteps.length > 0) {
      return intake.progressSteps.map((st, idx) => {
        const rawState = String(st.state || st.status || 'pending').toLowerCase();
        const mappedState = rawState === 'error' ? 'rejected' : rawState;
        return {
          step: st.step || idx + 1,
          label: st.label || st.title || `步骤 ${idx + 1}`,
          state: mappedState
        };
      });
    }
    const status = String(intake.status || 'PENDING_LAWYER_CLEARANCE').toUpperCase();
    const labels = [
      '1. 提交收案申请',
      '2. 自动利冲检索',
      '3. 关联律师站内信放行',
      '4. 利冲委员终审',
      '5. 正式立案并建项'
    ];
    return labels.map((label, idx) => {
      let stepState = 'pending';
      if (status === 'APPROVED_FILED' || status === 'CLOSED') {
        stepState = 'done';
      } else if (status === 'REJECTED_CONFLICT') {
        if (idx < 2) stepState = 'done';
        else if (idx === 2 || idx === 3) stepState = 'rejected';
      } else if (status === 'PENDING_COMMITTEE_REVIEW') {
        if (idx < 3) stepState = 'done';
        else if (idx === 3) stepState = 'active';
      } else if (status === 'PENDING_LAWYER_CLEARANCE') {
        if (idx < 2) stepState = 'done';
        else if (idx === 2) stepState = 'active';
      } else {
        if (idx === 0) stepState = 'done';
        else if (idx === 1) stepState = 'active';
      }
      return { step: idx + 1, label, state: stepState };
    });
  }

  function normalizeOverview(data = {}) {
    state.self = data.self || data.currentUser || {
      id: data.currentUserId || 1,
      displayName: data.currentUserName || '当前律师',
      departmentName: data.currentDepartment || '争议解决部',
      role: '主办律师 / 利冲委员'
    };

    const intakes = data.intakes || data.allIntakes || data.myIntakes || data.matters || [];
    state.intakes = Array.isArray(intakes) ? intakes : [];

    const allClearances = data.clearances || data.allClearances || [];
    state.allClearances = Array.isArray(allClearances) ? allClearances : [];

    const pendingClearances = data.myPendingClearances || data.myClearances || data.pendingClearances || state.allClearances;
    state.pendingClearances = Array.isArray(pendingClearances) ? pendingClearances : [];

    const committeeQueue = data.committeeQueue || data.allIntakes || state.intakes;
    state.committeeQueue = Array.isArray(committeeQueue) ? committeeQueue : [];

    const invoices = data.invoices || data.finance?.invoices || [];
    state.invoices = Array.isArray(invoices) ? invoices : [];

    const collections = data.collections || data.finance?.collections || [];
    state.collections = Array.isArray(collections) ? collections : [];

    state.dashboard = data.dashboard || data.analytics || data;
  }

  function renderHeader() {
    const self = state.self || {};
    const name = self.displayName || self.name || '当前律师';
    const dept = self.departmentName || self.department || '律所业务部';
    const role = self.role || self.title || '执业律师';
    $('self-badge').textContent = `${name} · ${dept} · ${role}`;

    const leadInput = $('intake-lead-lawyer');
    if (leadInput && !leadInput.value) leadInput.value = name;
    const deptInput = $('intake-department');
    if (deptInput && !deptInput.value) deptInput.value = dept;

    $('badge-intake-count').textContent = String(state.intakes.length);
    const pendingCount = state.pendingClearances.filter((c) => (c.decision || 'PENDING') === 'PENDING').length;
    const reviewCount = state.committeeQueue.filter((i) => ['PENDING_LAWYER_CLEARANCE', 'PENDING_COMMITTEE_REVIEW'].includes(i.status)).length;
    $('badge-conflict-count').textContent = String(pendingCount + reviewCount);
    $('badge-finance-count').textContent = String(state.invoices.length);
  }

  function renderConflictPreview(result) {
    const box = $('conflict-preview-card');
    box.replaceChildren();
    if (!result) {
      box.hidden = true;
      return;
    }
    box.hidden = false;

    const head = node('div', null, 'item-head');
    const title = node('strong', '实时利益冲突与收费合规审查结论');
    head.append(title, riskBadge(result.riskLevel || result.conflictRiskLevel));
    box.append(head);

    const summaryText = result.summary || result.conflictSummary || '已完成全所利益冲突扫描。';
    box.append(node('p', summaryText));

    const hits = result.hits || result.conflictHits || parseJsonList(result.conflictHitsJson);
    if (hits.length > 0) {
      const ul = node('ul', null, 'hit-list');
      for (const hit of hits) {
        const li = node('li');
        const ruleCode = hit.ruleCode ? `[${hit.ruleCode}] ` : '';
        const ruleTitle = hit.ruleTitle || '命中冲突规则';
        const matchedMatter = hit.matchedMatterTitle ? ` · 关联案件：${hit.matchedMatterTitle}` : '';
        const matchedParty = hit.matchedPartyName ? ` · 冲突主体：${hit.matchedPartyName}` : '';
        const handler = hit.handlerUserName ? ` · 承办人：${hit.handlerUserName}` : '';
        const citation = hit.statutoryCitation || hit.conflictRuleCitation || '';
        li.textContent = `${ruleCode}${ruleTitle}${matchedMatter}${matchedParty}${handler}${citation ? ' — 依据：' + citation : ''}`;
        ul.append(li);
      }
      box.append(ul);
    }

    if (result.feeComplianceWarning) {
      box.append(node('div', `收费合规预警：${result.feeComplianceWarning}`, 'compliance-warning'));
    }
  }

  function renderIntakeList() {
    const container = $('intake-list');
    container.replaceChildren();

    if (state.intakes.length === 0) {
      container.append(node('p', '暂无收案立项记录。可在左侧填写新案信息并预检利冲，或点击顶部「加载典型律所样板数据」。', 'hint'));
      return;
    }

    for (const item of state.intakes) {
      const card = node('div', null, 'item-card');
      const head = node('div', null, 'item-head');
      const left = node('div');
      left.append(
        node('strong', `${item.intakeNo || 'LF-NEW'} · ${item.title || '未命名案件'}`),
        node('span', ` （${STATUS_LABELS[item.status] || item.statusLabel || item.status || '审查中'}）`, 'hint')
      );
      head.append(left, riskBadge(item.conflictRiskLevel));
      card.append(head);

      const meta = node('div', null, 'item-meta');
      meta.append(
        node('span', `业务领域：${PRACTICE_LABELS[item.practiceArea] || item.practiceAreaLabel || item.practiceArea || '综合业务'}`),
        node('span', `部门：${item.departmentName || '未分配'}`),
        node('span', `主办：${item.leadLawyerName || item.applicantName || '未指定'}`),
        node('span', `委托人：${item.clientName || '-'}`),
        node('span', `对方当事人：${item.counterpartyName || '无'}`),
        node('span', `收费：${FEE_MODE_LABELS[item.feeMode] || item.feeModeLabel || item.feeMode || '固定收费'} · ${formatWanFromCents(item.contractAmountCents)}`)
      );
      card.append(meta);

      if (item.conflictSummary) {
        card.append(node('p', item.conflictSummary, 'hint'));
      }

      if (item.feeComplianceWarning) {
        card.append(node('div', `收费合规提示：${item.feeComplianceWarning}`, 'compliance-warning'));
      }

      if (item.imConversationId) {
        card.append(node('p', `联动站内信会话 ID：${item.imConversationId}（已同步发送利冲征询通知）`, 'hint'));
      }

      const stepsWrap = node('div', null, 'progress-steps');
      for (const st of buildProgressSteps(item)) {
        const pill = node('div', st.label, 'step-pill');
        pill.dataset.state = st.state || 'pending';
        stepsWrap.append(pill);
      }
      card.append(stepsWrap);

      container.append(card);
    }
  }

  function renderConflictTab() {
    const clearanceContainer = $('pending-clearances');
    clearanceContainer.replaceChildren();

    if (state.pendingClearances.length === 0) {
      clearanceContainer.append(node('p', '当前没有待处理的利益冲突放行征询单。', 'hint'));
    } else {
      for (const clr of state.pendingClearances) {
        const card = node('div', null, 'item-card');
        const head = node('div', null, 'item-head');
        head.append(
          node('strong', `征询单 #${clr.id} · 申请案号 ${clr.intakeNo || '-'}`),
          node('span', CLEARANCE_DECISION_LABELS[clr.decision] || clr.decision || '待放行',
            clr.decision === 'REJECTED' ? 'badge badge-red' : (clr.decision && clr.decision !== 'PENDING' ? 'badge badge-green' : 'badge badge-yellow'))
        );
        card.append(head);

        const meta = node('div', null, 'item-meta');
        meta.append(
          node('span', `命中在办/历史案件：${clr.matchedMatterTitle || '-'}`),
          node('span', `冲突关联主体：${clr.matchedPartyName || '-'}`),
          node('span', `被征询承办律师：${clr.targetUserName || '-'}`)
        );
        card.append(meta);

        if (clr.conflictRuleCitation) {
          card.append(node('p', `法规依据：${clr.conflictRuleCitation}`, 'hint'));
        }
        if (clr.imConversationId) {
          card.append(node('p', `站内信会话已建立：${clr.imConversationId}`, 'hint'));
        }
        if (clr.comment) {
          card.append(node('p', `放行备注：${clr.comment}`));
        }

        const commentInput = node('input', null, 'clearance-comment-input');
        commentInput.type = 'text';
        commentInput.placeholder = '填写放行/保密隔离意见（选填，将同步回写站内信会话）';
        commentInput.value = clr.comment || '';
        card.append(commentInput);

        const actions = node('div', null, 'action-row');
        const makeDecisionBtn = (label, decision, wall, cls) => {
          const btn = node('button', label, cls);
          btn.type = 'button';
          btn.addEventListener('click', () => runAction(btn, async (epoch) => {
            await request('respondClearance', {
              clearanceId: clr.id,
              decision,
              ethicalWallApplied: wall,
              comment: commentInput.value.trim() || (wall ? '同意放行，已启用跨团队信息隔离墙' : label)
            });
            if (epoch !== state.epoch) return;
            await loadOverview(epoch);
            notice(`已提交利冲征询结论：${label}`);
          }));
          return btn;
        };

        actions.append(
          makeDecisionBtn('同意放行', 'APPROVED', false, ''),
          makeDecisionBtn('附条件放行（启用信息隔离墙）', 'APPROVED_WITH_WALL', true, 'primary'),
          makeDecisionBtn('拒绝放行', 'REJECTED', false, 'danger')
        );
        card.append(actions);
        clearanceContainer.append(card);
      }
    }

    const queueContainer = $('committee-queue');
    queueContainer.replaceChildren();

    if (state.committeeQueue.length === 0) {
      queueContainer.append(node('p', '全所利冲审查队列为空。', 'hint'));
      return;
    }

    for (const intake of state.committeeQueue) {
      const card = node('div', null, 'item-card');
      const head = node('div', null, 'item-head');
      head.append(
        node('strong', `${intake.intakeNo || 'LF-MATTER'} · ${intake.title || ''}`),
        riskBadge(intake.conflictRiskLevel)
      );
      card.append(head);

      const meta = node('div', null, 'item-meta');
      meta.append(
        node('span', `状态：${STATUS_LABELS[intake.status] || intake.statusLabel || intake.status}`),
        node('span', `委托人：${intake.clientName || '-'}`),
        node('span', `对方当事人：${intake.counterpartyName || '-'}`),
        node('span', `主办：${intake.leadLawyerName || '-'}`)
      );
      card.append(meta);

      if (intake.conflictSummary) {
        card.append(node('p', intake.conflictSummary, 'hint'));
      }

      const relatedClearances = intake.clearances || state.allClearances.filter((c) => String(c.intakeId) === String(intake.id));
      if (relatedClearances.length > 0) {
        const ul = node('ul', null, 'hit-list');
        for (const rc of relatedClearances) {
          ul.append(node('li', `关联律师 [${rc.targetUserName || '承办律师'}]（关联案：${rc.matchedMatterTitle || '-'}）→ ${CLEARANCE_DECISION_LABELS[rc.decision] || rc.decision}`));
        }
        card.append(ul);
      }

      const checkRow = node('div', null, 'checkbox-row');
      const wallLabel = node('label');
      const wallCheck = node('input', null, 'committee-wall-checkbox');
      wallCheck.type = 'checkbox';
      wallCheck.checked = Boolean(intake.ethicalWallApplied || intake.conflictRiskLevel === 'YELLOW');
      wallLabel.append(wallCheck, node('span', '启用信息隔离墙承诺（Ethical Wall）'));

      const waiverLabel = node('label');
      const waiverCheck = node('input', null, 'committee-waiver-checkbox');
      waiverCheck.type = 'checkbox';
      waiverCheck.checked = Boolean(intake.clientWaiverUploaded || intake.conflictRiskLevel !== 'GREEN');
      waiverLabel.append(waiverCheck, node('span', '已核验当事人书面豁免函'));

      checkRow.append(wallLabel, waiverLabel);
      card.append(checkRow);

      const commentInput = node('input', null, 'committee-comment-input');
      commentInput.type = 'text';
      commentInput.placeholder = '利冲委员会终审意见（选填）';
      commentInput.value = intake.committeeComment || '';
      card.append(commentInput);

      const actions = node('div', null, 'action-row');
      const approveBtn = node('button', '终审通过并正式立案', 'primary');
      approveBtn.type = 'button';
      approveBtn.addEventListener('click', () => runAction(approveBtn, async (epoch) => {
        await request('committeeReview', {
          intakeId: intake.id,
          decision: 'APPROVE_AND_FILE',
          ethicalWallApplied: wallCheck.checked,
          clientWaiverUploaded: waiverCheck.checked,
          comment: commentInput.value.trim() || '利冲委员会终审通过，准予正式立案'
        });
        if (epoch !== state.epoch) return;
        await loadOverview(epoch);
        notice(`案件「${intake.title}」已终审通过并完成正式立案。`);
      }));

      const rejectBtn = node('button', '驳回立项', 'danger');
      rejectBtn.type = 'button';
      rejectBtn.addEventListener('click', () => runAction(rejectBtn, async (epoch) => {
        await request('committeeReview', {
          intakeId: intake.id,
          decision: 'REJECT',
          ethicalWallApplied: wallCheck.checked,
          clientWaiverUploaded: waiverCheck.checked,
          comment: commentInput.value.trim() || '存在不可豁免利益冲突，予以驳回'
        });
        if (epoch !== state.epoch) return;
        await loadOverview(epoch);
        notice(`已驳回案件「${intake.title}」的立项申请。`);
      }));

      actions.append(approveBtn, rejectBtn);
      card.append(actions);
      queueContainer.append(card);
    }
  }

  function renderFinanceTab() {
    const invoiceIntakeSelect = $('invoice-intake-id');
    const collectionIntakeSelect = $('collection-intake-id');
    const collectionInvoiceSelect = $('collection-invoice-id');

    const prevInvoiceIntake = invoiceIntakeSelect.value;
    const prevCollectionIntake = collectionIntakeSelect.value;
    const prevCollectionInvoice = collectionInvoiceSelect.value;

    invoiceIntakeSelect.replaceChildren();
    collectionIntakeSelect.replaceChildren();
    for (const item of state.intakes) {
      const opt1 = node('option', `${item.intakeNo || item.id} · ${item.title}（${item.clientName || '-'}）`);
      opt1.value = String(item.id);
      invoiceIntakeSelect.append(opt1);

      const opt2 = node('option', `${item.intakeNo || item.id} · ${item.title}（${item.clientName || '-'}）`);
      opt2.value = String(item.id);
      collectionIntakeSelect.append(opt2);
    }
    if (prevInvoiceIntake) invoiceIntakeSelect.value = prevInvoiceIntake;
    if (prevCollectionIntake) collectionIntakeSelect.value = prevCollectionIntake;

    const firstIntake = state.intakes.find((i) => String(i.id) === String(invoiceIntakeSelect.value)) || state.intakes[0];
    if (firstIntake) {
      if (!$('invoice-buyer-name').value) $('invoice-buyer-name').value = firstIntake.clientName || '';
      if (!$('invoice-buyer-tax-id').value) $('invoice-buyer-tax-id').value = firstIntake.clientCreditCode || '';
      if (!$('collection-payer-name').value) $('collection-payer-name').value = firstIntake.clientName || '';
    }

    collectionInvoiceSelect.replaceChildren();
    const blankOpt = node('option', '不绑定特定发票（先款后票 / 预收款）');
    blankOpt.value = '';
    collectionInvoiceSelect.append(blankOpt);
    for (const inv of state.invoices) {
      const opt = node('option', `${inv.invoiceAppNo || inv.invoiceNumber || inv.id} · ${inv.matterTitle || inv.buyerName}（${formatYuanFromCents(inv.amountCents)}）`);
      opt.value = String(inv.id);
      collectionInvoiceSelect.append(opt);
    }
    if (prevCollectionInvoice) collectionInvoiceSelect.value = prevCollectionInvoice;

    const invTbody = $('invoice-list');
    invTbody.replaceChildren();
    if (state.invoices.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无发票记录。', 'hint');
      td.colSpan = 9;
      tr.append(td);
      invTbody.append(tr);
    } else {
      for (const inv of state.invoices) {
        const tr = node('tr');
        const noText = inv.invoiceNumber ? `${inv.invoiceAppNo || ''} / ${inv.invoiceNumber}` : (inv.invoiceAppNo || `INV-${inv.id}`);
        tr.append(
          node('td', noText),
          node('td', `${inv.matterTitle || '-'}（${inv.departmentName || '-'}）`),
          node('td', INVOICE_TYPE_LABELS[inv.invoiceType] || inv.invoiceType || '数电专票'),
          node('td', `${inv.buyerName || '-'} ${inv.buyerTaxId ? '· ' + inv.buyerTaxId : ''}`),
          node('td', `${formatYuanFromCents(inv.amountCents)}（税额 ${formatYuanFromCents(inv.taxAmountCents)}）`),
          node('td', formatYuanFromCents(inv.collectedAmountCents))
        );

        const statusTd = node('td');
        const statusMap = {
          PENDING: ['待开票', 'badge-yellow'],
          PENDING_APPROVAL: ['待开票', 'badge-yellow'],
          ISSUED: ['已开票 · 待回款', 'badge-neutral'],
          PARTIALLY_PAID: ['已开票 · 部分回款', 'badge-yellow'],
          PAID: ['已全额回款', 'badge-green'],
          VOIDED: ['已作废', 'badge-red'],
          RED_INVOICED: ['已红冲', 'badge-red']
        };
        const [stLabel, stCls] = statusMap[inv.status] || [inv.status || '待开票', 'badge-neutral'];
        statusTd.append(node('span', stLabel, `badge ${stCls}`));
        tr.append(statusTd);

        tr.append(node('td', inv.externalErpRef ? `已同步 (${inv.externalErpRef})` : (inv.externalSyncStatus || '待同步')));

        const actionTd = node('td');
        const needsIssue = inv.status === 'PENDING' || inv.status === 'PENDING_APPROVAL' || (!inv.invoiceNumber && inv.status !== 'PAID' && inv.status !== 'VOIDED');
        if (needsIssue) {
          const issueBtn = node('button', '确认开票', 'btn-issue-invoice');
          issueBtn.type = 'button';
          issueBtn.addEventListener('click', () => runAction(issueBtn, async (epoch) => {
            await request('issueInvoice', {
              invoiceId: inv.id,
              invoiceCode: '011002600111',
              invoiceNumber: `SD-${String(inv.id).padStart(6, '0')}`
            });
            if (epoch !== state.epoch) return;
            await loadOverview(epoch);
            notice(`已确认开具数电发票：${inv.invoiceAppNo || inv.id}`);
          }));
          actionTd.append(issueBtn);
        } else {
          actionTd.append(node('span', '已开具', 'hint'));
        }
        tr.append(actionTd);
        invTbody.append(tr);
      }
    }

    const colTbody = $('collection-list');
    colTbody.replaceChildren();
    if (state.collections.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无收费到账流水记录。', 'hint');
      td.colSpan = 9;
      tr.append(td);
      colTbody.append(tr);
    } else {
      for (const col of state.collections) {
        const tr = node('tr');
        tr.append(
          node('td', col.collectionNo || `COL-${col.id}`),
          node('td', col.matterTitle || col.intakeNo || '-'),
          node('td', col.invoiceAppNo || (col.invoiceId ? `#${col.invoiceId}` : '未绑定发票')),
          node('td', col.payerName || '-'),
          node('td', formatYuanFromCents(col.amountCents)),
          node('td', PAYMENT_METHOD_LABELS[col.paymentMethod] || col.paymentMethod || '对公转账'),
          node('td', col.bankVoucherNo || '-'),
          node('td', col.receivedDate || '-'),
          node('td', col.reconciliationStatus === 'RECONCILED' || col.reconciliationStatus === 'EXTERNAL_SYNCED' ? '已核销' : (col.reconciliationStatus || '已入账'))
        );
        colTbody.append(tr);
      }
    }
  }

  function renderDashboardTab() {
    const d = state.dashboard || {};
    const kpis = d.kpi || d.kpis || d.firmSummary || d.summary || d;
    const aging = d.arAging || kpis.arAging || {};

    const kpiContainer = $('dashboard-kpis');
    kpiContainer.replaceChildren();

    const makeKpi = (label, value, sub) => {
      const card = node('div', null, 'kpi-card');
      card.append(
        node('div', label, 'kpi-label'),
        node('strong', value, 'kpi-value'),
        node('div', sub, 'kpi-sub')
      );
      return card;
    };

    const activeMatters = kpis.activeMatterCount ?? kpis.activeCases ?? kpis.activeMatters ?? state.intakes.filter((i) => i.status === 'APPROVED_FILED').length;
    const totalIntakes = kpis.totalIntakeCount ?? kpis.totalCases ?? state.intakes.length;
    const unitCount = kpis.activeUnitCount ?? kpis.activeUnits ?? kpis.unitCount ?? (d.units ? d.units.length : 0);
    const avgWi = kpis.avgWorkloadIndex ?? kpis.averageWorkloadIndex ?? 68;
    const totalContracted = kpis.totalContractedCents ?? kpis.contractedCents ?? 0;
    const totalBilled = kpis.totalBilledCents ?? kpis.billedCents ?? 0;
    const totalCollected = kpis.totalCollectedCents ?? kpis.collectedCents ?? 0;
    const totalAr = kpis.totalOutstandingCents ?? kpis.totalArCents ?? kpis.outstandingArCents ?? Math.max(0, totalBilled - totalCollected);
    const billingRate = kpis.billingRatePercent ?? (totalContracted > 0 ? (totalBilled * 100) / totalContracted : 0);
    const billedColRate = kpis.billedCollectionRatePercent ?? kpis.collectionRatePercent ?? (totalBilled > 0 ? (totalCollected * 100) / totalBilled : 0);
    const contractColRate = kpis.contractCollectionRatePercent ?? (totalContracted > 0 ? (totalCollected * 100) / totalContracted : 0);

    const bucket0To30 = aging.under30DaysCents ?? aging.within30DaysCents ?? aging.bucket0To30Cents ?? 0;
    const bucket30To90 = aging.days30To90Cents ?? aging.bucket30To90Cents ?? 0;
    const bucketOver90 = aging.over90DaysCents ?? aging.bucketOver90Cents ?? 0;

    kpiContainer.append(
      makeKpi('在办正式案件 / 累计收案', `${activeMatters} 件 / ${totalIntakes} 件`, '工作台与立项中心全所实时汇总'),
      makeKpi('活跃律师单元（Unit）与平均负荷', `${unitCount} 名 · 负荷 ${avgWi}`, '综合主办、协办、待办与近30日工时'),
      makeKpi('全所签约合同总额', formatYuanFromCents(totalContracted), `折合 ${formatWanFromCents(totalContracted)}`),
      makeKpi('已开票总额与开票率', formatYuanFromCents(totalBilled), `全所开票率 ${formatPercent(billingRate)}`),
      makeKpi('已到账实收与回收率', formatYuanFromCents(totalCollected), `账单回收率 ${formatPercent(billedColRate)} · 合同回款率 ${formatPercent(contractColRate)}`),
      makeKpi('待收账款（AR）与账龄结构', formatYuanFromCents(totalAr), `<30天 ${formatYuanFromCents(bucket0To30)} | 30-90天 ${formatYuanFromCents(bucket30To90)} | >90天 ${formatYuanFromCents(bucketOver90)}`)
    );

    // 1. 业务部门表
    const deptTbody = $('dept-table');
    deptTbody.replaceChildren();
    const departments = d.departments || [];
    if (departments.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无部门统计数据。', 'hint');
      td.colSpan = 10;
      tr.append(td);
      deptTbody.append(tr);
    } else {
      for (const dept of departments) {
        const tr = node('tr');
        const wi = Number(dept.avgWorkloadIndex ?? dept.workloadIndex ?? 0);
        const contracted = dept.contractedCents ?? dept.totalContractedCents ?? 0;
        const billed = dept.billedCents ?? dept.totalBilledCents ?? 0;
        const collected = dept.collectedCents ?? dept.totalCollectedCents ?? 0;
        const ar = dept.outstandingArCents ?? dept.arCents ?? dept.totalOutstandingCents ?? Math.max(0, billed - collected);
        const bColRate = dept.billedCollectionRatePercent ?? dept.collectionRatePercent ?? (billed > 0 ? (collected * 100) / billed : 0);
        const cColRate = dept.contractCollectionRatePercent ?? (contracted > 0 ? (collected * 100) / contracted : 0);

        const wiTd = node('td');
        wiTd.append(workloadBadge(dept.workloadBand || dept.workloadStatus, wi));

        tr.append(
          node('td', dept.departmentName || dept.name || '-'),
          node('td', dept.headLawyerName || dept.leadName || '部门合伙人'),
          node('td', `${dept.unitCount ?? dept.lawyerCount ?? 0} 人`),
          node('td', `${dept.activeMatterCount ?? dept.activeCaseCount ?? dept.caseCount ?? dept.matterCount ?? 0} 件`),
          wiTd,
          node('td', formatYuanFromCents(contracted)),
          node('td', formatYuanFromCents(billed)),
          node('td', formatYuanFromCents(collected)),
          node('td', `${formatPercent(bColRate)} / ${formatPercent(cColRate)}`),
          node('td', formatYuanFromCents(ar))
        );
        deptTbody.append(tr);
      }
    }

    // 2. 团队负责人（合伙人）表
    const leadTbody = $('lead-table');
    leadTbody.replaceChildren();
    const leads = d.teamLeads || [];
    if (leads.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无团队负责人画像数据。', 'hint');
      td.colSpan = 11;
      tr.append(td);
      leadTbody.append(tr);
    } else {
      for (const lead of leads) {
        const tr = node('tr');
        const contracted = lead.contractedCents ?? lead.totalContractedCents ?? 0;
        const billed = lead.billedCents ?? lead.totalBilledCents ?? 0;
        const collected = lead.collectedCents ?? lead.totalCollectedCents ?? 0;
        const colRate = lead.billedCollectionRatePercent ?? lead.collectionRatePercent ?? (billed > 0 ? (collected * 100) / billed : 0);
        const passRate = lead.conflictPassRatePercent ?? lead.firstPassConflictRatePercent ?? lead.firstPassRatePercent ?? 100;
        const cycleHours = lead.avgFilingHours ?? lead.avgCycleHours ?? 3.5;

        tr.append(
          node('td', lead.leadLawyerName || lead.leadName || lead.name || '-'),
          node('td', lead.departmentName || lead.department || '-'),
          node('td', `${lead.teamSize ?? lead.unitCount ?? 1} 人`),
          node('td', `${lead.leadMatterCount ?? lead.leadCaseCount ?? lead.caseCount ?? lead.activeMatterCount ?? 0} 件`),
          node('td', `负荷 ${lead.teamAvgWorkloadIndex ?? lead.avgWorkloadIndex ?? 65}`),
          node('td', formatYuanFromCents(contracted)),
          node('td', formatYuanFromCents(billed)),
          node('td', formatYuanFromCents(collected)),
          node('td', formatPercent(colRate)),
          node('td', formatPercent(passRate)),
          node('td', `${Number(cycleHours).toFixed(1)} 小时`)
        );
        leadTbody.append(tr);
      }
    }

    // 3. 桌面端个体（Unit）表
    const unitTbody = $('unit-table');
    unitTbody.replaceChildren();
    const units = d.units || [];
    if (units.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无桌面端律师单元（Unit）负荷数据。', 'hint');
      td.colSpan = 10;
      tr.append(td);
      unitTbody.append(tr);
    } else {
      for (const u of units) {
        const tr = node('tr');
        const wi = Number(u.workloadIndex ?? 0);
        const contracted = u.contractedCents ?? u.personalContractedCents ?? 0;
        const collected = u.collectedCents ?? u.personalCollectedCents ?? 0;
        const billed = u.billedCents ?? contracted;
        const colRate = u.collectionRatePercent ?? u.billedCollectionRatePercent ?? (billed > 0 ? (collected * 100) / billed : 0);

        const wiTd = node('td');
        wiTd.append(workloadBadge(u.workloadBand || u.workloadStatus, wi));

        tr.append(
          node('td', u.userName || u.lawyerName || u.displayName || u.name || '-'),
          node('td', u.role || u.title || '主办律师'),
          node('td', u.departmentName || u.department || '-'),
          node('td', `${u.leadMatterCount ?? u.leadCaseCount ?? u.leadMatters ?? 0} 件`),
          node('td', `${u.coMatterCount ?? u.coCaseCount ?? u.coMatters ?? 0} 件`),
          node('td', `待办 ${u.openTaskCount ?? 0} / 逾期 ${u.overdueTaskCount ?? 0}`),
          node('td', `${Number(u.activeHours30d ?? u.activeHours ?? 0).toFixed(1)} 小时`),
          wiTd,
          node('td', `${formatYuanFromCents(contracted)} / ${formatYuanFromCents(collected)}`),
          node('td', formatPercent(colRate))
        );
        unitTbody.append(tr);
      }
    }
  }

  function renderAll() {
    renderHeader();
    renderIntakeList();
    renderConflictTab();
    renderFinanceTab();
    renderDashboardTab();
  }

  function collectIntakePayload() {
    const title = $('intake-title').value.trim();
    const practiceArea = $('intake-practice-area').value;
    const departmentName = $('intake-department').value.trim() || '争议解决部';
    const leadLawyerName = $('intake-lead-lawyer').value.trim() || (state.self?.displayName || '主办律师');
    const feeMode = $('intake-fee-mode').value;
    const clientName = $('intake-client-name').value.trim();
    const clientCreditCode = $('intake-client-code').value.trim();
    const counterpartyName = $('intake-counterparty-name').value.trim();
    const counterpartyCreditCode = $('intake-counterparty-code').value.trim();
    const relatedPartyName = $('intake-related-name').value.trim();
    const relatedPartyRole = $('intake-related-role').value;
    const contractAmountWan = Number($('intake-contract-amount').value || 0);
    const contractAmountCents = Math.round(contractAmountWan * 10000 * 100);
    const contingencyRatePercent = Number($('intake-contingency-rate').value || 0);
    const contingencyRateBps = Math.round(contingencyRatePercent * 100);

    const relatedParties = relatedPartyName
      ? [{ role: relatedPartyRole, name: relatedPartyName, creditCode: '' }]
      : [];

    return {
      title,
      practiceArea,
      departmentName,
      leadLawyerName,
      feeMode,
      clientName,
      clientCreditCode,
      counterpartyName,
      counterpartyCreditCode,
      relatedPartyName,
      relatedPartyRole,
      relatedParties,
      relatedPartiesJson: JSON.stringify(relatedParties),
      contractAmountWan,
      contractAmountYuan: contractAmountWan * 10000,
      contractAmountCents,
      contingencyRatePercent,
      contingencyRateBps
    };
  }

  async function loadOverview(epoch = state.epoch) {
    const data = await request('overview', {});
    if (epoch !== state.epoch) return;
    normalizeOverview(data || {});
    renderAll();
  }

  async function reload() {
    const epoch = ++state.epoch;
    try {
      const ctx = await awd.call('context.get', {});
      if (epoch !== state.epoch) return;
      state.context = ctx || {};
      await loadOverview(epoch);
      if (epoch === state.epoch) notice('');
    } catch (err) {
      if (epoch === state.epoch) notice(failureMessage(err), true);
    }
  }

  // Bind navigation tabs
  for (const tabKey of ['intake', 'conflict', 'finance', 'dashboard']) {
    const btn = $(`tab-${tabKey}`);
    if (btn) {
      btn.addEventListener('click', () => switchTab(tabKey));
    }
  }

  // Bind header buttons
  $('seed-demo').addEventListener('click', () => runAction($('seed-demo'), async (epoch) => {
    const res = await requestWithFallback('seedDemo', 'seedDemoData', { force: true });
    if (epoch !== state.epoch) return;
    if (res && (res.intakes || res.dashboard)) {
      normalizeOverview(res);
      renderAll();
    } else {
      await loadOverview(epoch);
    }
    notice('已加载典型律所全流程样板数据（含红黄绿利冲案例、站内信放行单、数电票与团队看板）。');
  }));

  $('refresh-data').addEventListener('click', () => runAction($('refresh-data'), async (epoch) => {
    await loadOverview(epoch);
    notice('数据已刷新。');
  }));

  // Bind Tab 1: Conflict Preview & Intake Submit
  $('btn-preview-conflict').addEventListener('click', () => runAction($('btn-preview-conflict'), async (epoch) => {
    const payload = collectIntakePayload();
    if (!payload.clientName && !payload.counterpartyName) {
      throw new Error('请至少填写委托人或对方当事人名称后再执行利冲预检。');
    }
    const result = await requestWithFallback('conflictPreview', 'precheckConflict', payload);
    if (epoch !== state.epoch) return;
    renderConflictPreview(result);
    notice('已完成全所利益冲突与收费合规预检。');
  }));

  $('btn-submit-intake').addEventListener('click', () => runAction($('btn-submit-intake'), async (epoch) => {
    const payload = collectIntakePayload();
    if (!payload.title) throw new Error('请填写案件/专项名称。');
    if (!payload.clientName) throw new Error('请填写委托人/客户名称。');
    const result = await request('submitIntake', payload);
    if (epoch !== state.epoch) return;
    const previewData = result?.conflictResult || result?.conflictCheck || ((result?.riskLevel || result?.conflictRiskLevel) ? result : null);
    if (previewData) {
      renderConflictPreview(previewData);
    }
    await loadOverview(epoch);
    notice(`已提交收案申请「${payload.title}」，利益冲突审查流已启动。`);
  }));

  $('intake-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('btn-submit-intake').click();
  });

  // Bind Tab 3: Submit Invoice & Record Collection & ERP Sync
  $('btn-submit-invoice').addEventListener('click', () => runAction($('btn-submit-invoice'), async (epoch) => {
    const intakeId = Number($('invoice-intake-id').value || 0) || null;
    const invoiceType = $('invoice-type').value;
    const taxRateBps = Number($('invoice-tax-rate').value || 600);
    const amountYuan = Number($('invoice-amount-yuan').value || 0);
    const amountCents = Math.round(amountYuan * 100);
    const buyerName = $('invoice-buyer-name').value.trim();
    const buyerTaxId = $('invoice-buyer-tax-id').value.trim();
    const buyerBankAccount = $('invoice-buyer-bank').value.trim();
    const recipientEmail = $('invoice-recipient-email').value.trim();

    if (!buyerName) throw new Error('请填写购买方名称（客户抬头）。');
    if (amountCents <= 0) throw new Error('申请开票金额必须大于 0。');

    await request('submitInvoice', {
      intakeId,
      invoiceType,
      taxRateBps,
      amountYuan,
      amountCents,
      buyerName,
      buyerTaxId,
      buyerBankAccount,
      recipientEmail
    });
    if (epoch !== state.epoch) return;
    await loadOverview(epoch);
    notice(`已提交发票申请：${buyerName}（¥${amountYuan.toLocaleString('zh-CN')}）。`);
  }));

  $('btn-record-collection').addEventListener('click', () => runAction($('btn-record-collection'), async (epoch) => {
    const intakeId = Number($('collection-intake-id').value || 0) || null;
    const invoiceId = $('collection-invoice-id').value ? Number($('collection-invoice-id').value) : null;
    const payerName = $('collection-payer-name').value.trim();
    const amountYuan = Number($('collection-amount-yuan').value || 0);
    const amountCents = Math.round(amountYuan * 100);
    const paymentMethod = $('collection-payment-method').value;
    const bankVoucherNo = $('collection-voucher-no').value.trim();
    const receivedDate = $('collection-received-date').value;

    if (!payerName) throw new Error('请填写付款方名称。');
    if (amountCents <= 0) throw new Error('到账实收金额必须大于 0。');

    await request('recordCollection', {
      intakeId,
      invoiceId,
      payerName,
      amountYuan,
      amountCents,
      paymentMethod,
      bankVoucherNo,
      receivedDate
    });
    if (epoch !== state.epoch) return;
    await loadOverview(epoch);
    notice(`已登记收费到账：${payerName}（¥${amountYuan.toLocaleString('zh-CN')}）。`);
  }));

  $('btn-sync-erp').addEventListener('click', () => runAction($('btn-sync-erp'), async (epoch) => {
    const res = await request('syncErp', { provider: 'KINGDEE_YONYOU_CSV' });
    if (epoch !== state.epoch) return;
    const banner = $('erp-sync-banner');
    banner.replaceChildren();
    banner.hidden = false;
    const syncedCount = res?.syncedInvoiceCount ?? res?.syncedCount ?? state.invoices.length;
    const voucherRef = res?.batchRef || res?.externalErpRef || res?.erpSystem || 'ERP-KD-YY-20261015';
    banner.append(
      node('strong', `财务系统对账完成（批次号：${voucherRef}）`),
      node('p', res?.summary || `已同步 ${syncedCount} 笔发票与收款核销台账至金蝶/用友标准凭证接口。`, 'hint')
    );
    await loadOverview(epoch);
    notice('已与财务系统（金蝶/用友）完成凭证同步与核销。');
  }));

  $('btn-export-ledger').addEventListener('click', () => runAction($('btn-export-ledger'), async (epoch) => {
    const res = await requestWithFallback('exportCsv', 'syncErp', { provider: 'KINGDEE_YONYOU_CSV', mode: 'EXPORT_CSV' });
    if (epoch !== state.epoch) return;
    const banner = $('erp-sync-banner');
    banner.replaceChildren();
    banner.hidden = false;
    const csvSample = typeof res?.csv === 'string' ? res.csv.split('\n').slice(0, 3).join(' | ') : null;
    banner.append(
      node('strong', `标准财务台账 CSV 已生成（${res?.filename || 'lawfirm-finance-ledger.csv'}）`),
      node('p', csvSample || res?.csvPreview || res?.summary || '包含单据编号、案件案号、客户税号、含税额、不含税额、税额、实收核销额与账龄分段。', 'hint')
    );
    notice('已生成金蝶/用友标准财务台账。');
  }));

  // Listen for direct window postMessage navigation as fallback
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'lawfirm.navigate' && msg.tab) {
      switchTab(msg.tab);
    } else if (msg.type === 'event' && msg.event === 'lawfirm.navigate' && msg.data?.tab) {
      switchTab(msg.data.tab);
    }
  });

  // Check initial URL query parameter ?tab=...
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const initialTab = urlParams.get('tab');
    if (initialTab) switchTab(initialTab);
  } catch { /* ignore */ }

  awd.ready().then((ctx) => {
    if (ctx?.initialTab) switchTab(ctx.initialTab);
    for (const evt of ['project.switched', 'account.changed']) {
      awd.events.on(evt, reload);
    }
    awd.events.on('lawfirm.navigate', (data) => {
      if (data && data.tab) switchTab(data.tab);
    });
    return reload();
  }).catch((err) => notice(failureMessage(err), true));
}());
