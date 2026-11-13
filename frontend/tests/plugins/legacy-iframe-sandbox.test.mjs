// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// S26：PluginPane 两种形态都带 sandbox。Web 插件永远不带 allow-same-origin；
// 旧形态（绝对 URL 外站）保留自己的源，但两者都不许顶层导航。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const body = SRC.slice(SRC.indexOf('sandboxAttr() {'), SRC.indexOf('}', SRC.indexOf('sandboxAttr() {')))
const sandboxAttr = new Function('isWebPlugin', body.replace(/^sandboxAttr\(\) \{/, '').replace(/this\.isWebPlugin/g, 'isWebPlugin'))

test('web plugins stay opaque-origin', () => {
  const tokens = sandboxAttr(true).split(' ')
  assert.deepEqual(tokens, ['allow-scripts', 'allow-forms'])
})

test('legacy absolute-URL plugins are sandboxed without top navigation', () => {
  const value = sandboxAttr(false)
  assert.equal(typeof value, 'string')
  const tokens = value.split(' ')
  for (const t of ['allow-scripts', 'allow-forms', 'allow-popups']) assert.ok(tokens.includes(t), t)
  assert.ok(!tokens.some(t => t.startsWith('allow-top-navigation')))
  assert.ok(!tokens.includes('allow-popups-to-escape-sandbox'))
  assert.match(SRC, /:sandbox="sandboxAttr"/)
})
