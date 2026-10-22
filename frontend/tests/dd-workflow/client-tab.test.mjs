// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ddClientTabMethods } from '../../src/pages/project-overview/ddClientTab.js'
import { isPaneAllowedWithoutProject } from '../../src/pages/project-overview/noProjectShell.js'
import { isContextEligibleTab } from '../../src/pages/project-overview/activeTabContext.js'
import { serializeTab, restore, TAB_SNAPSHOT_VERSION } from '../../src/pages/project-overview/tabSnapshot.js'
const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const vm = overrides => ({ leftFiles: [], rightFiles: [], focusedPane: 'left', splitMode: false, $t: k => k, $nextTick: f => f(), triggerWorkbenchResize() {}, ...overrides })

test('full-app client workspace opens without project or main-account role changes', () => {
  const account = { role: 'ADMIN', id: 1 }, state = vm({ currentUser: account })
  ddClientTabMethods.openDdClientTab.call(state)
  assert.equal(isPaneAllowedWithoutProject('dd-client'), true)
  assert.equal(state.activeFileIdLeft, 'dd-client'); assert.equal(state.leftFiles[0].tabType, 'dd-client')
  assert.equal(state.currentUser, account); assert.equal(account.role, 'ADMIN')
  assert.equal(isContextEligibleTab(state.leftFiles[0]), false)
})

test('existing workspace is reused across panes, including a collapsed split', () => {
  const tab = { id: 'dd-client', tabType: 'dd-client' }
  const state = vm({ rightFiles: [tab] }); ddClientTabMethods.openDdClientTab.call(state)
  assert.equal(state.focusedPane, 'right'); assert.equal(state.splitMode, true); assert.equal(state.activeFileIdRight, tab.id); assert.equal(state.leftFiles.length, 0)
})

test('global workspace can be restored without a project and persists no connection credential', () => {
  const saved = serializeTab({ id: 'dd-client', tabType: 'dd-client', name: '客户协作', token: 'secret-not-for-tabs' })
  assert.equal(saved.token, undefined)
  const restored = restore({ v: TAB_SNAPSHOT_VERSION, left: [saved], right: [], activeLeft: 'dd-client', activeRight: null }, { hasProject: false })
  assert.equal(restored.leftFiles?.[0]?.tabType || restored.left?.[0]?.tabType, 'dd-client')
})

test('both editor panes use embedded client workspace and stable keyed lawyer editors', () => {
  assert.equal((page.match(/<DdClientWorkspace v-else-if=/g) || []).length, 2)
  assert.equal((page.match(/:key="activeFile(?:Left|Right)\.id"\s+:request-id=/g) || []).length, 2)
  assert.match(page, /pollDdClientNotifications\(\{ onOpen: \(\) => this\.openDdClientTab\(\) \}\)/)
  assert.match(page, /clearTimeout\(this\._ddClientPollTimer\)/)
})

test('cloud lawyer DD navigation does not migrate a visible DD entry back to files', () => {
  let source = readFileSync(new URL('../../src/pages/project-overview/panelSwitching.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace('export const panelSwitchingMethods =', 'const panelSwitchingMethods =')
  source += '\nreturn panelSwitchingMethods'
  const methods = new Function('isGlobalPlugin','migrateLeftPaneKey','track','isPaneAllowedWithoutProject','workbenchStorageKey','uni',source)(() => false, key => key === 'dd-files' ? 'files' : key, () => {}, isPaneAllowedWithoutProject, () => 'key', { setStorageSync() {} })
  const state = { hasProject: true, ddCloudTrack: true, isClientView: false, dynamicPlugins: [], lastActiveIdsByMode: { left: {}, right: {} }, leftPaneKey: 'files', saveActiveIdsByMode() {}, sidebarCollapsed: false }
  methods.toggleLeftPane.call(state,'dd-files'); assert.equal(state.leftPaneKey,'dd-files')
  state.ddCloudTrack = false; state.leftPaneKey = 'home'; methods.toggleLeftPane.call(state,'dd-files'); assert.equal(state.leftPaneKey,'files')
})
