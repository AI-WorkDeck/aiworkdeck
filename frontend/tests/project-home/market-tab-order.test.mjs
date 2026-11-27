// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH X41：插件市场侧栏「已安装」与「可安装」两组的类型标签必须同序（技能 / 插件 / MCP），与搜索框占位一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('../../src/components/MarketSidebarPanel.vue', import.meta.url)), 'utf8')

test('installed and available groups list their type tabs in the same order', () => {
  const installed = [...src.matchAll(/\{ key: '(skill|plugin|mcp)', title:/g)].map(m => m[1])
  const available = [...src.matchAll(/marketTab === '(skill|plugin|mcp)' \}" @tap/g)].map(m => m[1])
  assert.deepEqual(installed, ['skill', 'plugin', 'mcp'])
  assert.deepEqual(available, installed)
})
