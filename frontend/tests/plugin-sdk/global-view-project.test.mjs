// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Global plugin views and projects: a global view's files and tools see the open named project (never the loose
// scratch workspace; lawfirm, IM, services and AI keep the view's null scope),
// and ui.openWorkspace({ projectId }) opens only a project in the user's own list, then the plugin's workspace there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pluginWorkspaceTabMethods as M } from '../../src/pages/project-overview/pluginWorkspaceTabs.js'

const overview = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')

test('global plugin views keep projectId null and get the open named project as openProjectId', () => {
  assert.equal(overview.match(/scope === 'global' \? null : projectId"\n\s*:open-project-id="pluginViewProjectId"/g).length, 5)
  assert.match(overview, /pluginViewProjectId\(\) \{\s*return this\.hasNamedProject \? this\.projectId : null\s*\}/)
})

// PluginPane with the imports it uses on these paths injected (same technique as im-bridge.test.mjs).
const paneSrc = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const paneBody = paneSrc.slice(paneSrc.indexOf('<script>') + 8, paneSrc.indexOf('</script>'))
  .replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
function pane({ projectId = null, openProjectId = null } = {}) {
  const calls = { files: [], tools: [], lawfirm: [] }
  const options = new Function('getProjectFiles', 'invokePluginTool', 'requestPluginLawFirm', 'getAppLanguage', 'uni', paneBody)(
    async (pid) => { calls.files.push(pid); return [{ id: 3, name: 'a.docx', parentId: null, isFolder: false }] },
    async (id, name, pid) => { calls.tools.push(pid); return { code: 0, output: '{}' } },
    async (id, pid) => { calls.lawfirm.push(pid); return { code: 0, data: {} } },
    () => 'en-US', { $emit() {}, $on() {}, $off() {}, showToast() {} })
  const vm = { ...options.data(), pluginId: 'desk', permissions: ['file_read', 'lawfirm'], projectId, openProjectId }
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  for (const [k, fn] of Object.entries(options.computed)) Object.defineProperty(vm, k, { get: fn.bind(vm) })
  return { vm, calls }
}
test('a global view with a project open: files and tools on that project; lawfirm keeps the view scope (null)', async () => {
  const { vm, calls } = pane({ projectId: null, openProjectId: 7 })
  assert.deepEqual((await vm.handleCall('files.list', {})).result.files.map((f) => f.path), ['a.docx'])
  assert.equal((await vm.handleCall('tools.invoke', { name: 'deskTool', args: {} })).ok, true)
  await vm.handleCall('lawfirm.request', { action: 'overview', params: {} })
  assert.deepEqual(calls, { files: [7], tools: [7], lawfirm: [null] })
})
test('no project open: nothing to list, tools get no project (the backend refuses them as before)', async () => {
  const { vm, calls } = pane()
  assert.deepEqual((await vm.handleCall('files.list', {})).result.files, [])
  await vm.handleCall('tools.invoke', { name: 'deskTool', args: {} })
  assert.deepEqual(calls, { files: [], tools: [null], lawfirm: [] })
})
test('a project-scoped view is unchanged: its own projectId wins', async () => {
  const { vm, calls } = pane({ projectId: 4, openProjectId: 4 })
  await vm.handleCall('files.list', {}); await vm.handleCall('tools.invoke', { name: 't' })
  assert.deepEqual([calls.files, calls.tools], [[4], [4]])
})

function workbench({ projectId = null, loose = false, plugins = [{ pluginId: 'desk', workspaceView: { id: 'main' } }] } = {}) {
  const vm = { ...M, dynamicPlugins: plugins, projectId, hasProject: projectId != null, isLooseWorkspace: loose, dynamicPluginsLoaded: true,
    leftFiles: [], rightFiles: [], splitMode: false, focusedPane: 'left', left: [], opened: [],
    leaveWorkbench(url) { this.left.push(url); return Promise.resolve(true) },
    openPluginTab(id) { this.opened.push(id); return true }, $nextTick() {} }
  return vm
}
const mine = (ids) => async () => ids.map((id) => ({ id, name: 'P' + id, myRole: 'OWNER' }))

test('a project outside the user\'s own list is refused, and nothing navigates', async () => {
  const vm = workbench()
  assert.equal(await vm.openPluginWorkspaceInProject('desk', '9', mine([1, 2])), 'forbidden')
  assert.deepEqual([vm.left, vm.opened], [[], []])
})
test('the current project opens the tab in place; another one reloads into it with the plugin to open', async () => {
  const here = workbench({ projectId: 2 })
  assert.equal(await here.openPluginWorkspaceInProject('desk', '2', mine([1, 2])), 'opened')
  assert.deepEqual([here.left, here.opened], [[], ['desk']])
  const there = workbench({ projectId: 1 })
  assert.equal(await there.openPluginWorkspaceInProject('desk', '2', mine([1, 2])), 'opened')
  assert.deepEqual(there.left, ['/pages/project-overview/project-overview?id=2&openPlugin=desk'])
  // From the loose scratch workspace (id 1 here), the named project is always opened properly.
  const loose = workbench({ projectId: 1, loose: true })
  await loose.openPluginWorkspaceInProject('desk', '1', mine([1]))
  assert.deepEqual(loose.left, ['/pages/project-overview/project-overview?id=1&openPlugin=desk'])
})
test('no workspace view, a failing project list or a refused leave report unavailable', async () => {
  assert.equal(await workbench({ plugins: [{ pluginId: 'desk', sidebarView: {} }] }).openPluginWorkspaceInProject('desk', '1', mine([1])), 'unavailable')
  assert.equal(await workbench().openPluginWorkspaceInProject('desk', '1', async () => { throw new Error('offline') }), 'unavailable')
  const stay = workbench(); stay.leaveWorkbench = async () => false
  assert.equal(await stay.openPluginWorkspaceInProject('desk', '1', mine([1])), 'unavailable')
})
test('after the reload the tab waits for the plugin list when it is not loaded yet', () => {
  const vm = workbench(); vm.dynamicPluginsLoaded = false
  vm.openPendingPluginWorkspace('desk')
  assert.deepEqual([vm.pendingPluginWorkspace, vm.opened], ['desk', []])
  assert.match(overview, /if \(this\.pendingPluginWorkspace\) \{ const pending = this\.pendingPluginWorkspace; this\.pendingPluginWorkspace = null; this\.openPluginTab\(pending\) \}/)
  assert.match(overview, /if \(query\?\.openPlugin && this\.hasProject\)/)
})
