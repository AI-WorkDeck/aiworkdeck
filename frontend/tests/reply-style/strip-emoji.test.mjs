// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 助手回答去 emoji 的兜底：样例取自 2026-11-12 评测里 Qwen / DeepSeek 的真实回答。
import test from 'node:test'
import assert from 'node:assert/strict'
import { stripEmoji } from '../../src/utils/stripEmoji.js'

test('removes status emoji used by models', () => {
  assert.equal(stripEmoji('### ✅ 第一条：第五百零九条 — 引用正确'), '### 第一条：第五百零九条 — 引用正确')
  assert.equal(stripEmoji('| 一 | 第五百零九条 | ❌ 错误 |'), '| 一 | 第五百零九条 | 错误 |')
  assert.equal(stripEmoji('**⚠️ One problem remains:** x'), '**One problem remains:** x')
  assert.equal(stripEmoji('## 📊 结论'), '## 结论')
  assert.equal(stripEmoji('已完成🎉。'), '已完成。')
})

test('handles sequences, skin tones and keycaps', () => {
  assert.equal(stripEmoji('👨‍⚖️ 法官'), '法官')
  assert.equal(stripEmoji('👍🏻 好'), '好')
  assert.equal(stripEmoji('1️⃣ 第一步'), '1 第一步')
})

test('keeps text symbols used in legal writing', () => {
  const s = '© 2026 甲方 ↔ 乙方 ▶ 见第 3 条 ™ ® ✓ ★ § ¶ →'
  assert.equal(stripEmoji(s), s)
  assert.equal(stripEmoji('《民法典》第585条「违约金」'), '《民法典》第585条「违约金」')
  assert.equal(stripEmoji(''), '')
  assert.equal(stripEmoji(null), '')
})
