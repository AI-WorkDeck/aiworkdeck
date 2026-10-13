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
