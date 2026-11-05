// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 教程问题 87（dev-board#1713）：常用工具抽屉记住上次选中的 tab；第一次打开默认剪贴板
// （原来固定落在底栏第一个——收藏夹）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/pages/project-overview/panelDocking.js', import.meta.url), 'utf8')
const PAGE = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const body = SRC.replace(/^import[\s\S]*?from '[^']*'\n/gm, '').replace(/^export /gm, '') + '\nreturn panelDockingMethods'

function vmWith(stored, bottomKeys) {
  const store = new Map(stored ? [['awd_tools_drawer_tab', stored]] : [])
  const uni = { getStorageSync: (k) => store.get(k) || '', setStorageSync: (k, v) => store.set(k, v) }
  // eslint-disable-next-line no-new-func
  const methods = new Function('uni', 'track', 'DOCKS', 'isDockAllowed', 'isMovablePanel', 'resolveDock', 'migrateLeftPaneKey', 'NO_PROJECT_DEFAULT_PANE', body)(
    uni, () => {}, [], () => true, () => false, () => 'bottom', (k) => ({ clipboard: 'plugin-clipboard', favorites: 'plugin-favorites' }[k] || k), '')
  const vm = { activeToolKey: 'variables', showToolsPanel: false, rightPaneKey: 'ai', leftPaneKey: 'files',
    panelDocks: { left: [], right: [], bottom: bottomKeys.map((key) => ({ key })) } }
  return { vm: Object.assign(vm, methods), store }
}

test('87: 第一次打开默认剪贴板', () => {
  const { vm } = vmWith('', ['plugin-favorites', 'plugin-clipboard'])
  vm.normalizeDockSelections()
  assert.equal(vm.activeToolKey, 'plugin-clipboard')
})

test('87: 记住上次选中的 tab', () => {
  const { vm } = vmWith('plugin-favorites', ['plugin-favorites', 'plugin-clipboard'])
  vm.normalizeDockSelections()
  assert.equal(vm.activeToolKey, 'plugin-favorites')
})

test('87: 记住的 tab 已搬走时退回剪贴板 / 第一个', () => {
  const { vm } = vmWith('plugin-voice', ['plugin-favorites'])
  vm.normalizeDockSelections()
  assert.equal(vm.activeToolKey, 'plugin-favorites')
})

test('87: 用户切 tab 时写进存储', () => {
  const start = PAGE.indexOf('switchToolTab(key) {')
  const fn = PAGE.slice(start, PAGE.indexOf('\n    },', start))
  assert.match(fn, /rememberToolTab\(/)
  const { vm, store } = vmWith('', [])
  vm.rememberToolTab('plugin-favorites')
  assert.equal(store.get('awd_tools_drawer_tab'), 'plugin-favorites')
})
