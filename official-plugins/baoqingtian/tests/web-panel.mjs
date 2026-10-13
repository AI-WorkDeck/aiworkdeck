// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const scripts = ['model.js', 'panel.js'].map(name => readFileSync(new URL('../web/' + name, import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixtures = {
  status: { connected: true, displayName: '合成律师', accountId: 'qa-one' },
  cases: { items: [{ id: 'case-one', title: '<img src=x onerror=alert(1)> 合成案源', category: '合同纠纷', region: '北京', budget: '面议', description: '合成案源说明' }], total: 2, hasMore: true },
  case_detail: { id: 'case-one', title: '合成案源', description: '<script>不可信正文</script>', budget: '面议' },
  notes: { items: [{ id: 'note-one', title: '合成草稿', content: '合成正文', status: 'draft' }], total: 1, hasMore: false },
  note_detail: { id: 'note-one', title: '合成草稿', content: '合成正文', status: 'draft' },
  business_types: { items: [{ id: 'biz-one', name: '合同纠纷' }] },
  note_save: { id: 'note-saved' }, note_status: { id: 'note-one', status: 'deleted' }
};
async function panel(options = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://plugin.invalid' });
  const calls = [], events = {};
  let context = { projectId: 1, ...options.context };
  dom.window.awd = {
    ready: async () => context,
    tools: { invoke: async (name, args) => {
      const call = { name, action: args.action, args: JSON.parse(args.json) }; calls.push(call);
      const value = options.invoke ? await options.invoke(call) : undefined;
      return typeof value === 'string' ? value : JSON.stringify({ ok: true, data: value ?? fixtures[call.action] });
    } }, events: { on(name, callback) { events[name] = callback; } }, call: async () => context
  };
  scripts.forEach(script => dom.window.eval(script)); await tick();
  const $ = id => dom.window.document.getElementById(id);
  return { dom, $, calls,
    click: async id => { $(id).click(); await tick(); },
    select: async () => { $('list').querySelector('button').click(); await tick(); },
    input: (id, value) => { $(id).value = value; $(id).dispatchEvent(new dom.window.Event('input')); },
    switch: async next => { context = next; await events['project.switched'](); await tick(); }
  };
}
test('loads actual lists as text and opens a safe case detail', async t => {
  const p = await panel(); t.after(() => p.dom.window.close());
  assert.equal(p.$('list').querySelector('img'), null); assert.match(p.$('list').textContent, /合成案源/);
  await p.select(); assert.equal(p.$('detail').hidden, false); assert.equal(p.$('detail-content').querySelector('script'), null);
  assert.match(p.$('detail-content').textContent, /不可信正文/);
});
test('search and pagination send explicit parameters without writing', async t => {
  const p = await panel(); t.after(() => p.dom.window.close());
  p.input('keyword', ' 劳动 '); p.$('search-form').dispatchEvent(new p.dom.window.Event('submit', { cancelable: true })); await tick();
  assert.deepEqual(p.calls.at(-1).args, { page: 1 });
  assert.match(p.$('empty').textContent, /当前页/);
  await p.click('next'); assert.equal(p.calls.at(-1).args.page, 2);
  await p.click('nav-notes'); p.$('status-filter').value = 'draft'; p.$('status-filter').dispatchEvent(new p.dom.window.Event('change')); await tick();
  assert.deepEqual(p.calls.at(-1).args, { page: 1, keyword: '' });
  assert.equal(p.calls.some(call => call.action.startsWith('note_s')), false);
});
test('new note saves draft; publishing requires explicit confirmation', async t => {
  const p = await panel(); t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.click('new-note');
  p.$('note-business').value = 'biz-one'; p.input('note-title', '标题'); p.input('note-content', '正文'); await p.click('save-draft');
  assert.deepEqual(p.calls.find(call => call.action === 'note_save').args, { title: '标题', content: '正文', status: 'draft', businessId: 'biz-one', confirmed: true });
  assert.match(p.$('note-state').textContent, /草稿已保存/);
  await p.click('publish-note'); assert.equal(p.calls.filter(call => call.action === 'note_save').length, 1);
  await p.click('cancel-confirm'); assert.equal(p.calls.filter(call => call.action === 'note_save').length, 1);
  await p.click('publish-note'); await p.click('accept-confirm');
  assert.equal(p.calls.filter(call => call.action === 'note_save').at(-1).args.status, 'published');
});
test('save failure preserves edited text and does not claim success', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'note_save' ? JSON.stringify({ ok: false, error: '保存失败，请重试。' }) : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select(); p.input('note-content', '必须保留的草稿'); await p.click('save-draft');
  assert.equal(p.$('note-content').value, '必须保留的草稿'); assert.equal(p.$('feedback').dataset.error, 'true');
  assert.equal(p.$('note-state').textContent, '有未保存的修改');
});
test('unsaved navigation and deletion are confirmed; cancel does not mutate', async t => {
  const p = await panel(); t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select();
  p.input('note-title', '修改标题'); await p.click('nav-cases'); assert.equal(p.$('confirmation').hidden, false);
  await p.click('cancel-confirm'); assert.equal(p.$('note-title').value, '修改标题'); assert.equal(p.$('section-title').textContent, '我的笔记');
  await p.click('delete-note'); await p.click('cancel-confirm'); assert.equal(p.calls.some(call => call.action === 'note_status'), false);
  await p.click('delete-note'); await p.click('accept-confirm'); assert.equal(p.calls.find(call => call.action === 'note_status').args.status, 'deleted');
});
test('late case details cannot appear after switching to notes', async t => {
  let finish;
  const p = await panel({ invoke: ({ action }) => action === 'case_detail' ? new Promise(resolve => { finish = resolve; }) : undefined });
  t.after(() => p.dom.window.close()); await p.select(); await p.click('nav-notes'); finish(fixtures.case_detail); await tick();
  assert.equal(p.$('detail').hidden, true); assert.equal(p.$('section-title').textContent, '我的笔记'); assert.match(p.$('list').textContent, /合成草稿/);
});
test('late save response cannot restore old project content', async t => {
  let finish;
  const p = await panel({ invoke: ({ action }) => action === 'note_save' ? new Promise(resolve => { finish = resolve; }) : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select(); p.input('note-content', '旧项目内容'); await p.click('save-draft');
  await p.switch({ projectId: 2 }); finish({ id: 'old-note' }); await tick();
  assert.equal(p.$('editor').hidden, true); assert.equal(p.$('note-content').value, ''); assert.doesNotMatch(p.$('feedback').textContent, /草稿已保存/);
});
test('account change clears the old draft and invalidates pending detail', async t => {
  let account = 'qa-one', finish;
  const p = await panel({ invoke: ({ action }) => action === 'status' ? { connected: true, displayName: account, accountId: account } : action === 'note_detail' ? new Promise(resolve => { finish = resolve; }) : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select(); account = 'qa-two'; await p.click('check-account');
  finish(fixtures.note_detail); await tick(); assert.equal(p.$('editor').hidden, true); assert.equal(p.$('account-status').textContent, 'qa-two');
});
test('unknown or disconnected account never fabricates records or allows writes', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'status' ? { connected: false } : undefined });
  t.after(() => p.dom.window.close()); assert.equal(p.calls.length, 1); assert.equal(p.$('connection').hidden, false);
  await p.click('nav-notes'); assert.equal(p.$('new-note').disabled, true); assert.equal(p.$('list').children.length, 0);
});
test('missing project does not invoke any tool', async t => {
  const p = await panel({ context: { projectId: null } }); t.after(() => p.dom.window.close());
  assert.equal(p.calls.length, 0); assert.match(p.$('connection-message').textContent, /打开项目/);
});
test('missing save acknowledgement preserves draft as unsaved', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'note_save' ? {} : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select(); p.input('note-content', '未确认稿'); await p.click('save-draft');
  assert.equal(p.$('note-content').value, '未确认稿'); assert.equal(p.$('feedback').dataset.error, 'true'); assert.match(p.$('feedback').textContent, /未确认/);
});

test('private notes remain distinct from drafts and preserve existing media', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'note_detail' ? { ...fixtures.note_detail, status: 'private', type: 'IMAGE', mediaCount: 3 } : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select();
  assert.equal(p.$('note-state').textContent, '仅自己可见'); assert.equal(p.$('note-visibility').value, 'private'); assert.match(p.$('note-images').textContent, /3 张/);
  p.input('note-content', '新正文'); await p.click('publish-note'); await p.click('accept-confirm');
  const args = p.calls.find(call => call.action === 'note_save').args;
  assert.equal(args.status, 'private'); assert.equal(args.confirmed, true); assert.equal('media' in args, false); assert.equal('type' in args, false);
});
test('business type is required only for creation and does not invent a default', async t => {
  const p = await panel(); t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.click('new-note');
  p.input('note-title', '标题'); p.input('note-content', '正文'); await p.click('save-draft');
  assert.equal(p.calls.some(call => call.action === 'note_save'), false); assert.equal(p.$('note-business').value, '');
});
test('sms and login require consent and cooldown prevents a second sms', async t => {
  let loggedIn = false;
  const p = await panel({ invoke: ({ action }) => action === 'status' ? (loggedIn ? fixtures.status : { connected: false }) : action === 'sms' ? { sent: true } : action === 'login' ? (loggedIn = true, fixtures.status) : undefined });
  t.after(() => p.dom.window.close()); p.input('mobile', '13800000000'); await p.click('send-code');
  assert.equal(p.calls.some(call => call.action === 'sms'), false);
  p.$('agreement').click(); await p.click('send-code'); await p.click('send-code');
  assert.equal(p.calls.filter(call => call.action === 'sms').length, 1); assert.match(p.$('send-code').textContent, /60 秒/);
  p.input('auth-code', '123456'); await p.click('login'); assert.equal(p.$('auth-code').value, ''); assert.equal(p.$('mobile').value, '');
  assert.deepEqual(p.calls.find(call => call.action === 'login').args, { mobile: '13800000000', countryCode: '+86', authCode: '123456' });
  assert.equal(p.dom.window.localStorage.length, 0);
});
test('expired login preserves dirty text and same account reconnection permits saving', async t => {
  let expired = true;
  const p = await panel({ invoke: ({ action }) => action === 'note_save' && expired ? JSON.stringify({ ok: false, errorCode: 'auth_required', error: '请重新登录。' }) : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select(); p.input('note-content', '过期仍保留'); await p.click('save-draft');
  assert.equal(p.$('note-content').value, '过期仍保留'); assert.equal(p.$('connection').hidden, false); assert.equal(p.$('save-draft').disabled, true);
  expired = false; await p.click('check-account'); assert.equal(p.$('note-content').value, '过期仍保留'); await p.click('save-draft'); assert.match(p.$('note-state').textContent, /已保存/);
});
test('account change asks before discarding dirty text and prevents saving to the new identity', async t => {
  let identity = 'qa-one';
  const p = await panel({ invoke: ({ action }) => action === 'status' ? { connected: true, displayName: '同名用户', accountId: identity } : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select(); p.input('note-content', '旧账号草稿');
  identity = 'qa-two'; await p.click('check-account'); assert.equal(p.$('confirmation').hidden, false); assert.equal(p.$('save-draft').disabled, true);
  await p.click('cancel-confirm'); assert.equal(p.$('note-content').value, '旧账号草稿');
  await p.click('check-account'); await p.click('accept-confirm'); assert.equal(p.$('editor').hidden, true); assert.equal(p.$('note-content').value, '');
});
test('legal links stay selectable when clipboard is unavailable', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'status' ? { connected: false } : undefined });
  t.after(() => p.dom.window.close()); p.dom.window.document.querySelector('[data-copy="agreement-url"]').click(); await tick();
  assert.match(p.$('feedback').textContent, /手动复制/); assert.equal(p.dom.window.document.activeElement.id, 'agreement-url');
});
test('unknown write outcome locks retries while preserving text for list verification', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'note_save' ? JSON.stringify({ ok: false, errorCode: 'outcome_unknown', error: '响应超时' }) : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); await p.select(); p.input('note-content', '未知保存结果正文'); await p.click('save-draft');
  assert.equal(p.$('save-draft').disabled, true); assert.equal(p.$('publish-note').disabled, true); assert.equal(p.$('delete-note').disabled, true);
  assert.equal(p.$('note-content').value, '未知保存结果正文'); assert.equal(p.$('verify-save').hidden, false);
  await p.click('save-draft'); assert.equal(p.calls.filter(call => call.action === 'note_save').length, 1);
  await p.click('verify-save'); assert.equal(p.$('save-draft').disabled, true); assert.match(p.$('feedback').textContent, /核对/);
  await p.select(); await p.click('accept-confirm'); assert.equal(p.$('save-draft').disabled, false);
});
test('sms timeout never creates a phantom dirty note or a note-write lock', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'status' ? { connected: false } : action === 'sms' ? JSON.stringify({ ok: false, errorCode: 'outcome_unknown', error: '短信发送结果未确认，请稍后核对。' }) : undefined });
  t.after(() => p.dom.window.close()); p.input('mobile', '13800000000'); p.$('agreement').click(); await p.click('send-code');
  assert.match(p.$('feedback').textContent, /短信/); assert.equal(p.$('verify-save').hidden, true);
  await p.click('nav-notes'); assert.equal(p.$('confirmation').hidden, true);
});
test('case filtering only affects the current page while preserving server pagination', async t => {
  const p = await panel({ invoke: ({ action, args }) => action === 'cases' ? { items: [{ id: String(args.page), title: args.page === 1 ? '合同争议' : '劳动争议' }], total: 40, hasMore: args.page === 1 } : undefined });
  t.after(() => p.dom.window.close()); const before = p.calls.length;
  p.input('keyword', '劳动'); p.$('search-form').dispatchEvent(new p.dom.window.Event('submit', { cancelable: true })); await tick();
  assert.equal(p.calls.length, before); assert.equal(p.$('list').children.length, 0);
  assert.match(p.$('empty').textContent, /当前页/); assert.match(p.$('result-count').textContent, /平台共 40 条.*本页匹配 0 条/);
  assert.equal(p.$('next').disabled, false); assert.match(p.$('filter-scope').textContent, /仅筛选当前页/);
  await p.click('next'); assert.match(p.$('list').textContent, /劳动争议/); assert.equal(p.$('page-label').textContent, '第 2 页');
  assert.deepEqual(p.calls.at(-1).args, { page: 2 });
});
test('note keyword searches the service globally but status filters the returned page locally', async t => {
  const p = await panel({ invoke: ({ action }) => action === 'notes' ? { items: [{ id: '1', title: '合同说明', status: 'published' }, { id: '2', title: '合同草稿', status: 'draft' }], total: 30, hasMore: true } : undefined });
  t.after(() => p.dom.window.close()); await p.click('nav-notes'); p.input('keyword', '合同');
  p.$('search-form').dispatchEvent(new p.dom.window.Event('submit', { cancelable: true })); await tick();
  assert.deepEqual(p.calls.at(-1).args, { page: 1, keyword: '合同' }); const before = p.calls.length;
  p.$('status-filter').value = 'draft'; p.$('status-filter').dispatchEvent(new p.dom.window.Event('change')); await tick();
  assert.equal(p.calls.length, before); assert.equal(p.$('list').children.length, 1); assert.match(p.$('list').textContent, /合同草稿/);
  assert.match(p.$('result-count').textContent, /搜索结果共 30 条.*本页匹配 1 条/); assert.equal(p.$('next').disabled, false);
  assert.match(p.$('filter-scope').textContent, /状态仅筛选当前页/);
  p.$('status-filter').value = 'private'; p.$('status-filter').dispatchEvent(new p.dom.window.Event('change')); await tick();
  assert.equal(p.$('list').children.length, 0); assert.match(p.$('empty').textContent, /当前页/);
});
