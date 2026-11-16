// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 英文 QA 2026-11-14 第 5 条：会话行写成「Groups · Owner」——行内类型借用了复数的筛选标签。
// 抠出生产的 conversationLabel / roleName 真跑，词条取真实 en-US。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import en from '../../src/locales/en-US/panels.js'

const src = readFileSync(new URL('../../src/components/PluginWorkspaceSummary.vue', import.meta.url), 'utf8')
const slice = (name) => {
  const i = src.indexOf('\n    ' + name + '(')
  assert.ok(i > 0, name)
  let depth = 0, j = src.indexOf('{', i)
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break }
  return src.slice(i, j + 1)
}

test('conversation rows use the singular type label (Group · Owner, Direct · Owner)', () => {
  const methods = new Function(`return ({${slice('conversationLabel')},${slice('roleName')}})`)()
  const vm = { ...methods, tr: (key, fb) => (key.startsWith('panels.') ? en[key.slice(7)] : undefined) || fb }
  for (const k of Object.keys(methods)) vm[k] = methods[k].bind(vm)
  assert.equal(vm.conversationLabel({ type: 'GROUP', role: 'OWNER' }), 'Group · Owner')
  assert.equal(vm.conversationLabel({ type: 'DIRECT', role: 'OWNER' }), 'Direct · Owner')
  assert.equal(en.pwsFilterGroup, 'Groups', 'the filter chip stays plural')
})
