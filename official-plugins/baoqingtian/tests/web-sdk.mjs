// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const read = name => readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('bundled SDK remains byte-identical; page requests no remote font or script', () => {
  assert.equal(read('awd-plugin-sdk.js'), readFileSync(new URL('../../../sdk/plugin-sdk/awd-plugin-sdk.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(read('panel.css'), /@import|@font-face|url\(\s*["']?https?:/);
  assert.doesNotMatch(read('index.html'), /<script[^>]+src=["']https?:/);
});
test('real SDK completes handshake, unwraps tool output, and follows authenticated theme events', async t => {
  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: 'https://plugin.invalid' }); t.after(() => dom.window.close());
  const calls = [];
  const context = { projectId: 7, pluginId: 'baoqingtian', theme: 'light', themeTokens: { '--awd-surface': '#ffffff' } };
  const parent = { postMessage(message, origin) {
    assert.equal(origin, '*'); calls.push(message);
    queueMicrotask(() => {
      const data = message.params?.args?.action === 'status' ? { connected: true, displayName: '合成账号', accountId: 'synthetic-account' } : { items: [{ id: 'synthetic-case', title: 'SDK案源' }], total: 1, hasMore: false };
      const result = message.method === 'tools.invoke' ? { output: JSON.stringify({ ok: true, data }) } : { subscribed: ['project.switched'] };
      push({ awd: 1, type: 'result', seq: message.seq, ok: true, result });
    });
  } };
  Object.defineProperty(dom.window, 'parent', { value: parent });
  function push(data, source = parent) { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source, data })); }
  for (const name of ['awd-plugin-sdk.js', 'model.js', 'panel.js']) dom.window.eval(read(name));
  push({ awd: 1, type: 'init', context }, {}); await tick(); assert.equal(calls.length, 0);
  push({ awd: 1, type: 'init', context }); await tick();
  assert.match(dom.window.document.getElementById('list').textContent, /SDK案源/);
  assert.ok(calls.some(call => call.method === 'events.subscribe'));
  assert.ok(calls.filter(call => call.method === 'tools.invoke').every(call => call.params.name === 'baoqingtian_action'));
  push({ awd: 1, type: 'theme', theme: 'dark', tokens: { '--awd-surface': '#172f33' } }, {});
  assert.equal(dom.window.document.documentElement.dataset.theme, 'light');
  push({ awd: 1, type: 'theme', theme: 'dark', tokens: { '--awd-surface': '#172f33' } });
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--awd-surface'), '#172f33');
});
