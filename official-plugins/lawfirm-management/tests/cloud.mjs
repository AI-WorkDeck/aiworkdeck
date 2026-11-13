// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
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
  assert.deepEqual(h.calls.at(-1).params, { feature: 'time', enabled: false, purge: true, expectedVersion: 3 });
  assert.match(h.$('cl-status').textContent, /已删除云端保存的该项数据/);
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
