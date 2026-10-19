// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveLooseWorkspace } from '../../src/pages/project-overview/looseFiles.js'

const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const menu = readFileSync(new URL('../../src/pages/project-overview/menuCommands.js', import.meta.url), 'utf8')
function body(name, source = page, indent = 4) {
  const spaces = ' '.repeat(indent)
  const found = source.match(new RegExp(`\\n${spaces}(?:async )?${name}\\([^\\n]*\\) \\{\\n([\\s\\S]*?)\\n${spaces}\\},`))
  assert.ok(found, name)
  return found[1]
}

test('独立文件路由提示仅用于加载期，服务端类型覆盖真假提示', () => {
  assert.equal(resolveLooseWorkspace({}, false, true), true)
  assert.equal(resolveLooseWorkspace({ projectType: 'LOCAL' }, true, true), false)
  assert.equal(resolveLooseWorkspace({ projectType: 'LOOSE_FILES' }, true, false), true)
})

test('独立文件仍有编辑/AI上下文，但没有普通项目上下文', () => {
  const hasProject = new Function(body('hasProject'))
  const hasNamed = new Function(body('hasNamedProject'))
  assert.equal(hasProject.call({ projectId: 12 }), true)
  assert.equal(hasNamed.call({ hasProject: true, isLooseWorkspace: true }), false)
  assert.equal(hasNamed.call({ hasProject: true, isLooseWorkspace: false }), true)
  assert.match(page, /<ChatInterface\s+v-if="hasProject"/)
})

test('真实独立工作区详情不记最近项目，不加载成员/协作/事项/暂存区', async () => {
  const called = []
  const load = new Function('getProject', 'isPaneAllowedWithoutProject', 'NO_PROJECT_DEFAULT_PANE',
    'recordProjectVisit', `return async function() {${body('loadProjectInfo')}}`)(
    async () => ({ id: 12, projectType: 'LOOSE_FILES', name: 'internal' }),
    key => key === 'projects', 'projects', () => called.push('recent'))
  const vm = { projectId: 12, leftPaneKey: 'files', sidebarCollapsed: false,
    get isLooseWorkspace() { return resolveLooseWorkspace(this.project, this.projectInfoLoaded, false) },
    stopActivityTracking() { called.push('stop') }, updateWindowTitle() { called.push('title') },
    loadProjectMembers() { called.push('members') } }
  await load.call(vm)
  assert.deepEqual(called, ['stop', 'title'])
  assert.equal(vm.projectInfoLoaded, true)
  assert.equal(vm.leftPaneKey, 'projects')
  assert.equal(vm.sidebarCollapsed, true)
})

test('系统文件接收等待 mounted 和快照恢复，并且只注册当前工作台', () => {
  const registered = []
  const register = new Function('registerOpenWorkbench', `return function() {${body('maybeRegisterOpenWorkbench')}}`)(vm => registered.push(vm))
  const vm = { isActiveOverviewInstance: () => true }
  register.call(vm)
  vm._openWorkbenchMounted = true
  register.call(vm)
  assert.equal(registered.length, 0)
  vm._openWorkbenchRestored = true
  register.call(vm)
  assert.deepEqual(registered, [vm])
  vm.isActiveOverviewInstance = () => false
  register.call(vm)
  assert.equal(registered.length, 1)
})

test('独立文件窗口标题不泄露内部项目名称', () => {
  const document = {}
  const title = new Function('document', body('updateWindowTitle'))
  title.call({ leftFiles: [{ id: 9, name: '合同.docx' }], activeFileIdLeft: 9,
    hasNamedProject: false, project: { name: 'internal workspace' } }, document)
  assert.equal(document.title, '合同.docx — AI WorkDeck')
})

test('菜单项目标志关闭，文件编辑标志保留', () => {
  const flags = new Function('WORD_EXT', `return function() {${body('buildMenuFlags', menu, 2)}}`)(/\.docx$/i)
  const state = flags.call({ project: { id: 12 }, isLooseWorkspace: true,
    activeFileLeft: { name: '合同.docx' }, activeFileIdLeft: 9, $refs: {}, isPanelOpenIn: () => false,
    activeLibreEditor: () => ({ menuReady: () => true }) })
  assert.equal(state.hasProject, false)
  assert.equal(state.hasTab, true)
  assert.equal(state.isDocTab, true)
})

test('内部项目入口不通过菜单命令绕过，AI 与普通编辑仍走正常派发', async () => {
  const run = new Function(`return async function(payload) {${body('runMenuCommand', menu, 2)}}`)()
  const opened = []
  const vm = { $nextTick: () => {}, isLooseWorkspace: true, LEFT_SIDEBAR_PLUGINS: [{ key: 'projects' }],
    toggleLeftPane: key => opened.push(key), toggleAiPanel: () => opened.push('ai'),
    openProjectsPane: () => opened.push('projects'), menuToast: () => opened.push('toast') }
  for (const verb of ['importFiles', 'openVersionPanel', 'goProjectHome', 'toggleRecording']) await run.call(vm, { verb })
  await run.call(vm, { verb: 'openView', arg: 'files' })
  assert.deepEqual(opened, [])
  await run.call(vm, { verb: 'openView', arg: 'projects' })
  await run.call(vm, { verb: 'toggleAiPanel' })
  assert.deepEqual(opened, ['projects', 'ai'])
})

test('页面生命周期接线：恢复结束和 mounted 均尝试注册，离开页面即交出接收器', () => {
  assert.match(page, /restoreTabSnapshot\(\)\.then\([\s\S]*?\.finally\(\(\) => \{\s*this\._openWorkbenchRestored = true\s*this\.maybeRegisterOpenWorkbench\(\)/)
  assert.match(page, /this\._openWorkbenchMounted = true\s*this\.maybeRegisterOpenWorkbench\(\)/)
  assert.match(page, /onShow\(\) \{\s*this\.maybeRegisterOpenWorkbench\(\)/)
  assert.doesNotMatch(page.match(/onHide\(\) \{([\s\S]*?)\n  \},/)?.[1] || '', /unregisterOpenWorkbench/)
  assert.match(page, /beforeUnmount\(\) \{\s*this\._openWorkbenchMounted = false\s*unregisterOpenWorkbench\(this\)/)
})

test('保存成功后仍等待导航回执，导航失败向打开请求报告', async () => {
  let navigate
  const leave = new Function('flushDirtyEditors', 'uni', `return async function(url, options = {}) {${body('leaveWorkbench')}}`)(
    async () => ({ failed: 0 }), { reLaunch: opts => { navigate = opts } })
  let complete = false
  const pending = leave.call({}, '/target').then(value => { complete = true; return value })
  await Promise.resolve()
  assert.equal(complete, false)
  navigate.success()
  assert.equal(await pending, true)
  const failure = leave.call({}, '/target')
  await Promise.resolve()
  navigate.fail(new Error('navigation failed'))
  await assert.rejects(failure, /navigation failed/)
})

test('独立文件禁止项目面板切换，即使菜单以外的调用方传入项目key', () => {
  const src = readFileSync(new URL('../../src/pages/project-overview/panelSwitching.js', import.meta.url), 'utf8')
  const blocked = body('toggleLeftPane', src, 4).split('      // 埋点')[0]
  const checkCore = new Function('isPaneAllowedWithoutProject', 'migrateLeftPaneKey', 'isGlobalPlugin', 'key', blocked + '\nreturn true')
  const check = function(allow, key) { return checkCore.call({ dynamicPlugins: [], ...this }, allow, value => value, () => false, key) }
  const allow = key => key === 'projects'
  assert.equal(check.call({ hasProject: true, isLooseWorkspace: true }, allow, 'files'), undefined)
  assert.equal(check.call({ hasProject: true, isLooseWorkspace: true }, allow, 'projects'), true)
  assert.equal(check.call({ hasProject: true, isLooseWorkspace: false }, allow, 'files'), true)
})
