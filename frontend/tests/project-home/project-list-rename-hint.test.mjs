// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// dev-board BUG-23：方块视图里点击项目名会静默进入重命名态，之前没有任何
// title/tooltip 提示这是可编辑的，用户容易误以为点了空白处。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 2026-09-29 起项目列表的内容本体是工作台左栏「项目」面板（dev-board#1047），pages/project-list 是直链薄壳
const SRC = readFileSync(new URL('../../src/components/project-list/ProjectListPane.vue', import.meta.url), 'utf8')
const ZH = readFileSync(new URL('../../src/locales/zh-CN/projects.js', import.meta.url), 'utf8')
const EN = readFileSync(new URL('../../src/locales/en-US/projects.js', import.meta.url), 'utf8')

test('统一列表的重命名动作有明确 title，点名称只进入项目', () => {
  assert.match(SRC, /@tap.stop="startRename\(project\)" :title="\$t\('projects.rename'\)"/)
  assert.match(SRC, /class="ptable-row" @tap="goToProject\(project.id\)"/)
  assert.doesNotMatch(SRC, /class="project-title-new"/)
})

test('projects.renameHint 中英文案齐备', () => {
  assert.match(ZH, /renameHint:\s*'.+'/)
  assert.match(EN, /renameHint:\s*'.+'/)
})
