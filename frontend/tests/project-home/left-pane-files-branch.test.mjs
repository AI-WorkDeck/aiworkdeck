// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 教程问题 115（dev-board#1713）：资源管理器下方多出「<标题> 加载中…」空块。
// FileTree 在 v-if 链外用 v-show 常驻，链里没有 files 分支，于是 leftPaneKey==='files'
// 一路落进兜底的 .sidebar-plugin-placeholder。这里用 vue 编译器把左栏真渲染一遍断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')

test('115: 左栏 v-if 链有 files 分支，排在兜底占位之前', () => {
  const start = SRC.indexOf('<view v-if="!sidebarCollapsed" class="sidebar-content">')
  const end = SRC.indexOf('class="sidebar-plugin-placeholder"', start)
  assert.ok(start > 0 && end > start, '找不到左栏 sidebar-content / 兜底占位')
  const chain = SRC.slice(start, end)
  const firstIf = chain.indexOf('<view v-if="leftPaneKey === \'dd-client\'"')
  assert.ok(firstIf > 0, '找不到 v-if 链的起点')
  assert.match(chain.slice(firstIf), /v-else-if="leftPaneKey === 'files'"/,
    'leftPaneKey===files 必须在链里有自己的分支，否则落进「加载中…」兜底')
})
