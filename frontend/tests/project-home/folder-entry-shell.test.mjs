// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as shell from '../../src/pages/project-overview/noProjectShell.js'
import { isGlobalPlugin, hasPluginNavigation } from '../../src/utils/pluginViews.js'

function load(path, returned, dependencies) {
  const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
  return new Function(...Object.keys(dependencies), `${source}\nreturn ${returned}`)(...Object.values(dependencies))
}
const config = load('config/leftSidebarPlugins.js', '{ LEFT_SIDEBAR_PLUGINS, getPluginsForUser, migrateLeftPaneKey }', { t: key => key })
const writes = []
const switching = load('pages/project-overview/panelSwitching.js', 'panelSwitchingMethods', {
  ...shell, ...config, isGlobalPlugin, hasPluginNavigation, track() {}, uni: { setStorageSync: (...args) => writes.push(args) },
})
function host(extra = {}) {
  return { ...switching, hasProject: true, projectId: 42, isLooseWorkspace: false,
    dynamicPlugins: [], leftPaneKey: 'home', sidebarCollapsed: false,
    lastActiveIdsByMode: { left: {}, right: {} }, activeFileIdLeft: 'document', activeFileIdRight: null,
    toggleSidebar() { this.sidebarCollapsed = !this.sidebarCollapsed },
    openProjectsPane() { this.directoryOpened = true; return 'welcome-directory' }, ...extra }
}

test('directory entry is absent from rail and old stored projects maps to files', () => {
  assert.equal(config.LEFT_SIDEBAR_PLUGINS.some(item => item.key === 'projects'), false)
  assert.equal(config.migrateLeftPaneKey('projects'), 'files')
  assert.equal(config.migrateLeftPaneKey('plugin-calendar'), 'plugin-calendar')
  const vm = host()
  vm.toggleLeftPane(config.migrateLeftPaneKey('projects'))
  assert.equal(vm.leftPaneKey, 'files')
  assert.equal(vm.activeFileIdLeft, 'document')
})

test('legacy projects command opens welcome directory without mutating sidebar or storage', () => {
  for (const state of [{}, { hasProject: false, projectId: null }, { isLooseWorkspace: true }]) {
    const vm = host(state), before = writes.length
    assert.equal(vm.toggleLeftPane('projects'), 'welcome-directory')
    assert.equal(vm.directoryOpened, true)
    assert.equal(vm.leftPaneKey, 'home')
    assert.equal(vm.sidebarCollapsed, false)
    assert.equal(writes.length, before)
  }
})

test('no-project default is empty and project-dependent panels stay blocked', () => {
  assert.equal(shell.NO_PROJECT_DEFAULT_PANE, null)
  assert.equal(shell.isPaneAllowedWithoutProject('projects'), false)
  const vm = host({ hasProject: false, projectId: null, leftPaneKey: null, sidebarCollapsed: true })
  vm.toggleLeftPane('files')
  assert.equal(vm.leftPaneKey, null)
  assert.equal(vm.sidebarCollapsed, true)
  vm.toggleLeftPane('market')
  assert.equal(vm.leftPaneKey, 'market', 'explicit global panel navigation remains available')
  assert.equal(vm.sidebarCollapsed, false)
})

test('CLIENT rail remains isolated to due diligence', () => {
  assert.deepEqual(config.getPluginsForUser('CLIENT').map(item => item.key), ['dd-files'])
  assert.deepEqual(config.getPluginsForUser('CLIENT', { cloudTrack: true }).map(item => item.key), ['dd-files'])
  assert.equal(config.getPluginsForUser('USER').some(item => item.key === 'dd-files'), false)
  assert.equal(config.getPluginsForUser('USER', { cloudTrack: true }).some(item => item.key === 'dd-files'), true)
})
