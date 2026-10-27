// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import { randomFillSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../web/panel.js', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));
const c1 = { id: 'conversation-a', title: '合成客户沟通', type: 'GROUP', role: 'OWNER', unreadCount: 2 };
const c2 = { id: 'conversation-b', title: '另一会话', type: 'DIRECT', role: 'CLIENT', unreadCount: 0 };
const msg = { id: 3, uid: 'm-3', senderId: 9, senderName: '合成用户', text: '<img src=x onerror=alert(1)>', createdAt: '2026-10-13T09:00:00Z', attachment: { id: 'file-1', name: '<script>合同.docx</script>', size: 1200 } };
async function panel(options = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://plugin.invalid/' });
  const calls = [], events = {}, timers = []; let context = { projectId: 1 }, nextId = 10;
  dom.window.crypto = { getRandomValues: (bytes) => randomFillSync(bytes) };
  const confirmIfNeeded = async () => { await tick(); if (dom.window.document.getElementById('confirmation').hasAttribute('open')) { dom.window.document.getElementById(options.confirm === false ? 'confirmation-cancel' : 'confirmation-ok').click(); await tick(); } };
  dom.window.setTimeout = (cb, ms) => { const timer = { cb, ms }; timers.push(timer); return timer; };
  dom.window.clearTimeout = (timer) => { if (timer) timer.cancelled = true; };
  dom.window.awd = {
    ready: async () => context, events: { on: (event, cb) => { events[event] = cb; } },
    files: { list: async () => [{ path: '材料/合同.docx', name: '合同.docx' }] },
    ui: { openFile: async (path) => { calls.push({ method: 'ui.openFile', path }); } },
    call: async (method, args = {}) => {
      const entry = { method, ...args }; calls.push(entry);
      const custom = await options.call?.(entry); if (custom !== undefined) return custom;
      if (method === 'context.get') return context;
      if (method === 'files.prepareDrag') return { fileId: 8, projectId: 1, name: '合同.docx', dragType: 'application/x-awd-test', dragToken: 'random-ticket', expiresAt: Date.now() + 15000 };
      switch (args.action) {
        case 'self': return { id: 9, displayName: '合成用户' };
        case 'list': return { conversations: [c1, c2].map((c) => ({ ...c })) };
        case 'messages': return { messages: args.params.afterId ? [] : [msg], hasMore: !args.params.beforeId };
        case 'members': return { members: [{ id: 9, displayName: '负责人', role: 'OWNER' }, { id: 10, displayName: '客户', role: 'CLIENT' }] };
        case 'invite': return { code: 'SYNTHETIC-CODE', expiresAt: '2026-10-14T09:00:00Z' };
        case 'create': case 'join': return c1;
        case 'send': case 'sendFile': return { id: nextId++, senderId: 9, text: args.params.text, clientMessageId: args.params.clientMessageId };
        case 'import': return { id: 8, uid: 'f-8', path: '项目沟通/a/file-1/合同.docx' };
        case 'export': return { path: '项目沟通/a/聊天记录.md' };
        case 'binding': return { projectUid: 'p-uid-1' };
        default: return {};
      }
    }
  };
  dom.window.eval(source); await tick();
  const $ = (id) => dom.window.document.getElementById(id);
  return { dom, $, calls, events, timers,
    click: async (id) => { $(id).click(); await confirmIfNeeded(); },
    named: async (label) => { const b = [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent === label); assert.ok(b, `missing ${label}`); b.click(); await confirmIfNeeded(); return b; },
    select: async (n = 0) => { dom.window.document.querySelectorAll('.conversation')[n].click(); await tick(); },
    write: (text) => { $('draft').value = text; $('draft').dispatchEvent(new dom.window.Event('input')); },
    submit: async () => { $('composer').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await tick(); },
    switch: async (next = { projectId: 2 }) => { context = next; await events['project.switched'](); await tick(); },
    poll: async () => { const timer = timers.find((t) => !t.cancelled && !t.ran); timer.ran = true; await timer.cb(); await tick(); }
  };
}
const close = (t, p) => t.after(() => p.dom.window.close());
test('renders safe text, unread counts, own bubbles and preserves conversation drafts', async (t) => {
  const p = await panel(); close(t, p); assert.match(p.$('conversations').textContent, /2/);
  await p.select(); assert.match(p.$('messages').textContent, /<img/); assert.equal(p.$('messages').querySelector('img'), null); assert.equal(p.$('messages').querySelector('script'), null); assert.ok(p.$('messages').querySelector('.mine'));
  p.write('未发草稿'); await p.select(1); assert.equal(p.$('draft').value, ''); await p.select(); assert.equal(p.$('draft').value, '未发草稿');
});
test('uncertain sends retain exact content and reuse client id on explicit retry', async (t) => {
  let fail = true; const p = await panel({ call: ({ action }) => { if (action === 'send' && fail) throw Error('network'); } }); close(t, p);
  await p.select(); p.write('保留全文'); await p.submit(); assert.match(p.$('messages').textContent, /保留全文.*发送未确认/s);
  fail = false; await p.named('重试发送'); const sends = p.calls.filter((c) => c.action === 'send'); assert.equal(sends.length, 2); assert.equal(sends[0].params.clientMessageId, sends[1].params.clientMessageId); assert.equal(sends[1].params.text, '保留全文'); assert.doesNotMatch(p.$('messages').textContent, /发送未确认/);
});
test('IME Enter never sends; Enter sends and Shift+Enter stays a newline', async (t) => {
  const p = await panel(); close(t, p); await p.select(); p.write('输入法');
  for (const props of [{ isComposing: true }, { shiftKey: true }]) p.$('draft').dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Enter', ...props }));
  await tick(); assert.equal(p.calls.filter((c) => c.action === 'send').length, 0);
  p.$('draft').dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Enter' })); await tick(); assert.equal(p.calls.filter((c) => c.action === 'send').length, 1);
});
test('poll uses cursor without replacing file DOM and loads older messages separately', async (t) => {
  const p = await panel(); close(t, p); await p.select(); const card = p.$('messages').querySelector('.file-card');
  await p.poll(); assert.equal(p.timers.at(-1).ms, 3000); assert.ok(p.calls.some((c) => c.action === 'messages' && c.params.afterId === 3)); assert.equal(p.$('messages').querySelector('.file-card'), card);
  await p.click('older'); assert.equal(p.calls.filter((c) => c.action === 'messages').at(-1).params.beforeId, 3); assert.equal(p.$('older').hidden, true);
});
test('import is explicit, then opening, AI references and synchronous drag ticket work', async (t) => {
  const p = await panel(); close(t, p); await p.select(); assert.equal(p.calls.filter((c) => c.action === 'import').length, 0);
  await p.named('存入项目'); await p.named('打开'); await p.named('添加到 AI'); assert.ok(p.calls.some((c) => c.method === 'chat.addFile' && c.path.endsWith('合同.docx')));
  const drag = p.dom.window.document.querySelector('.drag-file'); const values = new Map();
  const early = new p.dom.window.Event('dragstart', { cancelable: true }); early.dataTransfer = { setData: (k, v) => values.set(k, v) }; drag.dispatchEvent(early); assert.equal(early.defaultPrevented, true); await tick();
  const start = new p.dom.window.Event('dragstart', { cancelable: true }); start.dataTransfer = { setData: (k, v) => values.set(k, v) }; drag.dispatchEvent(start); assert.equal(start.defaultPrevented, false); assert.equal(values.get('application/x-awd-test'), 'random-ticket'); assert.ok(values.has('application/x-checkba-file')); assert.ok(values.has('text/checkba-file-json'));
  drag.dispatchEvent(new p.dom.window.Event('dragend')); await tick(); assert.ok(p.calls.some((c) => c.method === 'files.endDrag'));
});
test('cancelled import or chat export writes nothing', async (t) => {
  const p = await panel({ confirm: false }); close(t, p); await p.select(); await p.named('存入项目'); await p.click('export'); assert.equal(p.calls.filter((c) => ['import', 'export'].includes(c.action)).length, 0);
});
test('project switch rejects late message content and clears all in-memory drafts', async (t) => {
  let release; const p = await panel({ call: ({ action }) => action === 'messages' ? new Promise((r) => { release = r; }) : undefined }); close(t, p);
  await p.select(); p.write('旧项目草稿'); await p.switch(); release({ messages: [{ ...msg, text: 'STALE_SECRET' }] }); await tick(); assert.doesNotMatch(p.dom.window.document.body.textContent, /STALE_SECRET/); assert.equal(p.$('active-chat').hidden, true);
});
test('late export never opens a file in a different project', async (t) => {
  let release; const p = await panel({ call: ({ action }) => action === 'export' ? new Promise((r) => { release = r; }) : undefined }); close(t, p);
  await p.select(); await p.click('export'); await p.switch(); release({ path: '旧项目/聊天.md' }); await tick(); assert.equal(p.calls.filter((c) => c.method === 'ui.openFile').length, 0);
});
test('member and client cannot see invite/removal controls, owner can', async (t) => {
  const p = await panel(); close(t, p); await p.select(); await p.click('members-button'); assert.match(p.$('dialog-body').textContent, /生成邀请码/); await p.named('生成邀请码'); assert.equal(p.$('invite-result').querySelector('input').value, 'SYNTHETIC-CODE');
  await p.select(1); await p.click('members-button'); assert.doesNotMatch(p.$('dialog-body').textContent, /生成邀请码|移除/); assert.match(p.$('dialog-body').textContent, /客户/);
});
test('project file stays a draft until send and goes through sendFile', async (t) => {
  const p = await panel(); close(t, p); await p.select(); await p.click('project-file');
  p.$('dialog-form').dispatchEvent(new p.dom.window.Event('submit', { cancelable: true })); await tick(); assert.match(p.$('attachment-name').textContent, /合同.docx/); assert.equal(p.calls.filter((c) => c.action === 'sendFile').length, 0);
  await p.submit(); assert.equal(p.calls.find((c) => c.action === 'sendFile').params.path, '材料/合同.docx');
});
test('account changed event clears pending messages; projectless context makes no IM calls', async (t) => {
  const p = await panel(); close(t, p); await p.select(); p.write('old'); await p.events['account.changed'](); await tick(); assert.equal(p.$('active-chat').hidden, true);
  const before = p.calls.filter((c) => c.method === 'im.request').length; await p.switch({ projectId: null }); assert.equal(p.calls.filter((c) => c.method === 'im.request').length, before); assert.equal(p.$('new-chat').disabled, true); assert.match(p.$('notice').textContent, /选择一个项目/);
});
test('a late send failure after leaving and returning offers retry instead of staying sending', async (t) => {
  let fail; const p = await panel({ call: ({ action }) => action === 'send' ? new Promise((_, reject) => { fail = reject; }) : undefined }); close(t, p);
  await p.select(); p.write('迟到失败'); await p.submit(); await p.select(1); await p.select(); fail(Error('offline')); await tick(); assert.match(p.$('messages').textContent, /发送未确认/); assert.doesNotMatch(p.$('messages').textContent, /发送中/);
});
test('late invitation result cannot populate a different dialog', async (t) => {
  let release; const p = await panel({ call: ({ action }) => action === 'invite' ? new Promise((r) => { release = r; }) : undefined }); close(t, p);
  await p.select(); await p.click('members-button'); await p.named('生成邀请码'); await p.click('close-dialog'); await p.click('new-chat'); release({ code: 'STALE_INVITE', expiresAt: Date.now() }); await tick(); assert.equal(p.$('invite-result'), null);
});
test('hidden or unfocused plugin does not mark messages as read', async (t) => {
  const p = await panel(); close(t, p); await p.select(); assert.equal(p.calls.filter((c) => c.action === 'read').length, 0);
  p.dom.window.document.hasFocus = () => true; await p.poll(); assert.ok(p.calls.some((c) => c.action === 'read'));
});
test('backend business errors remain legible safe text', async (t) => {
  const p = await panel({ call: ({ action }) => { if (action === 'join') throw Error('邀请码已过期 <script>example</script>'); } }); close(t, p);
  await p.click('join-chat'); p.$('dialog-body').querySelector('input').value = 'expired';
  p.$('dialog-form').dispatchEvent(new p.dom.window.Event('submit', { cancelable: true })); await tick();
  assert.match(p.$('dialog-error').textContent, /邀请码已过期/); assert.equal(p.$('dialog-error').querySelector('script'), null);
});
test('unavailable attachment never reveals metadata, requests bytes, or offers AI actions', async (t) => {
  const p = await panel({ call: ({ action }) => action === 'messages' ? { messages: [{ ...msg, attachment: { id: 'secret', available: false, message: 'ignored backend text' } }] } : undefined }); close(t, p);
  await p.select(1); assert.match(p.$('messages').textContent, /项目文件.*文件待准备/s); assert.doesNotMatch(p.$('messages').textContent, /存入项目|添加到 AI|合同/);
  await p.named('查看文件'); assert.equal(p.$('notice').textContent, '抱歉文件还在准备中，请联系您的律师。'); assert.equal(p.calls.filter((c) => ['import', 'download'].includes(c.action)).length, 0);
});
test('grant and revoke require confirmation and refresh every loaded attachment, including quoted identity', async (t) => {
  let visible = false;
  const p = await panel({ call: ({ action, params }) => {
    if (action === 'fileAccess') { visible = params.clientVisible; return {}; }
    if (action === 'messages') return { messages: [{ ...msg, attachment: { ...msg.attachment, available: true, clientVisible: visible, canManageAccess: true, source: { projectUid: 'project-uid', fileUid: 'file-uid' } } }] };
  } }); close(t, p); await p.select(); assert.match(p.$('messages').textContent, /项目文件引用 · 发送时版本/);
  await p.named('客户可见'); assert.equal(visible, true); assert.match(p.$('messages').textContent, /设为内部/); await p.named('设为内部'); assert.equal(visible, false);
  assert.deepEqual(p.calls.filter((c) => c.action === 'fileAccess').map((c) => c.params.clientVisible), [true, false]); assert.match(p.$('notice').textContent, /副本无法收回/);
  await p.select(1); assert.doesNotMatch(p.$('messages').textContent, /设为内部/); assert.equal([...p.$('messages').querySelectorAll('button')].some((b) => b.textContent === '客户可见'), false);
});
test('recent-page polling replaces permission DTOs even when message IDs and counts stay unchanged', async (t) => {
  let allowed = true;
  const p = await panel({ call: ({ action, params }) => action === 'messages' ? {
    messages: params.afterId ? [] : [{ ...msg, attachment: allowed ? { ...msg.attachment, available: true } : { id: msg.attachment.id, available: false } }]
  } : undefined }); close(t, p); Object.defineProperty(p.dom.window.document, 'visibilityState', { value: 'visible' });
  await p.select(); await p.named('存入项目'); assert.ok([...p.$('messages').querySelectorAll('button')].some((b) => b.textContent === '添加到 AI'));
  allowed = false; await p.poll(); assert.match(p.$('messages').textContent, /文件待准备/); assert.doesNotMatch(p.$('messages').textContent, /添加到 AI|合同/);
});
test('local upload and message share one idempotency key; a fresh identical file has a new key', async (t) => {
  const p = await panel({ call: ({ action }) => action === 'upload' ? { id: 'uploaded-file' } : undefined }); close(t, p); await p.select();
  p.dom.window.FileReader = class { readAsDataURL() { this.result = 'data:application/octet-stream;base64,YWJj'; queueMicrotask(() => this.onload()); } };
  const choose = () => {
    Object.defineProperty(p.$('file-input'), 'files', { configurable: true, value: [new p.dom.window.File(['abc'], 'same.txt')] });
    p.$('file-input').dispatchEvent(new p.dom.window.Event('change'));
  };
  choose(); await p.submit(); choose(); await p.submit();
  const uploads = p.calls.filter((c) => c.action === 'upload'), sends = p.calls.filter((c) => c.action === 'send');
  assert.equal(uploads.length, 2); assert.equal(uploads[0].params.clientMessageId, sends[0].params.clientMessageId);
  assert.equal(uploads[1].params.clientMessageId, sends[1].params.clientMessageId);
  assert.notEqual(uploads[0].params.clientMessageId, uploads[1].params.clientMessageId);
});
test('client downloads a readable attachment without importing or needing project-write operations', async (t) => {
  const p = await panel({ call: ({ method }) => method === 'im.downloadAttachment' ? { started: true, name: '合成合同.docx' } : undefined }); close(t, p);
  await p.select(1); assert.equal([...p.$('messages').querySelectorAll('button')].some((b) => b.textContent === '存入项目'), false);
  await p.named('下载'); const downloads = p.calls.filter((c) => c.method === 'im.downloadAttachment');
  assert.equal(downloads.length, 1); assert.equal(downloads[0].conversationId, c2.id); assert.equal(downloads[0].attachmentId, msg.attachment.id);
  assert.equal(p.calls.some((c) => ['import', 'upload', 'export'].includes(c.action)), false);
  assert.match(p.$('notice').textContent, /已发起下载/); assert.doesNotMatch(p.$('notice').textContent, /已保存/);
});
test('revoked attachment download displays server refusal and unavailable cards offer no download', async (t) => {
  const p = await panel({ call: ({ method }) => { if (method === 'im.downloadAttachment') throw Error('抱歉文件还在准备中，请联系您的律师。'); } }); close(t, p);
  await p.select(1); await p.named('下载'); assert.equal(p.$('notice').textContent, '抱歉文件还在准备中，请联系您的律师。'); assert.equal(p.$('notice').dataset.error, 'true');
});
test('directory shows only host-provided org data; no team gives an empty state that opens host team settings', async (t) => {
  const p = await panel({ call: ({ method, action }) => method === 'im.directory' && action === 'get' ? { organization: null, firm: null, friends: [], capabilities: {} } : undefined }); close(t, p); await tick();
  assert.match(p.$('org-switcher').textContent, /尚未加入团队/);
  assert.doesNotMatch(p.$('directory-groups').textContent, /张维|陈远航|民商事/);
  await p.named('团队与律所设置');
  assert.ok(p.calls.some((c) => c.method === 'im.directory' && c.action === 'openOrgSettings'));
});
test('team / firm switch refreshes the directory without dropping the open chat or its draft', async (t) => {
  let org = { id: 't1', name: '旧团队', myRoleLabel: '成员', members: [{ id: 'a', name: '旧同事', roleLabel: '成员' }] };
  const p = await panel({ call: ({ method, action }) => method === 'im.directory' && action === 'get'
    ? { organization: org, firm: null, friends: [], capabilities: { hasTeam: true, canSwitchTeam: true } } : undefined }); close(t, p); await tick();
  p.$('directory-groups').querySelectorAll('.dir-group-toggle')[1].click();
  assert.match(p.$('directory-groups').textContent, /旧同事/);
  await p.select(); p.write('切换前的草稿');
  org = { id: 't2', name: '新团队', myRoleLabel: '成员', members: [{ id: 'b', name: '新同事', roleLabel: '成员' }] };
  await p.events['sidebar.command']({ command: 'refresh-directory', reason: 'switchTeam' }); await tick(); await tick();
  assert.match(p.$('org-switcher').textContent, /新团队/);
  assert.match(p.$('directory-groups').textContent, /新同事/); assert.doesNotMatch(p.$('directory-groups').textContent, /旧同事/);
  assert.equal(p.$('active-chat').hidden, false); assert.equal(p.$('draft').value, '切换前的草稿');
  assert.match(p.$('notice').textContent, /通讯录和可访问会话已更新/);
});
test('team owner sees why switching team is blocked', async (t) => {
  const p = await panel({ call: ({ method, action }) => method === 'im.directory' && action === 'get'
    ? { organization: { name: '我的团队', myRoleLabel: '负责人', members: [] }, firm: { name: '合成所', isHead: true, teams: [] }, friends: [], capabilities: { hasTeam: true, isTeamOwner: true } } : undefined }); close(t, p); await tick();
  assert.match(p.$('org-switcher').textContent, /总部团队不能退出律所/);
});

test('conversation-first layout keeps directory secondary, shows real project members and uses only three scope names', async (t) => {
  const p = await panel({ call: ({ method }) => method === 'im.directory' ? {
    me: { id: '9' },
    projectColleagues: [{ id: '9', name: '我自己', roleLabel: '负责人' }, { id: '12', name: '合成项目同事', roleLabel: '项目成员' }],
    organization: { name: '合成团队', members: [] }, firm: { name: '合成律所', teams: [] }, friends: [],
  } : undefined }); close(t, p);
  assert.equal(p.$('directory').open, false);
  assert.ok(p.$('conversations').compareDocumentPosition(p.$('directory')) & p.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(p.$('welcome-directory'), null);
  assert.doesNotMatch(p.dom.window.document.body.textContent, /我的组织|切换组织|我的朋友/);
  p.$('directory').open = true;
  assert.match(p.$('directory-groups').textContent, /当前项目.*合成项目同事.*我的团队.*我的律所/s);
  assert.doesNotMatch(p.$('directory-groups').textContent, /我自己/);
  p.$('search').value = '合成项目同事'; p.$('search').dispatchEvent(new p.dom.window.Event('input'));
  await p.named('发消息');
  assert.ok(p.calls.some((c) => c.action === 'create' && c.params.title === '合成项目同事'));
});
test('opening directory from chat preserves the active conversation and draft', async (t) => {
  const p = await panel(); close(t, p); await p.select(); p.write('待发送内容');
  await p.click('directory-home');
  assert.equal(p.$('directory').open, true);
  assert.equal(p.$('active-chat').hidden, false);
  assert.equal(p.$('draft').value, '待发送内容');
  assert.equal(p.dom.window.document.activeElement, p.$('directory').querySelector('summary'));
});
test('plugin navigation hides only for a matching visible host sidebar and returns when it leaves', async (t) => {
  const p = await panel(); close(t, p); await p.select(); p.write('保留草稿');
  await p.events['sidebar.command']({ command: 'host-sidebar', projectId: 2, visible: true });
  assert.equal(p.$('workspace').classList.contains('host-sidebar'), false);
  await p.events['sidebar.command']({ command: 'host-sidebar', projectId: 1, visible: true });
  assert.equal(p.$('workspace').classList.contains('host-sidebar'), true);
  await p.click('directory-home');
  assert.equal(p.calls.filter((c) => c.method === 'sidebar.sync').at(-1).directoryOpen, true);
  assert.equal(p.$('workspace').classList.contains('chat-open'), true);
  assert.equal(p.$('draft').value, '保留草稿');
  await p.events['sidebar.command']({ command: 'host-sidebar', projectId: 1, visible: false });
  assert.equal(p.$('workspace').classList.contains('host-sidebar'), false);
  await p.events['sidebar.command']({ command: 'host-sidebar', projectId: 1, visible: true });
  await p.switch();
  assert.equal(p.$('workspace').classList.contains('host-sidebar'), false);
});

async function agentPanel(options = {}) {
  const agent = { scope: 'project', scopeKey: 'project-uuid', name: '合成项目助手', title: '合成项目助手群' };
  const group = { id: 'agent-group', title: agent.title, type: 'GROUP', role: 'OWNER', agent: { ...agent, private: false } };
  const privateChat = { id: 'agent-private', title: agent.name, type: 'AGENT_DIRECT', role: 'OWNER', agent: { ...agent, private: true } };
  const conversations = [group, c1, c2], messages = []; let status = null, nextId = 30;
  const p = await panel({ call: async (entry) => {
    const custom = await options.call?.(entry); if (custom !== undefined) return custom;
    if (entry.method !== 'im.request') return;
    const { action, params } = entry;
    if (action === 'agentScopes') return { agents: [agent] };
    if (action === 'ensureAgent') { if (params.private && !conversations.includes(privateChat)) conversations.push(privateChat); return params.private ? privateChat : group; }
    if (action === 'list') return { conversations };
    if (action === 'members' && params.conversationId.startsWith('agent-')) return {
      humanCount: options.humanCount || 1,
      members: [{ id: 9, role: 'OWNER', displayName: '合成用户', actorType: 'HUMAN' }, ...(options.humanCount === 2 ? [{ id: 10, role: 'MEMBER', displayName: '合成同事', actorType: 'HUMAN' }] : []), { id: null, displayName: agent.name, actorType: 'AGENT' }],
    };
    if (action === 'messages' && params.conversationId.startsWith('agent-')) return { messages, agentStatus: status, hasMore: false };
    if (action === 'send') { const message = { id: nextId++, senderId: 9, actorType: 'HUMAN', text: params.text, clientMessageId: params.clientMessageId }; messages.push(message); return message; }
    if (action === 'agentReply') { status = { status: 'queued', messageId: params.messageId }; return { accepted: true, ...status }; }
  } });
  if (!options.keepDefault && !p.$('active-chat').hidden) await p.select(0);
  return { ...p, group, privateChat, messages, setStatus: (next) => { status = next; } };
}
test('selecting an existing shared conversation preserves its group behavior and single-human replies', async (t) => {
  const p = await agentPanel(); close(t, p);
  assert.equal(p.$('active-chat').hidden, false);
  assert.equal(p.$('chat-title').textContent, '合成项目助手群');
  assert.match(p.$('chat-subtitle').textContent, /群成员可见/);
  assert.equal(p.$('agents').children.length, 0, 'existing assistant group is not duplicated as a shortcut');
  assert.equal(p.calls.find((c) => c.action === 'ensureAgent').params.private, true);
  await p.click('members-button');
  assert.match(p.$('dialog-body').textContent, /合成项目助手 · AI 助手/);
  assert.equal([...p.$('dialog-body').querySelectorAll('.member-row button')].some((b) => b.textContent === '移除'), false);
  assert.doesNotMatch(p.$('dialog-body').textContent, /退出会话/);
  await p.click('close-dialog'); p.write('这个项目下一步做什么？'); await p.submit();
  const send = p.calls.find((c) => c.action === 'send'), reply = p.calls.find((c) => c.action === 'agentReply');
  assert.equal(reply.params.question, send.params.text);
  assert.ok(send); assert.equal(reply.params.messageId, 30);
  assert.match(p.$('agent-status').textContent, /等待助手回复/);
  assert.doesNotMatch(p.$('messages').textContent, /AI 助手/);
});
test('multi-human shared group waits for an explicit assistant request', async (t) => {
  const p = await agentPanel({ humanCount: 2 }); close(t, p);
  p.write('先与同事讨论'); await p.submit();
  assert.equal(p.calls.filter((c) => c.action === 'agentReply').length, 0);
  await p.click('agent-reply');
  assert.deepEqual(p.calls.filter((c) => c.action === 'agentReply').map((c) => c.params.messageId), [30]);
});
test('assistant failures retry the same message without resending user content, completed replies identify AI', async (t) => {
  const p = await agentPanel(); close(t, p); p.write('请概括进度'); await p.submit();
  p.setStatus({ status: 'failed', messageId: 30, error: '模型暂不可用 <script>bad</script>' }); await p.poll();
  assert.match(p.$('agent-status').textContent, /模型暂不可用/); assert.equal(p.$('agent-status').querySelector('script'), null);
  await p.named('重试助手回复');
  assert.equal(p.calls.filter((c) => c.action === 'send').length, 1);
  assert.deepEqual(p.calls.filter((c) => c.action === 'agentReply').map((c) => c.params.messageId), [30, 30]);
  p.messages.push({ id: 31, senderId: 0, actorType: 'AGENT', senderName: '合成项目助手', text: '基于群内信息的回复' });
  p.setStatus({ status: 'completed', messageId: 30 }); await p.poll();
  assert.equal(p.$('agent-status').hidden, true);
  assert.match(p.$('messages').textContent, /合成项目助手 · AI 助手.*基于群内信息的回复/s);
});
test('assistant private chat is separately scoped and has no invitation or shared file controls', async (t) => {
  const p = await agentPanel({ humanCount: 2 }); close(t, p); await p.click('agent-private');
  assert.match(p.$('chat-subtitle').textContent, /仅你可见/);
  assert.equal(p.$('members-button').hidden, true); assert.equal(p.$('project-bar').hidden, true);
  assert.equal(p.dom.window.document.querySelector('.composer-tools').hidden, true);
  assert.equal(p.calls.filter((c) => c.action === 'ensureAgent').at(-1).params.private, true);
  p.write('只与助手聊'); await p.submit();
  assert.equal(p.calls.filter((c) => c.action === 'agentReply').length, 1);
  assert.equal(p.calls.some((c) => c.action === 'invite'), false);
});
test('cloud quota and project context disclosure appears before sending and keeps detail collapsible', async (t) => {
  const p = await agentPanel(); close(t, p);
  assert.match(p.$('chat-subtitle').textContent, /云端助手群聊/);
  assert.equal(p.$('agent-info').hidden, false);
  assert.match(p.$('agent-info-summary').textContent, /使用平台 AI 额度.*本群公开材料/);
  await p.click('agent-private');
  assert.match(p.$('chat-subtitle').textContent, /云端助手私聊.*仅你可见/);
  assert.match(p.$('agent-info-summary').textContent, /你可读的当前项目资料在云端回复/);
  assert.match(p.$('agent-info-detail').textContent, /项目概况、文件目录及部分材料正文会随提问发送；不使用本机选择的模型/);
  assert.equal(p.$('agent-info').querySelector('details').open, false);
  assert.equal(p.calls.some((c) => c.action === 'send'), false);
  await p.select(1); assert.equal(p.$('agent-info').hidden, true);
});
test('project scope reason remains visible while a permitted team assistant can be opened', async (t) => {
  const team = { scope: 'team', scopeKey: 'team:one', name: '团队助手', title: '合成团队' };
  const reason = '请由项目负责人先创建项目助手群。';
  const p = await agentPanel({ call: ({ action }) => {
    if (action === 'agentScopes') return { agents: [team], projectReason: reason };
    if (action === 'ensureAgent') return { id: 'agent-team', title: team.title, type: 'GROUP', role: 'MEMBER', agent: { ...team, private: false } };
  } }); close(t, p);
  assert.match(p.$('agents').textContent, /团队助手/);
  assert.match(p.$('agents').textContent, /请由项目负责人先创建项目助手群/);
  assert.match(p.$('conversations').textContent, /合成客户沟通/);
  assert.equal(p.calls.some((c) => c.action === 'ensureAgent'), false);
  p.$('agents').querySelector('button').click(); await tick(); await tick();
  assert.equal(p.$('chat-title').textContent, team.title);
  assert.equal(p.calls.filter((c) => c.action === 'ensureAgent').at(-1).params.scopeKey, team.scopeKey);
  assert.match(p.$('agents').textContent, /请由项目负责人先创建项目助手群/);
});
test('assistant scope and enrollment failures preserve ordinary messaging; disconnected account never looks ready', async (t) => {
  for (const action of ['agentScopes', 'ensureAgent', 'self']) {
    const p = await agentPanel({ call: (c) => { if (c.action === action) throw Error(action === 'ensureAgent' ? '请使用邀请码加入该项目助手群' : '服务连接失败'); } }); close(t, p);
    assert.match(p.$('notice').textContent, action === 'ensureAgent' ? /邀请码/ : /服务连接失败/);
    assert.equal(p.$('active-chat').hidden, true);
    if (action === 'self') {
      assert.equal(p.$('agents').children.length, 0);
      assert.equal(p.calls.some((c) => c.action === 'ensureAgent'), false);
    } else {
      assert.match(p.$('conversations').textContent, /合成客户沟通/);
      await p.select(1); p.write('普通会话仍可发送'); await p.submit();
      assert.ok(p.calls.some((c) => c.action === 'send'));
    }
  }
});
test('late default assistant enrollment cannot replace a conversation chosen by the user', async (t) => {
  let release;
  const p = await agentPanel({ call: ({ action }) => action === 'ensureAgent' ? new Promise((resolve) => { release = resolve; }) : undefined }); close(t, p);
  await p.select(1); assert.equal(p.$('chat-title').textContent, c1.title);
  release(p.group); await tick(); await tick();
  assert.equal(p.$('chat-title').textContent, c1.title);
});

test('a rejected assistant admission retains retry after polling without relabeling the sent message as failed', async (t) => {
  let fail = true;
  const p = await agentPanel({ call: ({ action }) => { if (action === 'agentReply' && fail) throw Error('助手暂时繁忙'); } }); close(t, p);
  p.write('消息已发送，助手可稍后回复'); await p.submit();
  assert.match(p.$('agent-status').textContent, /助手暂时繁忙/);
  assert.doesNotMatch(p.$('messages').textContent, /发送未确认/);
  await p.poll(); assert.match(p.$('agent-status').textContent, /重试助手回复/);
  fail = false; await p.named('重试助手回复');
  assert.equal(p.calls.filter((c) => c.action === 'send').length, 1);
  assert.deepEqual(p.calls.filter((c) => c.action === 'agentReply').map((c) => c.params.messageId), [30, 30]);
});
test('an assistant reply failure after switching conversations cannot replace the new chat status', async (t) => {
  let reject;
  const p = await agentPanel({ call: ({ action }) => action === 'agentReply' ? new Promise((_, fail) => { reject = fail; }) : undefined }); close(t, p);
  p.write('旧会话消息'); await p.submit(); await p.select(1);
  reject(Error('旧会话回复失败')); await tick();
  assert.equal(p.$('chat-title').textContent, c1.title);
  assert.equal(p.$('agent-status').hidden, true);
  assert.doesNotMatch(p.$('notice').textContent, /旧会话回复失败/);
});

for (const olderStatus of ['queued', 'completed']) test(`older ${olderStatus} turn cannot erase a later rejected reply or its retry source`, async (t) => {
  let rejectSecond = true;
  const p = await agentPanel({ call: ({ action, params }) => {
    if (action === 'agentReply' && params.messageId === 31 && rejectSecond) throw Error('助手正在回复，请稍后再试');
  } }); close(t, p);
  p.write('第一条问题'); await p.submit();
  p.setStatus({ status: olderStatus, messageId: 30 }); await p.poll();
  p.write('第二条需要保留的问题'); await p.submit();
  assert.equal(p.calls.filter((c) => c.action === 'send').length, 2, 'normal messages remain sendable');
  assert.match(p.$('agent-status').textContent, /重试助手回复/);
  await p.poll();
  assert.match(p.$('agent-status').textContent, /重试助手回复/, 'old server status must not erase the rejected newer reply');
  p.setStatus({ status: 'completed', messageId: 30 }); await p.poll();
  assert.match(p.$('agent-status').textContent, /第二条需要保留的问题/);
  rejectSecond = false; await p.named('重试助手回复');
  assert.deepEqual(p.calls.filter((c) => c.action === 'agentReply').map((c) => c.params.messageId), [30, 31, 31]);
  assert.equal(p.calls.filter((c) => c.action === 'send').length, 2);
  await p.poll();
  assert.doesNotMatch(p.$('agent-status').textContent, /重试助手回复|助手正在回复，请稍后再试/);
  p.setStatus({ status: 'completed', messageId: 31 }); await p.poll();
  assert.equal(p.$('agent-status').hidden, true);
});
test('each rejected reply keeps its own retry even after another failed source is accepted', async (t) => {
  let fail = true;
  const p = await agentPanel({ call: ({ action }) => { if (action === 'agentReply' && fail) throw Error('暂时无法连接助手'); } }); close(t, p);
  p.write('第一条失败问题'); await p.submit(); p.write('第二条失败问题'); await p.submit();
  await p.poll(); assert.equal(p.$('agent-status').querySelectorAll('button').length, 2);
  fail = false; p.$('agent-status').querySelector('button').click(); await tick(); await tick();
  p.setStatus({ status: 'completed', messageId: 30 }); await p.poll();
  assert.match(p.$('agent-status').textContent, /第二条失败问题/);
  assert.doesNotMatch(p.$('agent-status').textContent, /第一条失败问题/);
  await p.named('重试助手回复');
  assert.deepEqual(p.calls.filter((c) => c.action === 'agentReply').map((c) => c.params.messageId), [30, 31, 30, 31]);
  assert.equal(p.calls.filter((c) => c.action === 'send').length, 2);
});
test('a second human message sent while admission is pending retains an assistant retry', async (t) => {
  let release, pending = true;
  const p = await agentPanel({ call: ({ action, params }) => action === 'agentReply' && params.messageId === 30 && pending
    ? new Promise((resolve) => { release = resolve; }) : undefined }); close(t, p);
  p.write('第一条正在申请回复'); await p.submit(); p.write('第二条等待重试'); await p.submit();
  assert.equal(p.calls.filter((c) => c.action === 'send').length, 2);
  assert.match(p.$('agent-status').textContent, /第二条等待重试/);
  pending = false; release({ accepted: true, status: 'completed', messageId: 30 }); await tick(); await tick();
  await p.poll(); await p.named('重试助手回复');
  assert.deepEqual(p.calls.filter((c) => c.action === 'agentReply').map((c) => c.params.messageId), [30, 31]);
  assert.equal(p.calls.filter((c) => c.action === 'send').length, 2);
});

test('assistant and member avatars render safely without verbose empty-chat instructions', async t => {
 const group={...c1,agent:{scope:'project',scopeKey:'project:1',name:'项目助手',private:false}}
 const p=await panel({call:({action})=> action==='list'?{conversations:[group]}:action==='messages'?{messages:[{id:1,actorType:'AGENT',senderId:0,senderName:'项目助手',text:'合成答复'},{...msg,senderAvatarUrl:'https://example.test/avatar.png',attachment:null}],hasMore:false}:undefined})
 close(t,p);await p.select()
 assert.equal(p.$('messages').querySelectorAll('.assistant-avatar svg').length,1)
 assert.equal(p.$('messages').querySelector('img').getAttribute('src'),'https://example.test/avatar.png')
 assert.equal(p.$('binding').textContent,'');assert.equal(p.$('agent-info-summary').hidden,true)
 assert.equal(p.$('agent-info').querySelector('details').open,false)
 assert.equal(p.$('empty-messages').textContent,'')
})

test('project assistant defaults to private context while an explicit shared command stays shared', async t => {
 const p=await agentPanel({keepDefault:true});close(t,p)
 assert.match(p.$('chat-subtitle').textContent,/仅你可见/)
 assert.equal(p.calls.find(c=>c.action==='ensureAgent').params.private,true)
 await p.events['sidebar.command']({command:'open-agent',scope:'project',scopeKey:'project-uuid',private:false});await tick()
 assert.match(p.$('chat-subtitle').textContent,/群成员可见/)
 assert.equal(p.calls.filter(c=>c.action==='ensureAgent').at(-1).params.private,false)
})
