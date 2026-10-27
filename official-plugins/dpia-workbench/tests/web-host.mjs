// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createHostAdapter } from '../web-src/host-adapter.mjs';
import { adaptUpstream } from '../web-src/adapt-upstream.mjs';

test('source pin preserves the upstream client and adapter rejects changed boundaries', () => {
  const source = readFileSync(new URL('../web-src/upstream-client.js', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), 'e4bb78d004a798cd9640b2b0df56180b94fdcaa6416327253be0c44482fe9efe');
  assert.doesNotMatch(adaptUpstream(source), /__ModuleLoader__|createObjectURL|atob\(out\.base64\)/);
  assert.throws(() => adaptUpstream(source.replace('function download(content,name,type)', 'function changedDownload(content,name,type)')), /Upstream adapter expected/);
});

test('RPC preserves payload and surfaces backend errors without admitting malformed results', async () => {
  let output = JSON.stringify({ ok: true, value: { version: 7 } });
  const calls = [];
  const host = createHostAdapter({ tools: { invoke: async (...args) => { calls.push(args); return output; } } });
  const payload = { action: 'answerDraft', id: 'case-a', version: 6, text: '原文', attachmentSourceIds: ['source-a'] };
  assert.deepEqual(await host.rpc(payload), { version: 7 });
  assert.equal(calls[0][0], 'dpia_workbench_action');
  assert.equal(calls[0][1].action, 'answerDraft');
  assert.deepEqual(JSON.parse(calls[0][1].json), payload);
  output = JSON.stringify({ ok: false, error: { message: 'STALE_VERSION', details: { current: 7 } } });
  await assert.rejects(host.rpc(payload), (error) => error.message === 'STALE_VERSION' && error.details.current === 7);
  output = '<html>gateway failure</html>';
  await assert.rejects(host.rpc(payload), /响应不完整/);
});

test('session opening resolves a server-owned conversation and exports open only project paths', async () => {
  const calls = [];
  const host = createHostAdapter({
    tools: { invoke: async (name, args) => { calls.push(JSON.parse(args.json)); return JSON.stringify({ ok: true, value: { conversationId: 'conv-owned' } }); } },
    call: async (method, args) => calls.push({ method, ...args }),
    ui: { openFile: async (path) => calls.push({ path }) },
  });
  await host.openSession('session-case');
  assert.deepEqual(calls.slice(0, 2), [{ action: 'sessionInfo', sessionId: 'session-case' }, { method: 'chat.open', conversationId: 'conv-owned' }]);
  await host.openArtifact({ fileId: 1, path: 'DPIA/报告.docx' });
  assert.deepEqual(calls[2], { path: 'DPIA/报告.docx' });
  await assert.rejects(host.openArtifact({ base64: 'AAAA', filename: 'report.docx' }), /尚未保存到项目/);
});

test('project/account disposal blocks late replies and opening files or chats', async () => {
  let release;
  const opens = [];
  const host = createHostAdapter({ tools: { invoke: () => new Promise((resolve) => { release = resolve; }) }, call: (...args) => opens.push(args), ui: { openFile: (...args) => opens.push(args) } });
  const pending = host.openSession('session-old');
  host.dispose();
  release(JSON.stringify({ ok: true, value: { conversationId: 'conv-old' } }));
  await assert.rejects(pending, /已切换/);
  await assert.rejects(host.openArtifact({ path: '旧项目/报告.docx' }), /已切换/);
  assert.deepEqual(opens, []);
});

test('official source links use host opening and reject non-web or credentialed URLs', async () => {
  const calls = [];
  const host = createHostAdapter({ call: async (...args) => calls.push(args) });
  await host.openUrl('https://www.edpb.europa.eu/example');
  assert.deepEqual(calls, [['ui.openUrl', { url: 'https://www.edpb.europa.eu/example' }]]);
  for (const url of ['javascript:alert(1)', 'file:///private/a', 'https://user:password@example.org']) await assert.rejects(host.openUrl(url));
  assert.equal(calls.length, 1);
});
