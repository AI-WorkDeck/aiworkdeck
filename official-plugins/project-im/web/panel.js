// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { epoch: 0, selection: 0, context: null, self: null, conversations: [], active: null,
    agents: [], projectAgentReason: '', agentOpenSequence: 0, agentStatus: null, agentRequesting: false, agentFailures: new Map(),
    directory: null, expandedGroups: { project: true, org: false, firm: false, friends: false },
    messages: [], drafts: new Map(), pending: new Map(), imports: new Map(), timer: null, loading: false };
  const scopeLabels = { project: '项目', team: '团队', firm: '律所' };
  const privateAgent = (c = state.active) => !!c?.agent && (c.agent.private || c.type === 'AGENT_DIRECT');
  const conversationLabel = (c) => c.agent ? (privateAgent(c) ? '云端助手私聊 · 仅你可见' : '云端助手群聊 · 群成员可见') : `${c.type === 'DIRECT' ? '私聊' : '群聊'} · ${roles[c.role] || '成员'}`;
  const roles = { OWNER: '负责人', MEMBER: '成员', CLIENT: '客户' };
  const request = (action, params = {}) => awd.call('im.request', { action, params });
  const scope = () => ({ epoch: state.epoch, selection: state.selection, id: state.active?.id });
  const current = (s) => s.epoch === state.epoch && s.selection === state.selection && s.id === state.active?.id;
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  function notice(text = '', error = false) { $('notice').textContent = text; $('notice').dataset.error = String(error); }
  function button(text, action, className) { const el = node('button', text, className); el.type = 'button'; el.addEventListener('click', () => run(el, action)); return el; }
  async function run(el, fn) {
    const s = scope(); el.disabled = true;
    try { await fn(); } catch (error) { if (current(s)) notice(failure(error), true); }
    finally { el.disabled = false; }
  }
  function failure(error) {
    if (error?.code === 'permission_denied') return '没有操作权限，或已不在此会话中。请刷新会话。';
    if (error?.code === 'unknown_method') return '当前客户端不支持项目沟通，请升级至 0.61.0 或更新版本。';
    return typeof error?.message === 'string' && error.message.trim() ? error.message.slice(0, 500) : '操作未完成，请检查连接后重试。草稿仍保留在当前会话。';
  }
  function syncHostSidebar(extra = {}) {
    if (!state.context?.projectId) return;
    awd.call('sidebar.sync', {
      projectId: state.context.projectId,
      activeConversationId: state.active?.id || '',
      conversations: state.conversations,
      agents: state.agents,
      projectReason: state.projectAgentReason,
      directory: state.directory,
      ...extra,
    }).catch(() => {});
  }
  // 通讯录只展示宿主给的真实数据（im.directory）；拿不到就显示空态与去设置的入口，绝不编造联系人。
  function normalizeDirectory(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const list = (v) => (Array.isArray(v) ? v : []);
    return {
      me: r.me && typeof r.me === 'object' ? r.me : null,
      organization: r.organization && typeof r.organization === 'object' ? { ...r.organization, members: list(r.organization.members) } : null,
      firm: r.firm && typeof r.firm === 'object' ? { ...r.firm, teams: list(r.firm.teams) } : null,
      projectColleagues: list(r.projectColleagues),
      friends: list(r.friends),
      capabilities: r.capabilities && typeof r.capabilities === 'object' ? r.capabilities : {},
      errors: list(r.errors),
    };
  }
  async function loadDirectory(epoch = state.epoch) {
    if (!state.context?.projectId) return;
    try {
      const res = await awd.call('im.directory', { action: 'get' });
      if (epoch !== state.epoch) return;
      state.directory = normalizeDirectory(res);
    } catch {
      if (epoch !== state.epoch) return;
      state.directory = normalizeDirectory(null);
      state.directory.errors = ['directory'];
    }
    renderDirectory();
  }
  function openOrgSettings() { return awd.call('im.directory', { action: 'openOrgSettings' }); }
  // 新建会话后，负责人需把邀请码交给对方才算真正连上——这里如实引导到成员与邀请码，不假装已送达。
  async function createAndInvite(title, type, label) {
    const s = scope();
    const created = await request('create', { title, type });
    if (s.epoch !== state.epoch) return;
    await refreshList(s.epoch);
    if (s.epoch !== state.epoch) return;
    const target = state.conversations.find((c) => c.id === created.id) || created;
    await select(target);
    if (state.active?.id !== target.id) return;
    notice(`已创建${label}「${title}」。请生成邀请码交给对方，对方加入后即可开始沟通。`);
    if (state.active.role === 'OWNER') await membersDialog();
  }
  async function startDirectChat(contact) {
    if (!state.context?.projectId || !contact) return;
    const targetName = String(contact.name || '').trim();
    if (!targetName) return;
    const existing = state.conversations.find((c) => c.type === 'DIRECT' && c.title === targetName);
    if (existing) { await select(existing); return; }
    await createAndInvite(targetName, 'DIRECT', '私聊');
  }
  async function startGroupChat(groupTitle) {
    if (!state.context?.projectId) return;
    const titleText = String(groupTitle || '').trim().slice(0, 120);
    if (!titleText) return;
    const existing = state.conversations.find((c) => c.type === 'GROUP' && c.title === titleText);
    if (existing) { await select(existing); return; }
    await createAndInvite(titleText, 'GROUP', '群聊');
  }
  function matches(query, ...parts) { return !query || parts.filter(Boolean).join(' ').toLowerCase().includes(query); }
  // 顶部组织身份卡（飞书式租户切换入口）：当前团队 · 律所；切换在宿主「设置 › 团队」完成。
  function renderOrgSwitcher() {
    const el = $('org-switcher'); if (!el) return;
    el.replaceChildren();
    const dir = state.directory;
    if (!dir) return;
    const org = dir.organization, firm = dir.firm, cap = dir.capabilities || {};
    const card = node('div', null, 'org-card');
    const text = node('div', null, 'org-card-text');
    text.append(node('strong', org ? (org.name || '未命名团队') : '尚未加入团队'));
    const parts = [];
    if (org && org.myRoleLabel) parts.push(org.myRoleLabel);
    parts.push(firm ? `律所：${firm.name || '未命名律所'}${firm.isHead ? '（总部团队）' : ''}` : (org ? '未并入律所' : '加入团队后可看到同事'));
    text.append(node('small', parts.join(' · ')));
    card.append(node('span', org ? (org.name || '团').slice(0, 1) : '无', 'org-card-avatar'), text,
      button('团队与律所设置', () => openOrgSettings(), 'org-switch-btn'));
    el.append(card);
    let hint = '';
    if (!org) hint = '在「设置 › 团队」创建团队或用邀请码加入。';
    else if (cap.isTeamOwner && !firm) hint = '你是团队负责人，可在「设置 › 团队」创建律所或用律所邀请码并入。';
    else if (cap.isTeamOwner && firm && firm.isHead) hint = '总部团队不能退出律所；团队负责人不能切换到其他团队。';
    else if (cap.isTeamOwner) hint = '团队负责人不能切换团队；可在「设置 › 团队」把本团队切换到其他律所。';
    else hint = '一个账户同一时间只属于一个团队。切换团队会退出当前团队，已有会话按会话成员身份保留。';
    el.append(node('p', hint, 'hint org-hint'));
    if ((dir.errors || []).includes('team') || (dir.errors || []).includes('directory')) el.append(node('p', '团队信息暂时取不到，稍后点「刷新会话」重试。', 'hint org-hint'));
  }
  function directoryGroups(dir) {
    const org = dir.organization, firm = dir.firm;
    return [
      { key: 'project', tag: '项', label: '当前项目', sub: '项目成员',
        empty: '项目中暂无其他成员。', emptyAction: null,
        rows: dir.projectColleagues.filter((m) => String(m.id) !== String(dir.me?.id)).map((m) => ({ name: m.name, meta: m.roleLabel, contact: m })),
        group: '' },
      { key: 'org', tag: '团', label: '我的团队', sub: org ? org.name : '尚未加入团队',
        empty: org ? '团队里暂时只有你。' : '尚未加入团队。',
        emptyAction: org ? null : ['去创建或加入', openOrgSettings],
        rows: (org ? org.members : []).filter((m) => !m.isMe).map((m) => ({ name: m.name, meta: m.roleLabel, contact: m })),
        group: org && org.name ? `${org.name} · 团队群` : '' },
      { key: 'firm', tag: '所', label: '我的律所', sub: firm ? firm.name : (org ? '本团队未并入律所' : '加入团队后可并入律所'),
        empty: firm ? '律所下暂无其他团队。' : '本团队尚未并入律所。',
        emptyAction: firm || !org ? null : ['去设置', openOrgSettings],
        rows: (firm ? firm.teams : []).map((t) => ({ name: t.name, meta: [t.isHead ? '总部团队' : '成员团队', t.isMine ? '本团队' : '', t.memberCount != null ? `${t.memberCount} 人` : ''].filter(Boolean).join(' · '), team: t })),
        group: firm && firm.name ? `${firm.name} · 律所协作群` : '' },
      { key: 'friends', tag: '友', label: '其他联系人', sub: '个人通讯录与项目客户',
        empty: '还没有其他联系人。添加外部律师、客户或专家后可一键发起私聊。',
        emptyAction: ['添加联系人', () => addFriendDialog()],
        rows: dir.friends.map((f) => ({ name: f.name, meta: [f.roleLabel, f.org].filter(Boolean).join(' · ') || (f.source === 'project' ? '当前项目客户' : ''), contact: f })),
        group: '' },
    ];
  }
  function renderDirectory() {
    renderOrgSwitcher();
    const dir = state.directory || normalizeDirectory(null);
    const query = ($('search')?.value || '').trim().toLowerCase();
    const groupsEl = $('directory-groups');
    const groups = directoryGroups(dir);
    if (groupsEl) {
      groupsEl.replaceChildren();
      for (const g of groups) {
        const rows = g.rows.filter((r) => matches(query, r.name, r.meta));
        const expanded = query ? rows.length > 0 : !!state.expandedGroups[g.key];
        const wrap = node('div', null, 'dir-group' + (expanded ? ' is-open' : ''));
        const toggle = node('button', null, 'dir-group-toggle'); toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.append(node('span', g.tag, `dir-badge dir-badge--${g.key}`), node('span', g.label, 'dir-group-name'), node('span', String(rows.length), 'dir-group-count'));
        toggle.addEventListener('click', () => { state.expandedGroups[g.key] = !state.expandedGroups[g.key]; renderDirectory(); });
        wrap.append(toggle);
        if (expanded) {
          const body = node('div', null, 'dir-group-body');
          body.append(node('small', g.sub || '', 'dir-group-sub'));
          for (const r of rows) {
            const row = node('div', null, 'dir-member');
            const info = node('div', null, 'dir-member-info'); info.append(node('strong', r.name), node('small', r.meta || ''));
            row.append(node('span', r.name.slice(0, 1), `dir-member-avatar is-${g.key}`), info);
            if (r.contact) row.append(button('发消息', () => startDirectChat(r.contact), 'dir-chat-btn'));
            else if (r.team) row.append(button('发起群聊', () => startGroupChat(`${r.team.name} · 协作群`), 'dir-chat-btn'));
            body.append(row);
          }
          if (!g.rows.length) {
            body.append(node('p', g.empty, 'hint'));
            if (g.emptyAction) body.append(button(g.emptyAction[0], g.emptyAction[1], 'dir-group-action'));
          } else if (g.group && g.key === 'org') body.append(button('发起群聊', () => startGroupChat(g.group), 'dir-group-action'));
          wrap.append(body);
        }
        groupsEl.append(wrap);
      }
    }
  }

  async function loadAgentScopes(epoch = state.epoch) {
    const result = await request('agentScopes'); if (epoch !== state.epoch) return;
    state.agents = Array.isArray(result.agents) ? result.agents : [];
    state.projectAgentReason = typeof result.projectReason === 'string' ? result.projectReason : '';
    renderAgents(); syncHostSidebar();
  }
  function renderAgents() {
    const el = $('agents'); el.replaceChildren();
    const query = $('search').value.trim().toLowerCase();
    for (const agent of state.agents.filter((a) => matches(query, a.name, a.title, scopeLabels[a.scope]) && !state.conversations.some((c) => c.agent && !privateAgent(c) && c.agent.scope === a.scope && c.agent.scopeKey === a.scopeKey))) {
      const row = button('', () => openAgent(agent), 'agent-entry');
      row.append(node('span', 'AI', 'avatar'), node('span', agent.name || `${scopeLabels[agent.scope]}助手`, 'agent-name'), node('small', scopeLabels[agent.scope] || ''));
      el.append(row);
    }
    if (state.projectAgentReason) el.append(node('p', state.projectAgentReason, 'hint'));
    el.hidden = !el.children.length;
  }
  async function openAgent(agent, isPrivate = false) {
    const s = scope(), sequence = ++state.agentOpenSequence;
    if (!state.self || !state.context?.projectId) throw new Error('请先连接项目沟通账户。');
    const conversation = await request('ensureAgent', { scope: agent.scope, scopeKey: agent.scopeKey, title: agent.title || agent.name, private: isPrivate });
    if (s.epoch !== state.epoch || s.selection !== state.selection || sequence !== state.agentOpenSequence) return;
    await refreshList(s.epoch);
    if (s.epoch !== state.epoch || s.selection !== state.selection || sequence !== state.agentOpenSequence) return;
    if (!state.conversations.some((c) => c.id === conversation.id)) state.conversations.push(conversation);
    await select(conversation);
  }
  function renderAgentInfo(c) {
    $('agent-info').hidden = !c.agent;
    if (!c.agent) return;
    const projectPrivate = privateAgent(c) && c.agent.scope === 'project';
    $('agent-info-summary').textContent = privateAgent(c)
      ? (projectPrivate ? '使用平台 AI 额度，结合你可读的当前项目资料在云端回复。' : '使用平台 AI 额度，结合本层级共享信息在云端回复。')
      : '使用平台 AI 额度，结合本群公开材料在云端回复。';
    $('agent-info-detail').textContent = projectPrivate
      ? '项目概况、文件目录及部分材料正文会随提问发送；不使用本机选择的模型。'
      : (privateAgent(c) ? '结合云端的团队或律所共享信息；不使用本机选择的模型。' : '群内消息与已公开的附件可用于回复；团队与律所助手还会结合本层级共享信息。不使用本机选择的模型。');
    $('agent-info').querySelector('details').open = false;
  }
  function failedReplies(conversationId = state.active?.id) {
    if (!state.agentFailures.has(conversationId)) state.agentFailures.set(conversationId, new Map());
    return state.agentFailures.get(conversationId);
  }
  function ownMessage(messageId) {
    return state.messages.find((m) => m.id === messageId && m.actorType !== 'AGENT' && String(m.senderId) === String(state.self?.id));
  }
  function applyAgentStatus(status) {
    state.agentStatus = status;
    if (!status) return;
    if (status.status === 'failed' && ownMessage(status.messageId)) failedReplies().set(status.messageId, { ...status, source: ownMessage(status.messageId) });
    else if (status.status !== 'failed') failedReplies().delete(status.messageId);
  }
  function renderAgentStatus() {
    const el = $('agent-status'); el.replaceChildren();
    const status = state.agentStatus;
    const running = ['queued', 'running'].includes(status?.status);
    const busy = state.agentRequesting || running;
    const failures = new Map(state.agentFailures.get(state.active?.id) || []);
    if (status?.status === 'failed' && !failures.has(status.messageId)) failures.set(status.messageId, status);
    $('agent-reply').hidden = !state.active?.agent;
    $('agent-reply').disabled = busy || !lastOwnMessageId();
    el.hidden = !state.active?.agent || (!busy && !failures.size);
    if (el.hidden) return;
    if (running) el.append(node('span', status.status === 'running' ? '助手正在回复…' : '正在等待助手回复…'));
    else if (state.agentRequesting) el.append(node('span', '正在请求助手回复…'));
    for (const failed of failures.values()) {
      const row = node('div', null, 'agent-failure');
      const source = ownMessage(failed.messageId) || failed.source, text = source?.text?.trim();
      const preview = text ? `「${text.slice(0, 48)}${text.length > 48 ? '…' : ''}」：` : '';
      row.append(node('span', preview + (failed.error || '助手暂未完成回复。')));
      if (source) {
        const retry = button('重试助手回复', () => requestAgentReply(failed.messageId)); retry.disabled = busy; row.append(retry);
      }
      el.append(row);
    }
  }
  function lastOwnMessageId() {
    return state.messages.findLast((m) => m.actorType !== 'AGENT' && String(m.senderId) === String(state.self?.id))?.id;
  }
  async function requestAgentReply(messageId) {
    if (!state.active?.agent || !messageId) return;
    const s = scope(), source = ownMessage(messageId);
    if (state.agentRequesting) {
      failedReplies(s.id).set(messageId, { messageId, source, error: '助手请求正在处理中，请稍后重试。' });
      renderAgentStatus(); return;
    }
    state.agentRequesting = true; renderAgentStatus();
    try {
      const result = await request('agentReply', { conversationId: s.id, messageId });
      if (s.epoch !== state.epoch) return;
      failedReplies(s.id).delete(messageId);
      if (current(s)) applyAgentStatus({ ...result, status: result.status || 'queued', messageId });
    } catch (error) {
      if (s.epoch === state.epoch) failedReplies(s.id).set(messageId, { messageId, source, error: failure(error) });
    } finally {
      if (current(s)) { state.agentRequesting = false; renderAgentStatus(); }
    }
  }
  async function replyAfterSend(message) {
    if (!state.active?.agent) return;
    const s = scope();
    if (privateAgent()) { await requestAgentReply(message.id); return; }
    try {
      const result = await request('members', { conversationId: s.id });
      if (!current(s)) return;
      const humanCount = Number.isFinite(result.humanCount) ? result.humanCount : (result.members || []).filter((m) => m.actorType !== 'AGENT').length;
      if (humanCount === 1) await requestAgentReply(message.id);
    } catch { if (current(s)) notice('消息已发送。可点击「请助手回复」继续。'); }
  }
  function draft() {
    const id = state.active?.id;
    if (!state.drafts.has(id)) state.drafts.set(id, { text: '', file: null });
    return state.drafts.get(id);
  }
  function showDraft() {
    const d = draft(); $('draft').value = d.text; $('attachment').hidden = !d.file;
    $('attachment-name').textContent = d.file?.name || '';
  }
  function renderList() {
    renderDirectory(); renderAgents();
    $('conversations').replaceChildren();
    const query = $('search').value.trim().toLowerCase();
    const items = state.conversations.filter((c) => c.title.toLowerCase().includes(query));
    if ($('conv-count')) $('conv-count').textContent = String(items.length);
    $('empty-list').hidden = !!items.length;
    $('empty-list').textContent = query ? '没有匹配的会话。' : '还没有会话。新建会话，或用邀请码加入。';
    for (const c of items) {
      const el = button('', () => select(c), 'conversation'); el.setAttribute('aria-pressed', String(c.id === state.active?.id));
      el.append(node('span', c.agent ? 'AI' : (c.type === 'DIRECT' ? '私' : '群'), 'avatar'));
      const text = node('span', null, 'conversation-text'); text.append(node('strong', c.title), node('small', conversationLabel(c))); el.append(text);
      if (c.unreadCount) el.append(node('span', c.unreadCount > 99 ? '99+' : c.unreadCount, 'unread'));
      $('conversations').append(el);
    }
  }
  async function refreshList(epoch = state.epoch) {
    const result = await request('list'); if (epoch !== state.epoch) return;
    state.conversations = result.conversations || [];
    if (state.active && !state.conversations.some((c) => c.id === state.active.id)) clearChat();
    else if (state.active) state.active = state.conversations.find((c) => c.id === state.active.id);
    renderList();
    syncHostSidebar();
  }
  function clearChat() {
    state.selection++; state.active = null; state.messages = []; state.loading = false; state.agentStatus = null; state.agentRequesting = false;
    $('active-chat').hidden = true; $('welcome').hidden = false; $('workspace').classList.remove('chat-open');
    $('messages').replaceChildren(); closeDialog(); finishConfirmation(false);
    renderList();
    syncHostSidebar();
  }
  async function select(c) {
    state.selection++; state.active = c; state.messages = []; state.loading = false; state.agentStatus = null; state.agentRequesting = false;
    $('workspace').classList.add('chat-open'); $('welcome').hidden = true; $('active-chat').hidden = false;
    $('chat-title').textContent = c.title; $('chat-subtitle').textContent = conversationLabel(c);
    renderAgentInfo(c);
    $('agent-private').hidden = !c.agent || privateAgent(c);
    $('project-bar').hidden = privateAgent(c);
    document.querySelector('.composer-tools').hidden = privateAgent(c);
    $('members-button').hidden = privateAgent(c);
    $('empty-messages').textContent = c.agent ? (privateAgent(c) ? '与助手开始私聊；这段对话仅你可见。' : '助手已加入本群。只有你一人时会自动回复；有其他成员时，发送后点击「请助手回复」。') : '还没有消息，打个招呼吧。';
    $('draft').placeholder = c.agent ? (privateAgent(c) ? '与助手私聊，仅你可见…' : '向群成员和助手发送消息…') : '输入消息…';
    $('binding').textContent = c.agent ? '群内回复供成员查看；个人项目资料可在助手私聊中讨论。' : '可关联当前项目，或将聊天记录归档到项目。'; $('older').hidden = true;
    showDraft(); renderList(); renderMessages(); closeDialog();
    syncHostSidebar();
    await loadMessages('initial');
  }
  async function loadMessages(mode = 'new') {
    if (!state.active || state.loading) return;
    const s = scope(); state.loading = true;
    const params = { conversationId: s.id, limit: 50 };
    if (mode === 'new' && state.messages.length) params.afterId = Math.max(...state.messages.map((m) => m.id));
    if (mode === 'older' && state.messages.length) params.beforeId = Math.min(...state.messages.map((m) => m.id));
    try {
      const result = await request('messages', params); if (!current(s)) return;
      const oldHeight = $('message-scroll').scrollHeight, oldTop = $('message-scroll').scrollTop;
      const nearBottom = oldHeight - oldTop - $('message-scroll').clientHeight < 90;
      const previousMessages = JSON.stringify(state.messages);
      const merged = new Map(state.messages.map((m) => [m.id, m]));
      for (const m of result.messages || []) merged.set(m.id, m);
      state.messages = [...merged.values()].sort((a, b) => a.id - b.id);
      if (!state.agentRequesting && Object.prototype.hasOwnProperty.call(result, 'agentStatus')) applyAgentStatus(result.agentStatus);
      renderAgentStatus();
      if (mode === 'initial' || mode === 'older') $('older').hidden = !result.hasMore;
      // Reconcile an uncertain send response against server acknowledgements.
      const pending = state.pending.get(s.id) || [];
      state.pending.set(s.id, pending.filter((p) => !state.messages.some((m) => m.clientMessageId === p.clientMessageId && String(m.senderId) === String(state.self.id))));
      if (JSON.stringify(state.messages) !== previousMessages || pending.length !== state.pending.get(s.id).length || mode === 'initial') renderMessages();
      if (mode === 'older') $('message-scroll').scrollTop = oldTop + $('message-scroll').scrollHeight - oldHeight;
      else if (mode === 'initial' || nearBottom) $('message-scroll').scrollTop = $('message-scroll').scrollHeight;
      if (document.visibilityState !== 'hidden' && document.hasFocus() && state.messages.length) {
        await request('read', { conversationId: s.id, lastReadId: state.messages.at(-1).id });
        if (current(s)) { state.active.unreadCount = 0; renderList(); }
      }
    } finally { if (current(s)) state.loading = false; }
  }
  function time(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function renderMessages() {
    $('messages').replaceChildren();
    for (const message of state.messages) {
      const row = node('article', null, 'message' + (String(message.senderId) === String(state.self?.id) ? ' mine' : ''));
      row.append(node('div', `${message.senderName || message.agentName || '成员'}${message.actorType === 'AGENT' ? ' · AI 助手' : ''} · ${time(message.createdAt)}`, 'message-meta'));
      const bubble = node('div', null, 'bubble'); if (message.text) bubble.append(node('div', message.text));
      if (message.attachment) bubble.append(fileCard(message.attachment));
      row.append(bubble); $('messages').append(row);
    }
    for (const pending of state.pending.get(state.active?.id) || []) {
      const row = node('article', null, 'message mine'); row.append(node('div', pending.text || pending.file?.name || '文件', 'bubble'));
      const status = node('div', pending.sending ? '发送中…' : '发送未确认', 'send-failure');
      if (!pending.sending) status.append(button('重试发送', () => transmit(pending)));
      row.append(status); $('messages').append(row);
    }
    $('empty-messages').hidden = !!$('messages').children.length;
    renderAgentStatus();
  }
  function fileCard(file) {
    const s = scope(), key = `${s.id}:${file.id}`;
    if (file.available === false) {
      const unavailable = node('div', null, 'file-card');
      unavailable.append(node('span', '项目文件', 'file-name'), node('p', '文件待准备', 'hint'));
      unavailable.append(button('查看文件', () => notice('抱歉文件还在准备中，请联系您的律师。')));
      return unavailable;
    }
    const card = node('div', null, 'file-card'); card.append(node('span', file.name, 'file-name'), node('small', `${Math.ceil((file.size || 0) / 1024)} KB`));
    if (file.source) card.append(node('p', '项目文件引用 · 发送时版本', 'hint'));
    card.append(node('p', file.clientVisible ? '客户可见' : '内部文件 · 客户需单独授权', 'hint'));
    const actions = node('div', null, 'file-actions'); const imported = state.imports.get(key);
    actions.append(button('下载', async () => {
      const result = await awd.call('im.downloadAttachment', { conversationId: s.id, attachmentId: file.id });
      if (current(s) && result.started) notice('已发起下载，请在保存对话框或浏览器下载列表中确认结果。');
    }));
    if (state.active.role === 'CLIENT') { card.append(node('p', '可下载已开放或本人上传的文件。', 'hint'), actions); return card; }
    if (!imported) {
      actions.append(button('存入项目', async () => {
        if (!await confirmAction('文件将保存到当前项目，项目成员可读取，并可随 Git 同步。继续存入？')) return;
        const result = await request('import', { conversationId: s.id, attachmentId: file.id }); if (!current(s)) return;
        state.imports.set(key, result); renderMessages(); notice('文件已存入项目，可打开、添加到 AI 或拖拽到 AI。');
      }));
      card.append(node('p', '先存入项目，再打开或交给 AI。', 'hint'));
    } else {
      actions.append(button('打开', () => awd.ui.openFile(imported.path)), button('添加到 AI', () => awd.call('chat.addFile', { path: imported.path })));
      const drag = button('拖到 AI', async () => { await prepare(); if (current(s)) notice('已准备好，按住此按钮拖到 AI 对话。'); }, 'drag-file');
      drag.draggable = true; drag.title = '按住并拖到右侧 AI 对话'; let payload = null, preparing = null;
      async function prepare() {
        if (payload && !payload.hostHandle && payload.expiresAt > Date.now() + 1000) return;
        if (!preparing) preparing = awd.call('files.prepareDrag', { path: imported.path, rect: (() => { const r = drag.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })() }).then((p) => { if (current(s)) payload = p; }).finally(() => { preparing = null; });
        return preparing;
      }
      const warm = () => prepare().catch(() => { if (current(s)) notice('拖拽准备失败，可点击“添加到 AI”。', true); });
      drag.addEventListener('pointerenter', warm); drag.addEventListener('pointerdown', warm); drag.addEventListener('focus', warm);
      drag.addEventListener('dragstart', (event) => {
        if (!current(s) || !payload || payload.expiresAt <= Date.now()) { event.preventDefault(); warm(); notice('正在准备文件，请稍后再拖一次。'); return; }
        event.dataTransfer.effectAllowed = 'copy'; const value = JSON.stringify(payload);
        event.dataTransfer.setData('application/x-checkba-file', value); event.dataTransfer.setData('text/checkba-file-json', value);
        event.dataTransfer.setData(payload.dragType, payload.dragToken);
      });
      drag.addEventListener('dragend', () => { payload = null; awd.call('files.endDrag', {}).catch(() => {}); }); actions.append(drag);
    }
    if (file.canManageAccess && state.active.role !== 'CLIENT' && !privateAgent()) actions.append(button(file.clientVisible ? '设为内部' : '客户可见', async () => {
      const opening = !file.clientVisible;
      const text = opening ? '开放后，该会话的客户可打开此引用版本。继续开放？' : '设为内部后，客户将无法继续下载。已经保存的副本无法收回。继续？';
      if (!await confirmAction(text) || !current(s)) return;
      await request('fileAccess', { conversationId: s.id, attachmentId: file.id, clientVisible: opening });
      if (!current(s)) return;
      await refreshLoadedMessages(); if (current(s)) notice(opening ? '此版本已向会话客户开放。' : '此版本已设为内部。已保存的副本无法收回。');
    }));
    card.append(actions); return card;
  }
  async function refreshLoadedMessages() {
    const s = scope(); if (!state.messages.length) return loadMessages('initial');
    const firstId = state.messages[0].id, lastId = state.messages.at(-1).id;
    let cursor = firstId - 1; const refreshed = new Map();
    while (cursor < lastId) {
      const result = await request('messages', { conversationId: s.id, afterId: cursor, limit: 100 });
      if (!current(s)) return;
      const messages = result.messages || []; if (!messages.length) break;
      for (const message of messages) refreshed.set(message.id, message);
      const next = Math.max(...messages.map((m) => m.id)); if (next <= cursor) break; cursor = next;
    }
    if (current(s)) { state.messages = [...refreshed.values()].sort((a, b) => a.id - b.id); renderMessages(); }
  }
  async function transmit(pending) {
    if (pending.sending) return;
    const s = scope(); pending.sending = true; renderMessages();
    try {
      const params = { conversationId: s.id, clientMessageId: pending.clientMessageId, text: pending.text };
      if (pending.file?.path) params.path = pending.file.path;
      else if (pending.file) {
        if (!pending.attachmentId) {
          const base64 = await readBase64(pending.file); if (!current(s)) return;
          const attachment = await request('upload', { conversationId: s.id, name: pending.file.name, base64, clientMessageId: pending.clientMessageId }); if (!current(s)) return;
          pending.attachmentId = attachment.id;
        }
        params.attachmentId = pending.attachmentId;
      }
      const message = await request(params.path ? 'sendFile' : 'send', params); if (!current(s)) return;
      state.pending.set(s.id, (state.pending.get(s.id) || []).filter((p) => p !== pending));
      if (!state.messages.some((m) => m.id === message.id)) state.messages.push(message);
      notice();
      await replyAfterSend(message);
    } catch (error) { if (current(s)) notice(failure(error), true); }
    finally { pending.sending = false; if (s.epoch === state.epoch && state.active?.id === s.id) { renderMessages(); $('message-scroll').scrollTop = $('message-scroll').scrollHeight; } }
  }
  function readBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
  async function send() {
    if (!state.active) return;
    const d = draft(); if (!d.text.trim() && !d.file) return;
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const clientMessageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const pending = { text: d.text, file: d.file, clientMessageId, sending: false };
    const items = state.pending.get(state.active.id) || []; items.push(pending); state.pending.set(state.active.id, items);
    d.text = ''; d.file = null; showDraft(); await transmit(pending);
  }
  let confirmationResolve = null;
  function finishConfirmation(value) {
    if ($('confirmation').close) $('confirmation').close(); else $('confirmation').removeAttribute('open');
    const resolve = confirmationResolve; confirmationResolve = null; if (resolve) resolve(value);
  }
  function confirmAction(text) {
    finishConfirmation(false); $('confirmation-text').textContent = text;
    if ($('confirmation').showModal) $('confirmation').showModal(); else $('confirmation').setAttribute('open', '');
    $('confirmation-cancel').focus();
    return new Promise((resolve) => { confirmationResolve = resolve; });
  }
  $('confirmation-ok').addEventListener('click', () => finishConfirmation(true));
  $('confirmation-cancel').addEventListener('click', () => finishConfirmation(false));
  $('confirmation').addEventListener('cancel', (event) => { event.preventDefault(); finishConfirmation(false); });
  let dialogAction = null, dialogScope = null;
  function closeDialog() { if ($('dialog').close) $('dialog').close(); else $('dialog').removeAttribute('open'); dialogAction = null; }
  function dialog(title, submit, action) {
    closeDialog(); dialogScope = scope(); $('dialog-title').textContent = title; $('dialog-body').replaceChildren(); $('dialog-error').textContent = '';
    $('dialog-submit').textContent = submit; $('dialog-submit').hidden = !action; $('dialog-submit').disabled = false; dialogAction = action;
    if ($('dialog').showModal) $('dialog').showModal(); else $('dialog').setAttribute('open', '');
  }
  function field(label, tag = 'input') { const wrap = node('label', label), input = node(tag); wrap.append(input); $('dialog-body').append(wrap); return input; }
  function selectField(label, options) { const input = field(label, 'select'); for (const [value, title] of options) { const option = node('option', title); option.value = value; input.append(option); } return input; }
  function createDialog() {
    let title, type;
    dialog('新建会话', '创建并邀请', async () => {
      if (!title.value.trim()) throw new Error('请输入会话名称。');
      const s = scope(), c = await request('create', { title: title.value.trim(), type: type.value }); if (!current(s)) return;
      closeDialog(); await refreshList(s.epoch); if (!current(s)) return; await select(c); if (s.epoch !== state.epoch || state.active?.id !== c.id) return; await membersDialog();
    });
    title = field('会话名称'); title.maxLength = 120; title.required = true;
    type = selectField('会话类型', [['GROUP', '群聊'], ['DIRECT', '私聊（最多两人）']]);
    $('dialog-body').append(node('p', '创建后，将邀请码交给对方；同事和客户均可加入，无需属于同一律所。', 'hint')); title.focus();
  }
  function joinDialog() {
    let code; dialog('邀请码加入', '加入会话', async () => {
      const s = scope(), c = await request('join', { code: code.value.trim() }); if (!current(s)) return;
      closeDialog(); await refreshList(s.epoch); if (!current(s)) return; await select(c);
    }); code = field('邀请码'); code.required = true; code.autocomplete = 'off'; code.maxLength = 100; code.focus();
  }
  function addFriendDialog() {
    let nameInput, roleInput, orgInput;
    dialog('添加联系人', '保存到通讯录', async () => {
      const name = nameInput.value.trim();
      if (!name) throw new Error('请输入联系人姓名。');
      const s = scope();
      const res = await awd.call('im.directory', { action: 'addFriend', name, roleLabel: roleInput.value.trim(), org: orgInput.value.trim() });
      if (!current(s)) return;
      state.directory = normalizeDirectory(res);
      state.expandedGroups.friends = true; $('directory').open = true;
      closeDialog(); renderDirectory(); syncHostSidebar();
      notice(`已将「${name}」添加到其他联系人。`);
    });
    nameInput = field('姓名 / 称呼'); nameInput.maxLength = 64; nameInput.required = true;
    roleInput = field('角色（选填）'); roleInput.maxLength = 32; roleInput.placeholder = '如：外部合作律师 / 客户 / 行业专家';
    orgInput = field('所属单位（选填）'); orgInput.maxLength = 80;
    $('dialog-body').append(node('p', '这些联系人属于你的个人通讯录，只保存在本机当前账户下；切换团队或律所不影响。', 'hint'));
    nameInput.focus();
  }
  async function membersDialog() {
    const s = scope(); const result = await request('members', { conversationId: s.id }); if (!current(s)) return;
    dialog('会话成员', '', null);
    for (const m of result.members || []) {
      const row = node('div', null, 'member-row'); row.append(node('span', `${m.displayName || m.name || m.id || '助手'} · ${m.actorType === 'AGENT' ? 'AI 助手' : (roles[m.role] || '成员')}`));
      if (!privateAgent() && m.actorType !== 'AGENT' && state.active.role === 'OWNER' && m.role !== 'OWNER') row.append(button('移除', async () => {
        if (!await confirmAction('将该成员移出当前会话？')) return;
        await request('removeMember', { conversationId: s.id, userId: m.id }); if (current(s)) await membersDialog();
      })); $('dialog-body').append(row);
    }
    if (!privateAgent() && (!state.active.agent || state.active.agent.scope === 'project') && state.active.role === 'OWNER') {
      const body = $('dialog-body');
      const role = selectField('邀请身份', [['MEMBER', '成员'], ['CLIENT', '客户']]);
      const actions = node('div', null, 'dialog-actions'); actions.append(button('生成邀请码', async () => {
        const invite = await request('invite', { conversationId: s.id, role: role.value }); if (!current(s) || !$('dialog').open || !body.contains(role)) return;
        const old = $('invite-result'); if (old) old.remove();
        const box = node('div'); box.id = 'invite-result'; const input = node('input'); input.value = invite.code; input.readOnly = true; input.setAttribute('aria-label', '生成的邀请码'); box.append(input);
        box.append(node('p', '持码人可加入会话并查看历史消息。文件按访问权限开放，请仅交给预期成员。有效期至 ' + time(invite.expiresAt), 'hint'));
        box.append(button('复制邀请码', async () => {
          input.focus(); input.select();
          try { await navigator.clipboard.writeText(invite.code); notice('邀请码已复制。'); }
          catch { if (document.execCommand && document.execCommand('copy')) notice('邀请码已复制。'); else notice('邀请码已选中，请按 Ctrl/Cmd+C 复制。'); }
        })); $('dialog-body').append(box);
      })); $('dialog-body').append(actions);
    }
    const canLeave = !privateAgent() && !(state.active.agent?.scope === 'project' && state.active.role === 'OWNER');
    if (canLeave && state.active.role === 'OWNER') $('dialog-body').append(node('p', '负责人需先移除其他成员，才能退出会话。', 'hint'));
    if (canLeave) $('dialog-body').append(button('退出会话', async () => {
      if (!await confirmAction('退出后将无法继续查看会话。确定退出？')) return;
      await request('leave', { conversationId: s.id }); if (!current(s)) return;
      state.drafts.delete(s.id); state.pending.delete(s.id); state.agentFailures.delete(s.id); clearChat(); await refreshList(); notice('已退出会话。');
    }));
  }
  async function projectFilesDialog() {
    const s = scope(), files = await awd.files.list(); if (!current(s)) return;
    let input; dialog('引用项目文件', '选用文件', async () => {
      const file = files.find((f) => f.path === input.value); if (!file) return;
      draft().file = { path: file.path, name: file.name }; showDraft(); closeDialog();
    }); input = selectField('项目文件', files.filter((f) => !f.isDirectory && !f.isFolder).map((f) => [f.path, f.path]));
    if (!input.options.length) { $('dialog-body').append(node('p', '项目内还没有可发送的文件。', 'hint')); $('dialog-submit').disabled = true; }
    $('dialog-body').append(node('p', '发送的是受控版本快照；源文件后续更改不会自动替换。文件默认供内部成员读取，客户需单独授权；客户本人上传的文件可自行读取。', 'hint'));
  }
  const controlIds = ['new-chat', 'join-chat', 'refresh', 'add-friend', 'directory-home'];
  async function reload() {
    $('workspace').classList.remove('host-sidebar');
    state.context = null;
    const epoch = ++state.epoch; clearTimeout(state.timer); clearChat();
    state.drafts.clear(); state.pending.clear(); state.imports.clear(); state.agentFailures.clear(); state.conversations = []; state.agents = []; state.projectAgentReason = ''; state.self = null; state.directory = null; renderList();
    for (const id of controlIds) if ($(id)) $(id).disabled = true;
    try {
      const context = await awd.call('context.get', {}); if (epoch !== state.epoch) return; state.context = context;
      if (!context.projectId) { notice('请先选择一个项目，再使用项目沟通。'); return; }
      syncHostSidebar();
      const self = await request('self'); if (epoch !== state.epoch) return; state.self = self;
      await loadDirectory(epoch); if (epoch !== state.epoch) return;
      await refreshList(epoch); if (epoch !== state.epoch) return; notice();
      try {
        await loadAgentScopes(epoch); if (epoch !== state.epoch) return;
        const projectAgent = state.agents.find((agent) => agent.scope === 'project');
        if (projectAgent) await openAgent(projectAgent);
      } catch (error) { if (epoch === state.epoch) notice('助手暂不可用：' + failure(error), true); }
    } catch (error) { if (epoch === state.epoch) notice(failure(error), true); }
    finally {
      if (epoch === state.epoch && state.context?.projectId) {
        for (const id of controlIds) if ($(id)) $(id).disabled = false;
        schedule(epoch);
      }
    }
  }
  function schedule(epoch) {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => {
      if (epoch !== state.epoch) return;
      try {
        const self = await request('self'); if (epoch !== state.epoch) return;
        if (!state.self || String(self.id) !== String(state.self.id)) { await reload(); return; }
        await refreshList(epoch); if (epoch !== state.epoch) return;
        await loadMessages();
        if (epoch === state.epoch && document.visibilityState !== 'hidden') await loadMessages('recent');
      } catch (error) { if (epoch === state.epoch) notice(failure(error), true); }
      finally { if (epoch === state.epoch) schedule(epoch); }
    }, 3000);
  }
  async function handleSidebarCommand(payload = {}) {
    const cmd = payload?.command;
    if (!cmd) return;
    if (cmd === 'host-sidebar') {
      if (String(payload.projectId) === String(state.context?.projectId)) $('workspace').classList.toggle('host-sidebar', payload.visible === true);
      return;
    }
    if (cmd === 'select-conversation') {
      const targetId = payload.conversationId;
      let target = state.conversations.find((c) => String(c.id) === String(targetId));
      if (!target && state.context?.projectId) {
        await refreshList();
        target = state.conversations.find((c) => String(c.id) === String(targetId));
      }
      if (target) await select(target);
      return;
    }
    if (cmd === 'open-agent') {
      const agent = state.agents.find((a) => a.scope === payload.scope && a.scopeKey === payload.scopeKey);
      if (!agent) throw new Error('助手信息尚未就绪，请刷新会话后重试。');
      await openAgent(agent, !!payload.private);
      return;
    }
    if (cmd === 'open-new-chat') { createDialog(); return; }
    if (cmd === 'open-join-chat') { joinDialog(); return; }
    if (cmd === 'open-add-friend') { addFriendDialog(); return; }
    if (cmd === 'focus-directory') {
      if (payload.group && Object.prototype.hasOwnProperty.call(state.expandedGroups, payload.group)) {
        state.expandedGroups[payload.group] = true;
      }
      openDirectory();
      return;
    }
    if (cmd === 'refresh-directory') {
      await loadDirectory();
      if (state.context?.projectId) { await refreshList(); await loadAgentScopes(); }
      // 团队 / 律所切换只换通讯录；会话按会话成员身份保留，不清空当前聊天与草稿
      if (payload.reason && payload.reason !== 'manual') notice('团队或律所已变更，通讯录和可访问会话已更新。');
      return;
    }
    if (cmd === 'open-org-settings') { await openOrgSettings(); return; }
    if (cmd === 'start-direct-chat' && payload.contact) {
      await startDirectChat(payload.contact);
      return;
    }
    if (cmd === 'start-group-chat') {
      await startGroupChat(payload.title);
    }
  }
  function openDirectory() {
    if ($('workspace').classList.contains('host-sidebar')) { syncHostSidebar({ directoryOpen: true }); return; }
    renderDirectory();
    $('directory').open = true;
    $('workspace').classList.remove('chat-open');
    $('directory').querySelector('summary').focus();
  }
  $('agent-private').addEventListener('click', () => run($('agent-private'), () => openAgent(state.active.agent, true)));
  $('agent-reply').addEventListener('click', () => requestAgentReply(lastOwnMessageId()));
  $('search').addEventListener('input', () => { if ($('search').value.trim()) $('directory').open = true; renderList(); });
  $('draft').addEventListener('input', () => { if (state.active) draft().text = $('draft').value; });
  $('draft').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); run($('send'), send); } });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); run($('send'), send); });
  $('new-chat').addEventListener('click', createDialog); $('join-chat').addEventListener('click', joinDialog);
  if ($('add-friend')) $('add-friend').addEventListener('click', addFriendDialog);
  if ($('directory-home')) $('directory-home').addEventListener('click', openDirectory);
  $('refresh').addEventListener('click', () => run($('refresh'), async () => { if (!state.self) return reload(); await loadDirectory(); await refreshList(); await refreshLoadedMessages(); notice(); await loadAgentScopes(); }));
  $('back').addEventListener('click', () => $('workspace').classList.remove('chat-open'));
  $('older').addEventListener('click', () => run($('older'), () => loadMessages('older')));
  $('members-button').addEventListener('click', () => run($('members-button'), membersDialog));
  $('local-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', () => { const file = $('file-input').files[0]; $('file-input').value = ''; if (!file || !state.active) return; if (file.size > 8 * 1024 * 1024) { notice('文件超过 8 MB，请选择较小的文件。', true); return; } draft().file = file; showDraft(); notice('发送的是受控版本快照；源文件后续更改不会自动替换。文件默认供内部成员读取，客户需单独授权；客户本人上传的文件可自行读取。'); });
  $('clear-file').addEventListener('click', () => { draft().file = null; showDraft(); });
  $('project-file').addEventListener('click', () => run($('project-file'), projectFilesDialog));
  $('bind').addEventListener('click', () => run($('bind'), async () => { const s = scope(); await request('binding', { conversationId: s.id }); if (!current(s)) return; $('binding').textContent = '已关联当前项目'; notice('会话已关联当前项目，关联记录可纳入版本管理。'); }));
  $('export').addEventListener('click', () => run($('export'), async () => { if (!await confirmAction('会话内容将保存到当前项目，项目成员可读取并随 Git 同步。继续归档？')) return; const s = scope(), result = await request('export', { conversationId: s.id }); if (!current(s)) return; notice('聊天已归档到项目：' + result.path + '。可在版本记录中提交。'); await awd.ui.openFile(result.path); }));
  $('close-dialog').addEventListener('click', closeDialog);
  $('dialog-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const action = dialogAction, s = dialogScope; if (!action || !current(s)) return;
    $('dialog-submit').disabled = true; $('dialog-error').textContent = '';
    try { await action(); } catch (error) { if (current(s)) $('dialog-error').textContent = failure(error); }
    finally { if (current(s)) $('dialog-submit').disabled = false; }
  });
  window.addEventListener('pagehide', () => { state.epoch++; clearTimeout(state.timer); });
  awd.ready().then(() => {
    for (const event of ['project.switched', 'account.changed']) awd.events.on(event, reload);
    awd.events.on('sidebar.command', (payload) => {
      handleSidebarCommand(payload).catch((error) => notice(failure(error), true));
    });
    return reload();
  }).catch((error) => notice(failure(error), true));
}());
