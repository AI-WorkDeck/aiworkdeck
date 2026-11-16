// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 英文 QA 2026-11-14 第 2 条：AI 输入框上方的选区卡片显示「( chars)」。两处都错：模板传
// { count }，词条用 {n}；传的字段 charCount 在卡片对象上根本不存在（字段名是 length）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildActiveSelectionChip } from '../../src/pages/project-overview/activeSelectionContext.js'
import en from '../../src/locales/en-US/chat.js'

const chat = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')

test('selection chip count: template param matches the {n} placeholder and reads a real field', () => {
  const calls = [...chat.matchAll(/\$t\('chat\.activeSelectionChipCount', \{ (\w+): activeSelectionChip\.(\w+) \}\)/g)]
  assert.equal(calls.length, 2, 'both chip renderings')
  assert.match(en.activeSelectionChipCount, /\{n\}/)
  const chip = buildActiveSelectionChip({ fileId: 7, text: '设备购销合同' }, { id: 7 })
  for (const [, param, field] of calls) {
    assert.equal(param, 'n')
    assert.equal(chip[field], 6, 'field ' + field + ' must exist on the chip and hold the character count')
  }
})
