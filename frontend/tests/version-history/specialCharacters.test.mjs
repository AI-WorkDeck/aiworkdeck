// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/EditorToolbar.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
const imports = [...script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)].flatMap(m => m[1].replace(/[{},]/g, ' ').split(/\s+/).filter(Boolean))
const body = script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default {', 'const toolbar = {') + '\n return { toolbar, hosts: VIEW_PREFS_HOSTS }'
const keys = ['paragraphMarks', 'lineBreaks', 'spaces', 'tabs']
function harness(stored = '', { failStorage = false, failEngine = false } = {}) {
  const emitted = [], calls = [], notices = []
  let saved = stored
  const uni = {
    getStorageSync: () => saved,
    setStorageSync: (key, value) => { if (failStorage) throw Error('quota'); saved = value },
    showToast: m => notices.push(m),
  }
  const { toolbar, hosts } = new Function('uni', ...imports, body)(uni, ...imports.map(() => () => {}))
  const make = () => {
    const host = { ...toolbar.data(), ...toolbar.methods, $emit: name => emitted.push(name), $t: s => s,
      async call(action, params) {
        calls.push([action, params])
        if (action === 'set_view_options') {
          if (failEngine) return { success: false }
          host.state.view = { ...params }
        }
        return { success: true }
      }, async refresh() {},
    }
    Object.defineProperty(host, 'formattingMarks', { get: () => toolbar.computed.formattingMarks.call(host) })
    hosts.add(host)
    return host
  }
  return { make, calls, notices, emitted, saved: () => saved }
}

test('旧开关迁移保留，损坏存储使用默认值', () => {
  for (const stored of ['', '{broken', JSON.stringify({ formattingMarks: false, ruler: false }), { formattingMarks: false, ruler: false }]) {
    const h = harness(stored), host = h.make()
    const old = typeof stored === 'object' || String(stored).includes('formattingMarks')
    assert.equal(host.viewPrefs.formattingMarks, !old)
    assert.equal(host.viewPrefs.ruler, !old)
    for (const key of keys) assert.equal(host.viewPrefs[key], true)
  }
})
test('全部隐藏后只勾选换行；其它活动文档与重建实例均同步，重载不标脏', async () => {
  const h = harness(), a = h.make(), b = h.make()
  await a.setAllMarks(false)
  assert.equal(a.formattingMarks, false)
  await a.setMark('lineBreaks', true)
  const expected = { ruler: true, formattingMarks: true, paragraphMarks: false, lineBreaks: true, spaces: false, tabs: false }
  assert.deepEqual(a.viewPrefs, expected)
  assert.deepEqual(b.viewPrefs, expected)
  const reopened = h.make()
  assert.deepEqual(reopened.viewPrefs, expected)
  await reopened.reapplyChrome()
  assert.deepEqual(h.calls.at(-1), ['set_view_options', { ...expected, textBoundaries: false }])
  assert.equal(h.emitted.includes('changed'), false)
  await a.setMark('lineBreaks', false)
  assert.equal(a.formattingMarks, false)
  await a.setAllMarks(true)
  for (const key of keys) assert.equal(a.markVisible(key), true)
})
for (const failure of ['failStorage', 'failEngine']) test(`${failure}: 不保存失败目标、不广播，解除忙碌并提示`, async () => {
  const old = JSON.stringify({ formattingMarks: true, ruler: false })
  const h = harness(old, { [failure]: true }), a = h.make()
  const previous = { ...a.viewPrefs }
  await a.setAllMarks(false)
  assert.equal(h.saved(), old)
  assert.deepEqual(a.viewPrefs, previous)
  assert.equal(a.viewPrefsBusy, false)
  assert.equal(h.notices.length, 1)
})
test('正在应用时禁止第二次提交，避免快速点击覆盖已选状态', async () => {
  const h = harness(), a = h.make()
  let release
  a.call = () => new Promise(resolve => { release = resolve })
  const pending = a.setAllMarks(false)
  await a.setMark('spaces', true)
  assert.equal(a.viewPrefsBusy, true)
  await Promise.resolve()
  release({ success: true })
  await pending
  assert.equal(a.viewPrefs.formattingMarks, false)
  assert.equal(a.viewPrefs.spaces, false)
})

test('两文档并发修改按最新偏好合并，所有引擎与存储一致', async () => {
  const h = harness(), a = h.make(), b = h.make()
  await Promise.all([a.setMark('spaces', false), b.setMark('tabs', false)])
  const persisted = JSON.parse(h.saved())
  assert.equal(persisted.spaces, false)
  assert.equal(persisted.tabs, false)
  for (const host of [a, b]) {
    assert.deepEqual(host.viewPrefs, persisted)
    for (const key of keys) assert.equal(host.state.view[key], persisted[key])
  }
})
