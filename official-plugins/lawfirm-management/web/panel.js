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
      departmentName: data.currentDepartment || '争议解决',
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
    const dept = self.departmentName || self.department || '综合业务';
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
        node('span', `业务分类：${item.departmentName || '未填写'}`),
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
        card.append(node('p', `本机征询会话 ID：${item.imConversationId}（不表示已向其他设备送达）`, 'hint'));
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
          card.append(node('p', `本机征询会话：${clr.imConversationId}（仅本机记录）`, 'hint'));
        }
        if (clr.comment) {
          card.append(node('p', `放行备注：${clr.comment}`));
        }

        const commentInput = node('input', null, 'clearance-comment-input');
        commentInput.type = 'text';
        commentInput.placeholder = '登记本机核查意见（选填，仅回写本机征询记录）';
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
            notice(`已保存本机核查记录：${label}`);
          }));
          return btn;
        };

        actions.append(
          makeDecisionBtn('本机登记放行', 'APPROVED', false, ''),
          makeDecisionBtn('本机登记附条件放行', 'APPROVED_WITH_WALL', true, 'primary'),
          makeDecisionBtn('本机登记拒绝放行', 'REJECTED', false, 'danger')
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
      commentInput.placeholder = '本机核查结论（选填）';
      commentInput.value = intake.committeeComment || '';
      card.append(commentInput);

      const actions = node('div', null, 'action-row');
      const approveBtn = node('button', '本机登记通过并建项', 'primary');
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
        notice(`案件「${intake.title}」已在本机登记通过并建项；云端终审状态另行查看。`);
      }));

      const rejectBtn = node('button', '本机登记驳回', 'danger');
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
      makeKpi('活跃律师与平均负荷', `${unitCount} 名 · 负荷 ${avgWi}`, '综合主办、协办、待办与近30日工时'),
      makeKpi('全所签约合同总额', formatYuanFromCents(totalContracted), `折合 ${formatWanFromCents(totalContracted)}`),
      makeKpi('已开票总额与开票率', formatYuanFromCents(totalBilled), `全所开票率 ${formatPercent(billingRate)}`),
      makeKpi('已到账实收与回收率', formatYuanFromCents(totalCollected), `账单回收率 ${formatPercent(billedColRate)} · 合同回款率 ${formatPercent(contractColRate)}`),
      makeKpi('待收账款（AR）与账龄结构', formatYuanFromCents(totalAr), `<30天 ${formatYuanFromCents(bucket0To30)} | 30-90天 ${formatYuanFromCents(bucket30To90)} | >90天 ${formatYuanFromCents(bucketOver90)}`)
    );

    // 1. 业务分类统计（沿用 departmentName 台账字段，不代表团队层级）
    const deptTbody = $('dept-table');
    deptTbody.replaceChildren();
    const departments = d.departments || [];
    if (departments.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无业务分类统计数据。', 'hint');
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
          node('td', dept.headLawyerName || dept.leadName || '主办律师'),
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

    // 2. 主办律师统计（teamLeads 按主办律师归组，不代表团队层级）
    const leadTbody = $('lead-table');
    leadTbody.replaceChildren();
    const leads = d.teamLeads || [];
    if (leads.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无主办律师统计数据。', 'hint');
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

    // 3. 律师个人统计（units 的每一行对应一位用户）
    const unitTbody = $('unit-table');
    unitTbody.replaceChildren();
    const units = d.units || [];
    if (units.length === 0) {
      const tr = node('tr');
      const td = node('td', '暂无律师工作负荷数据。', 'hint');
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
    const departmentName = $('intake-department').value.trim() || '争议解决';
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

  const EN_EXACT = {
    '律所管理 · AI WorkDeck': 'Law Firm Management · AI WorkDeck',
    '律所业务与决策管理中心': 'Law Firm Practice & Executive Center',
    '正在加载身份与业务分类…': 'Loading identity & practice areas…',
    '加载典型律所样板数据': 'Load Demo Law Firm Data',
    '刷新数据': 'Refresh Data',
    '律所管理主导航': 'Law Firm Management Navigation',
    '收案与立项': 'Case Intake & Filing',
    '利冲审查中心': 'Conflict Check Center',
    '发票与财务收费': 'Invoicing & Billing',
    '决策与业务看板': 'Executive Dashboard',
    '正在连接律所管理引擎…': 'Connecting to Law Firm Management engine…',
    '收案、财务和样板数据属于本机台账。本机征询记录不表示同事已收到消息。需要本人确认时，请使用「利冲审查中心」中的律所云端协作。': 'Intake, finance, and demo data are stored in your local ledger. Local clearance entries do not notify colleagues automatically; use Firm Cloud Collaboration in the Conflict Check Center for cross-account confirmation.',
    '新建本机收案记录': 'New Local Case Intake',
    '依据《律师法》第39、50条及《全国律协执业行为规范》第50–56条自动检索全所在办、历史及关联主体冲突': 'Automatically screens active, historical, and affiliate conflicts across the firm.',
    '案件 / 专项名称': 'Matter / Project Title',
    '例如：华星半导体与蓝海光电专利侵权及商业秘密纠纷案': 'e.g., Huaxing Semiconductor v. Blue Ocean Optoelectronics Patent & Trade Secret Dispute',
    '业务领域': 'Practice Area',
    '民商事诉讼与仲裁': 'Commercial Litigation & Arbitration',
    '资本市场与证券': 'Capital Markets & Securities',
    '资本市场/IPO': 'Capital Markets / IPO',
    '公司并购与投融资': 'Corporate M&A & Investment',
    '知识产权与数据合规': 'IP & Data Compliance',
    '刑事辩护与代理': 'Criminal Defense & Representation',
    '行政复议与诉讼': 'Administrative Reconsideration & Litigation',
    '婚姻家事与财富传承': 'Family Law & Wealth Succession',
    '常年法律顾问': 'Retainer Legal Counsel',
    '破产重整与清收': 'Bankruptcy Reorganization & Recovery',
    '劳动人事合规': 'Labor & Employment Compliance',
    '业务分类': 'Practice Group',
    '争议解决': 'Dispute Resolution',
    '例如：争议解决 / 资本市场': 'e.g., Dispute Resolution / Capital Markets',
    '拟任主办负责人': 'Proposed Lead Counsel',
    '主办合伙人/律师姓名': 'Lead partner / lawyer name',
    '收费方式': 'Billing Mode',
    '固定收费（FIXED）': 'Fixed Fee (FIXED)',
    '按标的额比例收费（PROPORTIONAL）': 'Proportional Fee (PROPORTIONAL)',
    '风险代理收费（CONTINGENCY）': 'Contingency Fee (CONTINGENCY)',
    '计时收费（HOURLY）': 'Hourly Billing (HOURLY)',
    '常年法律顾问（RETAINER）': 'Retainer Fee (RETAINER)',
    '固定收费': 'Fixed Fee',
    '按标的额比例': 'Proportional Fee',
    '风险代理': 'Contingency Fee',
    '计时收费': 'Hourly Fee',
    '常年顾问': 'Retainer',
    '委托人 / 客户名称': 'Client Name',
    '客户法定全称或自然人姓名': 'Full legal name of entity or individual client',
    '客户统一社会信用代码': 'Client Unified Social Credit Code',
    '选填，18位信用代码': 'Optional, 18-digit credit code',
    '对方当事人名称': 'Counterparty Name',
    '对方当事人全称，无对抗方填无': 'Full name of counterparty (enter None if N/A)',
    '对方统一社会信用代码': 'Counterparty Unified Social Credit Code',
    '关联方 / 控股股东 / 一致行动人': 'Related Party / Controlling Shareholder / Concerted Actor',
    '选填，集团母公司、实控人或担保方名称': 'Optional, parent company, controller, or guarantor',
    '关联方身份关系': 'Related Party Role',
    '控股股东 / 实际控制人': 'Controlling Shareholder / Actual Controller',
    '集团关联公司 / 母子公司': 'Affiliate / Parent-Subsidiary',
    '一致行动人': 'Concerted Actor',
    '担保人 / 连带债务人': 'Guarantor / Joint Debtor',
    '签约合同额（万元）': 'Contract Amount (10k CNY)',
    '风险代理提成比例（%）': 'Contingency Rate (%)',
    '实时利冲与合规预检': 'Run Conflict & Compliance Pre-check',
    '保存本机收案与核查记录': 'Save Local Intake & Check Record',
    '我的收案申请与利冲五步进展': 'My Case Intakes & 5-Step Conflict Progress',
    '与个人中心「收案与利冲」共享本机台账。以下进展为本机登记，跨账户征询及本人终审请使用云端协作。': 'Shares the local ledger with Personal Center. Use Cloud Collaboration for cross-account clearance and final review.',
    '律所云端利冲协作': 'Firm Cloud Conflict Collaboration',
    '管理员指定委员，由本人接受；关联律师与指定委员分别确认。仅发送你明确提交的信息，本机旧台账不会自动上传。': 'Admins appoint committee members who accept personally; related counsel and committee members confirm separately. Only explicitly submitted data is sent.',
    '连接并刷新': 'Connect & Refresh',
    '连接后可查看本人待办和已提交申请。': 'Connect to view your pending tasks and submitted requests.',
    '核验同所账户': 'Verify Firm Account',
    '同事账户手机号或邮箱': 'Colleague phone number or email',
    '核验并加入选择列表': 'Verify & Add to List',
    '指定利冲委员': 'Appoint Conflict Committee Member',
    '委员候选账户': 'Committee candidate account',
    '发送委员指派': 'Send Appointment',
    '发起新的利冲协作申请': 'Submit New Conflict Collaboration Request',
    '案件名称': 'Matter Title',
    '委托人名称': 'Client Name',
    '主办律师账户': 'Lead Counsel Account',
    '已接受指派的终审委员': 'Accepted Final Review Committee Member',
    '需要人工征询的关联律师（可选）': 'Related Counsel for Manual Clearance (Optional)',
    '不另行指定': 'None specified',
    '仅向该律师发送的关联案件摘要': 'Related Matter Summary (Sent Only to This Lawyer)',
    '如涉及本机案件，只填写对方核查所必需的信息；请勿粘贴无关客户材料。': 'Enter only the information necessary for conflict verification; do not paste unrelated client materials.',
    '将以上申请信息发送至本所云端协作，向关联律师及所选委员发出通知。系统仅检索本所已经主动提交的云端申请。': 'Send the above request to Firm Cloud Collaboration and notify related counsel and the selected committee member.',
    '发送利冲协作申请': 'Submit Conflict Request',
    '重新编辑同一申请': 'Edit Same Request',
    '重试同一申请': 'Retry Same Request',
    '重新发送同一申请': 'Resend Same Request',
    '本机历史征询记录': 'Local Clearance History',
    '以下仅为本机台账与演示记录，不表示已向其他设备送达。跨账户确认请使用上方云端协作。': 'Local ledger and demo records only. Use Cloud Collaboration above for cross-account confirmation.',
    '本机收案核查台账': 'Local Intake Review Ledger',
    '保留本机核查结论与建项功能。此处登记不代表云端指定委员已作出终审决定。': 'Retains local review conclusions and project creation. Does not represent cloud committee final approval.',
    '提交发票申请（数电专票 / 普票）': 'Submit Invoice Application (Digital VAT Special / Normal)',
    '自动核算不含税金额与增值税税额，支持关联已立案项目或收案台账': 'Automatically calculates tax-exclusive amount and VAT, linked to filed matters.',
    '关联案件立项': 'Linked Matter Intake',
    '发票类型': 'Invoice Type',
    '数电增值税专用发票': 'Digital VAT Special Invoice',
    '数电普通发票': 'Digital VAT Normal Invoice',
    '增值税专用发票': 'VAT Special Invoice',
    '增值税普通发票': 'VAT Normal Invoice',
    '税率 / 征收率': 'Tax / Levy Rate',
    '6%（现代服务 · 法律鉴证咨询）': '6% (Modern Services · Legal Advisory)',
    '3%（小规模纳税人征收率）': '3% (Small-Scale Taxpayer Levy Rate)',
    '1%（阶段性减按征收率）': '1% (Reduced Levy Rate)',
    '申请开票含税金额（元）': 'Invoice Tax-Inclusive Amount (CNY)',
    '购买方名称（客户抬头）': 'Buyer Name (Client Title)',
    '购买方法定全称': 'Full legal name of buyer',
    '购买方纳税人识别号': 'Buyer Taxpayer ID',
    '18位统一社会信用代码': '18-digit Unified Social Credit Code',
    '购买方开户行及账号': 'Buyer Bank & Account No.',
    '选填，专票备查开户行及账号': 'Optional, bank name and account number',
    '数电票交付邮箱': 'Digital Invoice Delivery Email',
    '提交发票申请': 'Submit Invoice Request',
    '手动登记收费 / 到账核销': 'Record Payment / Reconciliation',
    '在未直连外部财务软件前，支持手动录入银行到账流水并与发票及案件合同额自动核销': 'Manually record bank receipts and reconcile with invoices and contract amounts.',
    '核销关联发票（可选）': 'Reconcile with Invoice (Optional)',
    '不绑定特定发票（先款后票/预收款）': 'Unbound (Advance Payment / Unbilled)',
    '不绑定特定发票（先款后票 / 预收款）': 'Unbound (Advance Payment / Unbilled)',
    '付款方名称': 'Payer Name',
    '实际打款主体名称': 'Actual paying entity name',
    '本次到账实收金额（元）': 'Received Amount (CNY)',
    '收款方式': 'Payment Method',
    '对公银行转账': 'Corporate Bank Transfer',
    '提存 / 监管账户划转': 'Escrow Account Transfer',
    '提存/监管账户划转': 'Escrow Account Transfer',
    '银行本票 / 支票': 'Bank Cashier Order / Check',
    '银行本票/支票': 'Bank Cashier Order / Check',
    '其他合规收款': 'Other Compliant Payment',
    '银行流水号 / 凭证号': 'Bank Reference / Voucher No.',
    '例如：BK-20261015-8801': 'e.g., BK-20261015-8801',
    '到账日期': 'Received Date',
    '登记收费并核销': 'Record Payment & Reconcile',
    '发票与财务收费台账（支持金蝶 / 用友对接）': 'Invoice & Billing Ledger (Kingdee / Yonyou Ready)',
    '实时计算每案开票率、账单回收率与合同回款率；支持一键同步用友/金蝶财务凭证或导出标准台账': 'Tracks billing and collection rates per matter; syncs vouchers with Kingdee/Yonyou or exports standard CSV ledgers.',
    '与财务系统同步核销（金蝶/用友）': 'Sync with ERP (Kingdee / Yonyou)',
    '导出标准财务台账': 'Export Standard Finance CSV',
    '发票申请与开票核销明细': 'Invoice Applications & Reconciliation Details',
    '申请单号 / 发票号': 'App No. / Invoice No.',
    '关联案件与业务分类': 'Linked Matter & Practice Group',
    '购买方与税号': 'Buyer & Tax ID',
    '含税金额 / 税额': 'Tax-Inclusive / Tax',
    '已核销回款': 'Reconciled Collection',
    '开票与回款状态': 'Billing & Collection Status',
    '财务ERP同步': 'ERP Sync',
    '操作': 'Actions',
    '到账实收与核销流水明细': 'Payment Receipts & Reconciliation Ledger',
    '收款单号': 'Receipt No.',
    '关联案件': 'Linked Matter',
    '核销发票号': 'Reconciled Invoice',
    '实收金额': 'Received Amount',
    '银行流水凭证号': 'Bank Voucher No.',
    '核销状态': 'Reconciliation Status',
    '各业务分类表现对比（忙闲负荷 · 创收 · 开票 · 回收率）': 'Practice Group Performance (Workload · Revenue · Billing · Collection)',
    '汇总工作台在办项目与财务台账，按业务分类对比案件饱和度、签约创收、已开票、实收回款与回收率': 'Compares case saturation, contracted revenue, billed amounts, collections, and recovery rates across practice groups.',
    '主办律师': 'Lead Counsel',
    '活跃律师': 'Active Lawyers',
    '在办案件数': 'Active Matters',
    '平均负荷与忙闲状态': 'Avg Workload & Status',
    '签约合同总额': 'Total Contracted',
    '已开票金额': 'Billed Amount',
    '已到账实收': 'Collected Amount',
    '账单回收率 / 合同回款率': 'Billed / Contract Recovery',
    '待收账款（AR）': 'Accounts Receivable (AR)',
    '主办律师业务统计': 'Lead Counsel Statistics',
    '按主办律师汇总案件规模、工作负荷、实收创收、回收率、利冲一次通过率与立案效率': 'Summarizes matter volume, workload, collections, recovery rate, conflict pass rate, and filing cycle by lead counsel.',
    '项目协作人数': 'Team Size',
    '主办案件数': 'Lead Matters',
    '主办律师负荷': 'Lead Workload',
    '实收回款额': 'Collected Amount',
    '账单回收率': 'Recovery Rate',
    '利冲通过率': 'Conflict Pass Rate',
    '平均立案周期': 'Avg Filing Cycle',
    '律师工作负荷与创收明细': 'Lawyer Workload & Revenue Details',
    '按主办案件、协办案件、待办/逾期任务与近30日工作台活跃时长综合计算个体负荷指数（空闲 / 适中 / 饱和 / 超负荷）': 'Computes individual workload index (Idle / Optimal / Saturated / Overloaded) from lead/co-counsel matters, open/overdue tasks, and 30-day activity.',
    '律师姓名': 'Lawyer Name',
    '执业角色': 'Role',
    '主办案件': 'Lead Matters',
    '协办案件': 'Co-Counsel Matters',
    '待办 / 临期逾期事项': 'Open / Overdue Tasks',
    '近30日工作台活跃': '30d Active Hours',
    'Workload 负荷指数与忙闲状态': 'Workload Index & Status',
    '个人签约 / 实收': 'Contracted / Collected',
    '个人回收率': 'Recovery Rate',
    '直接利冲 · 禁止代理': 'Direct Conflict · Representation Prohibited',
    '潜在利冲 · 需征询放行': 'Potential Conflict · Clearance Required',
    '无利冲 · 审查通过': 'No Conflict · Cleared',
    '1. 提交收案申请': '1. Intake Submitted',
    '2. 自动利冲检索': '2. Auto Conflict Check',
    '3. 关联律师站内信放行': '3. Related Counsel Clearance',
    '4. 利冲委员终审': '4. Committee Final Review',
    '5. 正式立案并建项': '5. Approved & Filed',
    '实时利益冲突与收费合规审查结论': 'Real-Time Conflict & Fee Compliance Conclusion',
    '已完成全所利益冲突扫描。': 'Completed firm-wide conflict of interest scan.',
    '暂无收案立项记录。可在左侧填写新案信息并预检利冲，或点击顶部「加载典型律所样板数据」。': 'No intake records yet. Fill out the form on the left or click "Load Demo Law Firm Data" above.',
    '当前没有待处理的利益冲突放行征询单。': 'No pending conflict clearance requests.',
    '本机登记放行': 'Record Local Approval',
    '本机登记附条件放行': 'Record Conditional Approval (Wall)',
    '本机登记拒绝放行': 'Record Local Rejection',
    '全所利冲审查队列为空。': 'Firm conflict review queue is empty.',
    '启用信息隔离墙承诺（Ethical Wall）': 'Apply Ethical Wall Undertaking',
    '已核验当事人书面豁免函': 'Verified Written Client Waiver',
    '本机登记通过并建项': 'Approve & Create Project Locally',
    '本机登记驳回': 'Reject Locally',
    '暂无发票记录。': 'No invoice records.',
    '待开票': 'Pending Issue',
    '已开票 · 待回款': 'Issued · Awaiting Payment',
    '已开票 · 部分回款': 'Issued · Partially Paid',
    '已全额回款': 'Paid in Full',
    '已作废': 'Voided',
    '已红冲': 'Red-Invoiced',
    '待同步': 'Pending Sync',
    '确认开票': 'Confirm Issue',
    '已开具': 'Issued',
    '暂无收费到账流水记录。': 'No payment collection records.',
    '未绑定发票': 'Unbound',
    '已核销': 'Reconciled',
    '已入账': 'Recorded',
    '在办正式案件 / 累计收案': 'Active Filed Matters / Total Intakes',
    '工作台与立项中心全所实时汇总': 'Real-time firm-wide summary across workbench and intake center',
    '活跃律师与平均负荷': 'Active Lawyers & Avg Workload',
    '综合主办、协办、待办与近30日工时': 'Combined lead, co-counsel, open tasks, and 30d active hours',
    '全所签约合同总额': 'Firm Total Contracted Amount',
    '已开票总额与开票率': 'Total Billed & Billing Rate',
    '已到账实收与回收率': 'Total Collected & Recovery Rate',
    '待收账款（AR）与账龄结构': 'Accounts Receivable (AR) & Aging',
    '暂无业务分类统计数据。': 'No practice group statistics available.',
    '暂无主办律师统计数据。': 'No lead counsel statistics available.',
    '暂无律师工作负荷数据。': 'No lawyer workload data available.',
    '数据已刷新。': 'Data refreshed.',
    '已完成全所利益冲突与收费合规预检。': 'Completed firm-wide conflict and fee compliance pre-check.',
    '已与财务系统（金蝶/用友）完成凭证同步与核销。': 'Completed voucher sync and reconciliation with ERP (Kingdee/Yonyou).',
    '已生成金蝶/用友标准财务台账。': 'Generated standard Kingdee/Yonyou finance ledger CSV.',
    '接受委员指派': 'Accept Appointment',
    '拒绝委员指派': 'Decline Appointment',
    '撤销委员指派': 'Revoke Appointment',
    '暂无与你有关的云端利冲申请。': 'No cloud conflict requests involving you.',
    '本人确认放行': 'Confirm Clearance',
    '附条件放行': 'Conditional Clearance',
    '本人拒绝放行': 'Decline Clearance',
    '本人终审通过': 'Approve Final Review',
    '本人终审拒绝': 'Reject Final Review',
    '云端协作已更新。仅显示本人有权查看的记录。': 'Cloud collaboration updated. Showing only records you are authorized to view.',
    '账户或项目已切换，请重新连接云端协作。': 'Account or project switched. Please reconnect to cloud collaboration.'
  };
  let enObserverReady = false;
  function trEn(s) {
    if (!s || typeof s !== 'string') return s;
    const trimmed = s.trim();
    if (!trimmed) return s;
    if (EN_EXACT[trimmed]) return s.replace(trimmed, EN_EXACT[trimmed]);
    return s
      .replace(/空闲 · 可优先派案/g, 'Idle · Ready for Assignment')
      .replace(/适中 · 良性饱和/g, 'Optimal · Balanced')
      .replace(/饱和 · 高负荷/g, 'Saturated · High Load')
      .replace(/超负荷 · 预警分流/g, 'Overloaded · Rebalance Needed')
      .replace(/（草稿）/g, ' (Draft)')
      .replace(/（自动利冲检索中）/g, ' (Auto Conflict Checking)')
      .replace(/（待关联律师放行）/g, ' (Pending Counsel Clearance)')
      .replace(/（待利冲委员终审）/g, ' (Pending Committee Review)')
      .replace(/（正式立案并建项）/g, ' (Approved & Filed)')
      .replace(/（利冲驳回）/g, ' (Rejected for Conflict)')
      .replace(/（已结案归档）/g, ' (Closed & Archived)')
      .replace(/^业务领域：/, 'Practice Area: ')
      .replace(/^业务分类：/, 'Practice Group: ')
      .replace(/^主办：/, 'Lead: ')
      .replace(/^委托人：/, 'Client: ')
      .replace(/^对方当事人：/, 'Counterparty: ')
      .replace(/^收费：/, 'Fee: ')
      .replace(/^状态：/, 'Status: ')
      .replace(/ 万元/g, '0k CNY');
  }
  function translateSubtree(root) {
    if (!root) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let curr = walk.currentNode;
    while (curr) {
      if (curr.nodeType === Node.TEXT_NODE) {
        const next = trEn(curr.nodeValue);
        if (next !== curr.nodeValue) curr.nodeValue = next;
      } else if (curr.nodeType === Node.ELEMENT_NODE) {
        for (const attr of ['placeholder', 'aria-label', 'title']) {
          const val = curr.getAttribute?.(attr);
          if (val) {
            const next = trEn(val);
            if (next !== val) curr.setAttribute(attr, next);
          }
        }
      }
      curr = walk.nextNode();
    }
  }
  function maybeEnableEnglish(ctx) {
    let lang = ctx?.language || ctx?.locale || '';
    if (!lang) {
      try { lang = localStorage.getItem('checkba_locale') || localStorage.getItem('awd_locale') || ''; } catch {}
    }
    if (!String(lang).toLowerCase().startsWith('en')) return;
    document.documentElement.lang = 'en-US';
    document.title = trEn(document.title);
    translateSubtree(document.body);
    if (!enObserverReady && typeof MutationObserver !== 'undefined') {
      enObserverReady = true;
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'characterData') {
            const next = trEn(m.target.nodeValue);
            if (next !== m.target.nodeValue) m.target.nodeValue = next;
          } else if (m.type === 'attributes') {
            const val = m.target.getAttribute?.(m.attributeName);
            if (val) {
              const next = trEn(val);
              if (next !== val) m.target.setAttribute(m.attributeName, next);
            }
          } else {
            for (const n of m.addedNodes) translateSubtree(n);
          }
        }
      });
      obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
    }
  }

  async function reload() {
    const epoch = ++state.epoch;
    try {
      const ctx = await awd.call('context.get', {});
      if (epoch !== state.epoch) return;
      state.context = ctx || {};
      maybeEnableEnglish(state.context);
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
    notice('已加载典型律所全流程样板数据（含红黄绿利冲案例、站内信放行单、数电票与业务看板）。');
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
