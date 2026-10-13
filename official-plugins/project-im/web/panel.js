// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { epoch: 0, selection: 0, context: null, self: null, conversations: [], active: null,
    messages: [], drafts: new Map(), pending: new Map(), imports: new Map(), timer: null, loading: false };
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
    $('conversations').replaceChildren();
    const query = $('search').value.trim().toLowerCase();
    const items = state.conversations.filter((c) => c.title.toLowerCase().includes(query));
    $('empty-list').hidden = !!items.length;
    $('empty-list').textContent = query ? '没有匹配的会话。' : '暂无会话。创建会话，邀请同事或客户加入。';
    for (const c of items) {
      const el = button('', () => select(c), 'conversation'); el.setAttribute('aria-pressed', String(c.id === state.active?.id));
      el.append(node('span', c.type === 'DIRECT' ? '私' : '群', 'avatar'));
      const text = node('span', null, 'conversation-text'); text.append(node('strong', c.title), node('small', `${c.type === 'DIRECT' ? '私聊' : '群聊'} · ${roles[c.role] || '成员'}`)); el.append(text);
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
  }
  function clearChat() {
    state.selection++; state.active = null; state.messages = []; state.loading = false;
    $('active-chat').hidden = true; $('welcome').hidden = false; $('workspace').classList.remove('chat-open');
    $('messages').replaceChildren(); closeDialog(); finishConfirmation(false);
  }
  async function select(c) {
    state.selection++; state.active = c; state.messages = []; state.loading = false;
    $('workspace').classList.add('chat-open'); $('welcome').hidden = true; $('active-chat').hidden = false;
    $('chat-title').textContent = c.title; $('chat-subtitle').textContent = `${c.type === 'DIRECT' ? '私聊' : '群聊'} · ${roles[c.role] || '成员'}`;
    $('binding').textContent = '会话 ID：' + c.id; $('older').hidden = true;
    showDraft(); renderList(); renderMessages(); closeDialog(); await loadMessages('initial');
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
      row.append(node('div', `${message.senderName || '成员'} · ${time(message.createdAt)}`, 'message-meta'));
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
    if (file.canManageAccess && state.active.role !== 'CLIENT') actions.append(button(file.clientVisible ? '设为内部' : '客户可见', async () => {
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
  async function membersDialog() {
    const s = scope(); const result = await request('members', { conversationId: s.id }); if (!current(s)) return;
    dialog('会话成员', '', null);
    for (const m of result.members || []) {
      const row = node('div', null, 'member-row'); row.append(node('span', `${m.displayName || m.id} · ${roles[m.role] || '成员'}`));
      if (state.active.role === 'OWNER' && m.role !== 'OWNER') row.append(button('移除', async () => {
        if (!await confirmAction('将该成员移出当前会话？')) return;
        await request('removeMember', { conversationId: s.id, userId: m.id }); if (current(s)) await membersDialog();
      })); $('dialog-body').append(row);
    }
    if (state.active.role === 'OWNER') {
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
    if (state.active.role === 'OWNER') $('dialog-body').append(node('p', '负责人需先移除其他成员，才能退出会话。', 'hint'));
    $('dialog-body').append(button('退出会话', async () => {
      if (!await confirmAction('退出后将无法继续查看会话。确定退出？')) return;
      await request('leave', { conversationId: s.id }); if (!current(s)) return;
      state.drafts.delete(s.id); state.pending.delete(s.id); clearChat(); await refreshList(); notice('已退出会话。');
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
  async function reload() {
    const epoch = ++state.epoch; clearTimeout(state.timer); clearChat();
    state.drafts.clear(); state.pending.clear(); state.imports.clear(); state.conversations = []; state.self = null; renderList();
    for (const id of ['new-chat', 'join-chat', 'refresh']) $(id).disabled = true;
    try {
      const context = await awd.call('context.get', {}); if (epoch !== state.epoch) return; state.context = context;
      if (!context.projectId) { notice('请先选择一个项目，再使用项目沟通。'); return; }
      const self = await request('self'); if (epoch !== state.epoch) return; state.self = self;
      await refreshList(epoch); if (epoch !== state.epoch) return; notice();
    } catch (error) { if (epoch === state.epoch) notice(failure(error), true); }
    finally {
      if (epoch === state.epoch && state.context?.projectId) {
        for (const id of ['new-chat', 'join-chat', 'refresh']) $(id).disabled = false;
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
  $('search').addEventListener('input', renderList);
  $('draft').addEventListener('input', () => { if (state.active) draft().text = $('draft').value; });
  $('draft').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); run($('send'), send); } });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); run($('send'), send); });
  $('new-chat').addEventListener('click', createDialog); $('join-chat').addEventListener('click', joinDialog);
  $('refresh').addEventListener('click', () => run($('refresh'), async () => { if (!state.self) return reload(); await refreshList(); await refreshLoadedMessages(); notice(); }));
  $('back').addEventListener('click', () => $('workspace').classList.remove('chat-open'));
  $('older').addEventListener('click', () => run($('older'), () => loadMessages('older')));
  $('members-button').addEventListener('click', () => run($('members-button'), membersDialog));
  $('local-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', () => { const file = $('file-input').files[0]; $('file-input').value = ''; if (!file || !state.active) return; if (file.size > 8 * 1024 * 1024) { notice('文件超过 8 MB，请选择较小的文件。', true); return; } draft().file = file; showDraft(); notice('发送的是受控版本快照；源文件后续更改不会自动替换。文件默认供内部成员读取，客户需单独授权；客户本人上传的文件可自行读取。'); });
  $('clear-file').addEventListener('click', () => { draft().file = null; showDraft(); });
  $('project-file').addEventListener('click', () => run($('project-file'), projectFilesDialog));
  $('bind').addEventListener('click', () => run($('bind'), async () => { const s = scope(), result = await request('binding', { conversationId: s.id }); if (!current(s)) return; $('binding').textContent = '项目唯一标识：' + result.projectUid; notice('会话已关联当前项目，关联记录可纳入版本管理。'); }));
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
    return reload();
  }).catch((error) => notice(failure(error), true));
}());
