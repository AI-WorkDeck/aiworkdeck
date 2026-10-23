// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const request = (action, params = {}) => awd.call('lawfirm.request', { action, params });
  const labels = { PENDING: '待本人接受', ACCEPTED: '已接受', DECLINED: '已拒绝', REVOKED: '已撤销',
    PENDING_LAWYER_CLEARANCE: '待关联律师确认', PENDING_COMMITTEE_REVIEW: '待指定委员终审',
    APPROVED: '已通过', APPROVED_WITH_WALL: '附条件通过', REJECTED: '已拒绝' };
  let data = null, epoch = 0, selectedId = '', pending = null, draftId = null;
  const members = new Map();
  $('workflow-practice').replaceChildren(...[...$('intake-practice-area').options].map(option => option.cloneNode(true)));
  const element = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  const status = text => { $('workflow-status').textContent = text || ''; };
  function name(id) { return members.get(Number(id))?.name || `账户 ${id}`; }
  async function action(button, fn) {
    if (button.disabled) return;
    button.disabled = true;
    const started = epoch;
    try { await fn(started); } catch (e) { if (started === epoch) status(e?.message || '操作未完成，请重试'); }
    finally { if (button.isConnected) button.disabled = false; }
  }
  function fill(id, rows, empty = false) {
    const select = $(id), value = select.value;
    select.replaceChildren();
    if (empty) { const opt = element('option', '不另行指定'); opt.value = ''; select.append(opt); }
    for (const row of rows) { const opt = element('option', `${row.name}（已核验账户）`); opt.value = row.userId; select.append(opt); }
    if ([...select.options].some(o => o.value === value)) select.value = value;
  }
  function choices() {
    const rows = [...members.values()];
    fill('workflow-lead', rows); fill('workflow-appointee', rows); fill('workflow-related', rows, true);
    fill('workflow-committee', (data?.committee || []).filter(a => a.state === 'ACCEPTED' && a.member.userId !== data.self.userId).map(a => a.member));
  }
  function decisionButton(label, container, actionName, params, commentInput) {
    const button = element('button', label); button.type = 'button';
    button.addEventListener('click', () => action(button, async started => {
      const comment = commentInput?.value.trim();
      if (commentInput && !comment) throw new Error('请填写本人核查意见后确认');
      await request(actionName, { ...params, ...(commentInput ? { comment } : {}) });
      if (started === epoch) await refresh(started);
    })); container.append(button); return button;
  }
  function render() {
    $('workflow-content').hidden = false;
    $('workflow-admin').hidden = !data.self.firmAdmin;
    members.set(data.self.userId, data.self);
    for (const a of data.committee || []) members.set(a.member.userId, a.member);
    choices();
    const appointments = $('workflow-appointments'); appointments.replaceChildren();
    for (const a of data.committee || []) {
      const card = element('article', null, 'card'); card.dataset.recordId = a.id;
      card.append(element('strong', `利冲委员：${a.member.name} · ${labels[a.state] || a.state}`));
      if (a.member.userId === data.self.userId && a.state === 'PENDING') {
        card.append(element('p', '指派尚未生效。请由你本人决定是否接受，已读消息不会代替接受。', 'hint'));
        decisionButton('接受委员指派', card, 'workflowAppointmentDecision', { recordId: a.id, expectedVersion: a.version, decision: 'ACCEPTED' });
        decisionButton('拒绝委员指派', card, 'workflowAppointmentDecision', { recordId: a.id, expectedVersion: a.version, decision: 'DECLINED' });
      }
      if (data.self.firmAdmin && ['PENDING', 'ACCEPTED'].includes(a.state))
        decisionButton('撤销委员指派', card, 'workflowAppoint', { userId: a.member.userId, decision: 'REVOKE' });
      appointments.append(card);
    }
    const records = $('workflow-records'); records.replaceChildren();
    if (!data.records?.length) records.append(element('p', '暂无与你有关的云端利冲申请。', 'hint'));
    for (const record of data.records || []) {
      const card = element('article', null, 'card'); card.dataset.recordId = record.id; card.tabIndex = -1;
      card.append(element('h3', record.title), element('p', `${labels[record.status] || record.status} · 风险提示 ${record.risk}`));
      if (record.consultationContext) {
        const context = record.consultationContext;
        const details = element('section'); details.setAttribute('aria-label', '本次申请核查信息');
        details.append(element('strong', `本次征询申请：${context.title}`), element('p', `本次申请委托人：${context.clientName}；对方：${context.counterpartyName || '未填写'}`));
        card.append(details);
      } else if (record.clientName != null) card.append(element('p', `委托人：${record.clientName}；对方：${record.counterpartyName || '未填写'}`));
      for (const c of record.clearances || []) {
        const section = element('section');
        section.append(element('strong', `${name(c.targetId)} · ${labels[c.decision] || c.decision}`), element('p', c.summary));
        if (c.comment) section.append(element('p', `本人意见：${c.comment}`));
        if (c.targetId === data.self.userId && c.decision === 'PENDING' && record.status === 'PENDING_LAWYER_CLEARANCE') {
          const comment = element('textarea'); comment.maxLength = 2000; comment.setAttribute('aria-label', '本人利冲核查意见'); section.append(comment);
          for (const [decision, label] of [['APPROVED', '本人确认放行'], ['APPROVED_WITH_WALL', '附条件放行'], ['REJECTED', '本人拒绝放行']])
            decisionButton(label, section, 'workflowClearance', { recordId: record.id, decision }, comment);
        }
        card.append(section);
      }
      if (record.canReview) {
        card.append(element('p', '请核查本案及关联律师意见后终审。系统风险提示不能代替委员判断；附条件放行需要核实条件已落实。', 'hint'));
        const comment = element('textarea'); comment.maxLength = 2000; comment.setAttribute('aria-label', '委员终审意见'); card.append(comment);
        decisionButton('本人终审通过', card, 'workflowReview', { recordId: record.id, decision: 'APPROVED' }, comment);
        decisionButton('本人终审拒绝', card, 'workflowReview', { recordId: record.id, decision: 'REJECTED' }, comment);
      }
      if (record.decisionComment) card.append(element('p', `终审意见：${record.decisionComment}`));
      records.append(card);
    }
    if (selectedId) {
      const card = [...$('cloud-workflow').querySelectorAll('[data-record-id]')].find(el => el.dataset.recordId === selectedId);
      if (card) { card.scrollIntoView?.({ block: 'nearest' }); card.focus?.(); }
      else status('该记录当前不可见，请确认账户及律所权限。');
    }
  }
  async function refresh(started = epoch) {
    const result = await request('workflowOverview');
    if (started !== epoch) return;
    if (!result?.self?.userId || !Array.isArray(result.records)) throw new Error('云端协作响应不完整，请重试');
    data = result; status('云端协作已更新。仅显示本人有权查看的记录。'); render();
  }
  $('workflow-refresh').addEventListener('click', () => action($('workflow-refresh'), refresh));
  $('workflow-lookup').addEventListener('click', () => action($('workflow-lookup'), async started => {
    const result = await request('workflowLookup', { identifier: $('workflow-identifier').value.trim() });
    if (started !== epoch) return;
    if (!result?.member?.userId) throw new Error('未能核验该账户');
    members.set(result.member.userId, result.member); choices(); status(`已核验同所账户：${result.member.name}`);
  }));
  $('workflow-appoint').addEventListener('click', () => action($('workflow-appoint'), async started => {
    await request('workflowAppoint', { userId: Number($('workflow-appointee').value) });
    if (started === epoch) await refresh(started);
  }));
  $('workflow-form').addEventListener('submit', event => { event.preventDefault(); action($('workflow-submit'), async started => {
    if (!pending) {
      if (!$('workflow-consent').checked) throw new Error('请确认发送范围后提交');
      const related = Number($('workflow-related').value), summary = $('workflow-summary').value.trim();
      if (related && !summary) throw new Error('请填写仅向该律师发送的关联案件摘要');
      draftId ||= crypto.randomUUID();
      pending = { requestId: draftId, title: $('workflow-title').value.trim(), clientName: $('workflow-client').value.trim(),
        counterpartyName: $('workflow-counterparty').value.trim(), practiceArea: $('workflow-practice').value, leadId: Number($('workflow-lead').value),
        committeeId: Number($('workflow-committee').value), related: related ? [{ userId: related, summary }] : [] };
      if (!pending.title || !pending.clientName || !pending.leadId || !pending.committeeId) { pending = null; throw new Error('请填写案件、委托人，并选择真实主办律师和已接受的委员'); }
      if (pending.leadId === pending.committeeId) { pending = null; throw new Error('主办律师不能终审自己的申请，请选择另一位委员'); }
    }
    for (const input of $('workflow-form').querySelectorAll('input,textarea,select')) input.disabled = true;
    $('workflow-submit').textContent = '重试同一申请';
    $('workflow-revise').hidden = false;
    const result = await request('workflowSubmit', pending);
    if (started !== epoch) return;
    pending = null; draftId = null; selectedId = result.id; $('workflow-revise').hidden = true;
    for (const input of $('workflow-form').querySelectorAll('input,textarea,select')) input.disabled = false;
    $('workflow-submit').textContent = '发送利冲协作申请'; $('workflow-consent').checked = false;
    await refresh(started);
  }); });
  $('workflow-revise').addEventListener('click', () => {
    pending = null;
    for (const input of $('workflow-form').querySelectorAll('input,textarea,select')) input.disabled = false;
    $('workflow-submit').textContent = '重新发送同一申请';
    status('仍沿用同一发送编号。如果上次已成功，修改后的内容会被拒绝，请刷新查看原记录。');
  });
  function reset() {
    epoch++; data = null; pending = null; draftId = null; selectedId = ''; members.clear(); $('workflow-content').hidden = true;
    for (const input of $('workflow-form').querySelectorAll('input,textarea,select')) input.disabled = false;
    $('workflow-form').reset(); $('workflow-records').replaceChildren(); $('workflow-appointments').replaceChildren();
    $('workflow-submit').textContent = '发送利冲协作申请'; $('workflow-revise').hidden = true;
    status('账户或项目已切换，请重新连接云端协作。');
  }
  function navigate(target) {
    if (typeof target?.recordId !== 'string' || !/^[0-9a-f-]{36}$/i.test(target.recordId)) return;
    selectedId = target.recordId; $('tab-conflict').click(); action($('workflow-refresh'), refresh);
  }
  awd.ready().then(() => {
    awd.events.on('lawfirm.navigate', navigate);
    awd.events.on('account.changed', reset); awd.events.on('project.switched', reset);
  }).catch(error => status(error?.message || '宿主连接失败'));
}());
