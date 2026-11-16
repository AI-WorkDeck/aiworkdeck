// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { JSDOM } = createRequire(new URL('../../../frontend/package.json', import.meta.url))('jsdom');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = read('../web/index.html');
const l10nScript = read('../web/expenses-l10n.js');
const script = read('../web/cloud.js');
const tick = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

function harness({ language = 'zh-CN', settings, onSet } = {}) {
  const dom = new JSDOM(html, { url: 'https://plugin.test', runScripts: 'outside-only' });
  const calls = [];
  let current = settings;
  dom.window.awd = {
    ready: async () => ({ language }),
    call: async (method, { action, params }) => {
      calls.push({ action, params: JSON.parse(JSON.stringify(params)) });
      if (action === 'cloud.settings.get') {
        if (current instanceof Error) throw current;
        return current;
      }
      if (action === 'cloud.settings.set') {
        const next = onSet(params, current);
        if (next instanceof Error) throw next;
        current = next;
        return current;
      }
      throw new Error('unexpected ' + action);
    }
  };
  dom.window.eval(l10nScript);
  dom.window.eval(script);
  const doc = dom.window.document;
  return { dom, doc, calls, $: (id) => doc.getElementById(id), click: async (n) => { n.click(); await tick(); } };
}

const base = (over = {}) => ({ firmAdmin: true, name: '林合伙人', version: 2, switches: { clients: false, time: true, pitch: false }, features: ['clients', 'time', 'pitch'], ...over });

test('every cloud.* key used exists in zh-CN and en-US with matching placeholders', () => {
  const zh = JSON.parse(read('../l10n/zh-CN.json'));
  const en = JSON.parse(read('../l10n/en-US.json'));
  const used = [...html.matchAll(/data-cl="([^"]+)"/g), ...script.matchAll(/\bt\('(cloud\.[^']+)'/g)].map((m) => m[1]);
  for (const k of used) { assert.ok(zh[k], `zh-CN ${k}`); assert.ok(en[k], `en-US ${k}`); }
  const keys = (o) => Object.keys(o).filter((k) => k.startsWith('cloud.')).sort();
  assert.deepEqual(keys(zh), keys(en));
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of keys(zh)) assert.equal(ph(zh[k]), ph(en[k]), k);
});

test('admin sees every registered feature and toggles with the version they saw', async (t) => {
  const h = harness({ settings: base(), onSet: (p, cur) => ({ ...cur, version: cur.version + 1, switches: { ...cur.switches, [p.feature]: p.enabled } }) });
  t.after(() => h.dom.window.close());
  await h.click(h.$('tab-cloud'));
  const cards = [...h.doc.querySelectorAll('[data-feature]')];
  assert.deepEqual(cards.map((c) => c.dataset.feature), ['clients', 'time', 'pitch']);
  assert.match(cards[1].textContent, /计时工时汇总.*已开启/);
  assert.match(cards[1].textContent, /工作内容描述可能涉及客户信息/);
  await h.click(h.doc.querySelector('[data-feature="clients"] [data-action="turn-on"]'));
  assert.deepEqual(h.calls.at(-1), { action: 'cloud.settings.set', params: { feature: 'clients', enabled: true, purge: false, expectedVersion: 2 } });
  assert.match(h.$('cl-status').textContent, /已开启：客户与主体资料/);
  const time = h.doc.querySelector('[data-feature="time"]');
  const purgeBox = time.querySelector('[data-field="purge"]');
  purgeBox.checked = true;
  purgeBox.dispatchEvent(new h.dom.window.Event('change'));
  assert.equal(time.querySelector('[data-action="turn-off"]').textContent, '关闭并删除云端数据', 'deleting is spelled out on the button');
  await h.click(time.querySelector('[data-action="turn-off"]'));
  await h.click(time.querySelector('[data-action="purge-confirm"]'));
  assert.deepEqual(h.calls.at(-1).params, { feature: 'time', enabled: false, purge: true, expectedVersion: 3 });
  assert.match(h.$('cl-status').textContent, /已删除云端保存的该项数据/);
});

test('turning off with delete never deletes without the explicit confirm; cancel sends nothing; plain off stays one click', async (t) => {
  const h = harness({ settings: base({ switches: { clients: true, time: true, pitch: false } }), onSet: (p, cur) => ({ ...cur, version: cur.version + 1, switches: { ...cur.switches, [p.feature]: p.enabled } }) });
  t.after(() => h.dom.window.close());
  await h.click(h.$('tab-cloud'));
  const sets = () => h.calls.filter((c) => c.action === 'cloud.settings.set');
  const time = h.doc.querySelector('[data-feature="time"]');
  const box = time.querySelector('[data-field="purge"]');
  box.checked = true;
  box.dispatchEvent(new h.dom.window.Event('change'));
  await h.click(time.querySelector('[data-action="turn-off"]'));
  assert.equal(sets().length, 0, 'the first click only asks');
  const ask = time.querySelector('[data-role="purge-confirm"]');
  assert.equal(ask.hidden, false);
  // 写明功能、本所范围、删什么、不可恢复
  assert.match(ask.textContent, /本所/);
  assert.match(ask.textContent, /「计时工时汇总」/);
  assert.match(ask.textContent, /所有律师提交的工时、审核结论和已发布的事项/);
  assert.match(ask.textContent, /无法恢复/);
  assert.ok(time.querySelector('[data-action="turn-off"]').disabled, 'the off button waits for the answer');
  await h.click(ask.querySelector('[data-action="purge-cancel"]'));
  assert.equal(ask.hidden, true);
  assert.equal(sets().length, 0, 'cancel sends nothing');
  // 勾掉删除后再关：普通关闭，一步完成、不删除
  await h.click(time.querySelector('[data-action="turn-off"]'));
  assert.equal(sets().length, 0, 'still checked: asks again instead of deleting');
  box.checked = false;
  box.dispatchEvent(new h.dom.window.Event('change'));
  assert.equal(ask.hidden, true, 'unticking closes the question');
  assert.equal(time.querySelector('[data-action="turn-off"]').disabled, false, 'and gives the off button back');
  const clients = h.doc.querySelector('[data-feature="clients"]');
  await h.click(clients.querySelector('[data-action="turn-off"]'));
  assert.deepEqual(sets().at(-1).params, { feature: 'clients', enabled: false, purge: false, expectedVersion: 2 });
  assert.equal(sets().length, 1);
  // 只有点「确认关闭并删除」才带 purge: true
  const time2 = h.doc.querySelector('[data-feature="time"]');
  const box2 = time2.querySelector('[data-field="purge"]');
  box2.checked = true;
  box2.dispatchEvent(new h.dom.window.Event('change'));
  await h.click(time2.querySelector('[data-action="turn-off"]'));
  assert.equal(sets().length, 1);
  await h.click(time2.querySelector('[data-action="purge-confirm"]'));
  assert.deepEqual(sets().at(-1).params, { feature: 'time', enabled: false, purge: true, expectedVersion: 3 });
  assert.equal(sets().filter((c) => c.params.purge).length, 1, 'exactly one delete, and only after confirm');
});

test('the delete question is tokenized: English names the feature and what goes', async (t) => {
  const h = harness({ language: 'en-US', settings: base(), onSet: (p, cur) => ({ ...cur, switches: { ...cur.switches, [p.feature]: p.enabled } }) });
  t.after(() => h.dom.window.close());
  await h.click(h.$('tab-cloud'));
  const time = h.doc.querySelector('[data-feature="time"]');
  const box = time.querySelector('[data-field="purge"]');
  box.checked = true;
  box.dispatchEvent(new h.dom.window.Event('change'));
  await h.click(time.querySelector('[data-action="turn-off"]'));
  const ask = time.querySelector('[data-role="purge-confirm"]').textContent;
  assert.match(ask, /your firm's/);
  assert.match(ask, /cannot be undone/);
  assert.match(ask, /time entries lawyers submitted/);
  assert.doesNotMatch(ask, /[\u4e00-\u9fff]/);
});

test('stale version shows the server message and reloads; non-admins get a read-only view', async (t) => {
  const h = harness({ settings: base(), onSet: () => new Error('该记录已被同事修改，请刷新后再改') });
  t.after(() => h.dom.window.close());
  await h.click(h.$('tab-cloud'));
  const gets = () => h.calls.filter((c) => c.action === 'cloud.settings.get').length;
  const before = gets();
  await h.click(h.doc.querySelector('[data-feature="pitch"] [data-action="turn-on"]'));
  assert.equal(h.$('cl-status').dataset.error, 'true');
  assert.match(h.$('cl-status').textContent, /已被同事修改/);
  assert.equal(gets(), before + 1, 'reloaded after the conflict');

  const r = harness({ settings: base({ firmAdmin: false }), onSet: () => assert.fail('no set for non-admin') });
  t.after(() => r.dom.window.close());
  await r.click(r.$('tab-cloud'));
  assert.match(r.$('cl-who').textContent, /只有律所管理员/);
  assert.equal(r.doc.querySelectorAll('[data-action]').length, 0);
});

test('unreachable or old service shows the reason; unknown features get a generic label; English is tokenized', async (t) => {
  const h = harness({ settings: new Error('所连接的协作服务尚未升级到支持律所云端的版本') });
  t.after(() => h.dom.window.close());
  await h.click(h.$('tab-cloud'));
  assert.match(h.$('cl-features').textContent, /尚未升级/);

  const e = harness({ language: 'en-US', settings: base({ switches: { archive: false, pitch: true },
    labels: { pitch: { names: { 'zh-CN': '投标业绩库', 'en-US': 'Pitch library' }, descriptions: { 'en-US': 'Shared experience entries.' } } } }), onSet: (p, c) => c });
  t.after(() => e.dom.window.close());
  await tick();
  await e.click(e.$('tab-cloud'));
  assert.equal(e.$('tab-cloud').textContent.trim(), 'Firm cloud');
  assert.match(e.doc.querySelector('[data-feature="archive"]').textContent, /Firm cloud feature \(archive\)/);
  assert.match(e.doc.querySelector('[data-feature="pitch"]').textContent, /Pitch library.*Shared experience entries\./, 'feature-supplied labels win over plugin strings');
});

test('on an older host without Firm cloud actions the 律所云端 tab hides itself; other tabs stay', async (t) => {
  const h = harness({ settings: new Error('不支持的律所管理操作：cloud.settings.get') });
  t.after(() => h.dom.window.close());
  await tick();
  assert.equal(h.$('tab-cloud').hidden, true);
  assert.equal(h.$('panel-cloud').hidden, true);
  assert.equal(h.$('tab-finance').hidden, false);
  assert.equal(h.$('tab-expense').hidden, false);
});

test('每个标签页面板都是并列的顶层区块，律所云端不能嵌在隐藏的计时收费面板里', () => {
  const doc = new JSDOM(html).window.document;
  const panels = [...doc.querySelectorAll('.tab-panel')];
  assert.ok(panels.some((p) => p.id === 'panel-cloud'));
  for (const p of panels) {
    assert.equal(p.parentElement.closest('.tab-panel'), null, `${p.id} 嵌套在 ${p.parentElement.closest('.tab-panel')?.id} 里`);
  }
});
