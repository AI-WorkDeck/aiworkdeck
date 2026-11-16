// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 英文界面里不该出现服务端写进数据的中文固定标签（0.86 RC：审计日志「账户桥接」「客户(通用)」，
// 记忆页「个人记忆」）。只在显示时翻，存的数据不改；别的文字（项目名、律师起的名）原样。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { displayServerLabel } from '../../src/utils/serverLabels.js'
import en from '../../src/locales/en-US/common.js'

const t = (key) => { const k = key.replace(/^common\./, ''); return en[k] || key }

test('服务端写的固定中文标签按界面语言显示', () => {
  assert.equal(displayServerLabel(t, '账户桥接'), 'Account bridge')
  assert.equal(displayServerLabel(t, '客户(通用)'), 'Client (general)')
  assert.equal(displayServerLabel(t, '客户（通用）'), 'Client (general)')
  assert.equal(displayServerLabel(t, '个人记忆'), 'Personal memory')
  assert.equal(displayServerLabel(t, '项目记忆'), 'Project memory')
})

test('别的文字原样：项目名、律师起的名、空值', () => {
  assert.equal(displayServerLabel(t, '岚屿精密 IPO'), '岚屿精密 IPO')
  assert.equal(displayServerLabel(t, '账户桥接（我的 MacBook）'), '账户桥接（我的 MacBook）')
  assert.equal(displayServerLabel(t, null), null)
  assert.equal(displayServerLabel(t, ''), '')
})

test('审计日志表格与记忆空间名都走这个映射（导出的 CSV 不走，保持原样）', () => {
  const audit = readFileSync(new URL('../../src/components/admin/FirmAuditLogPanel.vue', import.meta.url), 'utf8')
  assert.match(audit, /serverLabel\(e\.targetLabel\)/)
  assert.match(audit, /serverLabel\(e\.actorName\)/)
  const memory = readFileSync(new URL('../../src/components/MemoryBrowser.vue', import.meta.url), 'utf8')
  assert.match(memory, /displayServerLabel\(this\.\$t\.bind\(this\), space\.label\)/)
  assert.match(memory, /serverLabel\(file\.title\)/, 'the memory file list title (「个人记忆」 heading made in a Chinese UI) is localized for display')
})
