// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const start = source.indexOf('  onLoad(query) {')
const end = source.indexOf('    this.showWelcomeOnStartup =', start)
const onLoad = new Function('loadSiteLinks', 'syncRecentToMenuFetching', 'setTimeout', `return ({${source.slice(start, end)}\n}}).onLoad`)(() => {}, () => {}, () => {})
const toggleStart = source.indexOf('    toggleAiPanel() {')
const toggleEnd = source.indexOf('\n    },', toggleStart)
const toggleAiPanel = new Function(`return ({${source.slice(toggleStart, toggleEnd)}\n}}).toggleAiPanel`)()

function openProject(id) {
  const ticks = []
  const vm = {
    projectId: null, showAiPanel: false, aiPanelMounted: false, rightPaneKey: 'ai',
    get hasProject() { return this.projectId != null },
    initRestartRecovery() {}, loadLicenseMode() {}, loadWalletBalance() {}, loadProjectInfo() {},
    maybePromptOptionalComponents() {}, toggleAiPanel,
    $nextTick(fn) { ticks.push(fn) }, triggerWorkbenchResize() {}, refreshAiContextPreview() {},
    fetchChatHistory() {}, restoreLastConversation() {},
  }
  onLoad.call(vm, id == null ? {} : { id: String(id) })
  ticks.splice(0).forEach(fn => fn())
  return vm
}

test('opening a project displays and mounts AI without a separate click; reopening or switching does the same', () => {
  for (const id of [1, 1, 2]) {
    const vm = openProject(id)
    assert.equal(vm.showAiPanel, true)
    assert.equal(vm.aiPanelMounted, true)
    assert.equal(vm.rightPaneKey, 'ai')
    vm.toggleAiPanel()
    assert.equal(vm.showAiPanel, false, 'manual close remains available within this project visit')
  }
})

test('welcome shell without a project keeps AI unmounted', () => {
  const vm = openProject(null)
  assert.equal(vm.showAiPanel, false)
  assert.equal(vm.aiPanelMounted, false)
})

test('default open belongs to initial project entry, never focus/account refresh or a visibility watcher', () => {
  const onShow = source.slice(source.indexOf('  onShow() {'), source.indexOf('  mounted() {'))
  assert.doesNotMatch(onShow, /toggleAiPanel\(/)
  const refresh = source.slice(source.indexOf('    refreshAccountState() {'), source.indexOf('    refreshAccountState() {') + 400)
  assert.doesNotMatch(refresh, /toggleAiPanel\(/)
})
