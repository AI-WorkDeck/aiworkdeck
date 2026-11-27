// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

// 0.91.0 国际站检查：设置页钱包卡开着时，两轮 AI 之后仍显示 $3.00（官网已是 $2.96）
test('a finished platform turn refreshes the wallet with a fresh balance', () => {
  const chat = read('../../src/components/ChatInterface.vue')
  assert.match(chat, /tokenUsage\.value\.platform\)\) return\s*\n\s*setTimeout\(\(\) => uni\.\$emit\('awd:wallet-refresh', \{ fresh: true \}\), 3000\)/)
  const api = read('../../src/services/api.js')
  assert.match(api, /export function getAccountBalance\(opts = \{\}\)/)
  assert.match(api, /'\/api\/account\/balance' \+ \(opts && opts\.fresh \? '\?fresh=1' : ''\)/)
  const admin = read('../../src/components/admin/AdminPane.vue')
  assert.match(admin, /this\.loadWallet\(!!\(payload && payload\.fresh\)\)/)
  assert.match(admin, /async loadWallet\(fresh = false\)[\s\S]*?getAccountBalance\(\{ fresh \}\)/)
  const workbench = read('../../src/pages/project-overview/project-overview.vue')
  assert.match(workbench, /this\.loadWalletBalance\(!!\(payload && payload\.fresh\)\)/)
})
