// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH X18：.awd-btn 只在 App.vue 定义一次。组件里重定义 .awd-btn / -primary / -secondary / -danger 只许出现在
// 下面的存量名单里（只许减少），主按钮必须是品牌色（版本面板曾经是蓝色）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))
const LEGACY = new Set([
  'components/ChatInterface.vue',
  'components/FileTree.vue',
  'components/BuiltinWorkflowEditor.vue',
  'components/RechargeDialog.vue',
  'components/PluginSubscribeDialog.vue',
  'components/ProSubscribeDialog.vue',
  'components/CloudAcceptDialog.vue',
  'pages/project-overview/project-overview.scss',
])
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const files = walk(SRC).filter((f) => /\.(vue|scss|css)$/.test(f)).map((f) => path.relative(SRC, f).split(path.sep).join('/'))
const RULE = /(^|\n)\s*\.awd-btn(?:-(?:primary|secondary|danger))?(?:[:.][\w-]+)?\s*[{,]/

test('App.vue defines the shared .awd-btn family with a brand-colour primary', () => {
  const app = readFileSync(path.join(SRC, 'App.vue'), 'utf8')
  assert.match(app, /\n\.awd-btn \{/)
  assert.match(app, /\.awd-btn-primary \{ background: var\(--awd-accent\)/)
})

test('no new component redefines .awd-btn (legacy list may only shrink)', () => {
  const offenders = files.filter((f) => f !== 'App.vue' && RULE.test(readFileSync(path.join(SRC, f), 'utf8')))
  assert.deepEqual(offenders.filter((f) => !LEGACY.has(f)), [])
  for (const f of LEGACY) assert.ok(offenders.includes(f), `${f} no longer redefines .awd-btn; remove it from LEGACY`)
})
