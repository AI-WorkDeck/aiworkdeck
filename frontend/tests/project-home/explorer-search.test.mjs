// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { parse as parseSfc } from 'vue/compiler-sfc'
import { baseParse, compile } from '@vue/compiler-dom'
import { parse as parseJs } from '@babel/parser'
import { ICONS } from '../../src/config/icons.js'
import * as registry from '../../src/config/panelRegistry.js'
import * as shell from '../../src/pages/project-overview/noProjectShell.js'
import { isGlobalPlugin, hasPluginNavigation, hasPluginPanel } from '../../src/utils/pluginViews.js'

const read = path => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8')
const page = parseSfc(read('pages/project-overview/project-overview.vue')).descriptor
const options = parseJs(page.script.content, { sourceType: 'module' }).program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration
const computed = options.properties.find(node => node.key?.name === 'computed').value
const t = key => key

// Evaluate actual module bodies, substituting only imports with test dependencies.
function moduleValue(path, name, dependencies) {
  const source = read(path)
  const body = parseJs(source, { sourceType: 'module' }).program.body
    .filter(node => node.type !== 'ImportDeclaration')
    .map(node => source.slice(node.declaration?.start ?? node.start, node.end)).join('\n')
  return new Function(...Object.keys(dependencies), `${body}\nreturn ${name}`)(...Object.values(dependencies))
}
const { migrateLeftPaneKey } = moduleValue('config/leftSidebarPlugins.js', '{ migrateLeftPaneKey }', { t })
function computedMethod(name) {
  const node = computed.properties.find(node => node.key?.name === name)
  assert.ok(node, `real computed ${name} exists`)
  return new Function('getMovablePanel', 'getLeftSidebarPlugin', 'hasPluginPanel', `return ({${page.script.content.slice(node.start, node.end)}}).${name}`)(registry.getMovablePanel, () => ({ label: 'other' }), hasPluginPanel)
}
const switching = moduleValue('pages/project-overview/panelSwitching.js', 'panelSwitchingMethods', {
  ...shell, migrateLeftPaneKey, isGlobalPlugin, hasPluginNavigation, track() {}, uni: { setStorageSync() {} },
})
const docking = moduleValue('pages/project-overview/panelDocking.js', 'panelDockingMethods', {
  ...shell, ...registry, migrateLeftPaneKey, track() {},
})
const search = { key: 'plugin-search', pluginId: 'search', label: 'Search', permissions: ['file_read'],
  sidebarView: { id: 'main', scope: 'project', defaultDock: 'left', allowedDocks: ['left'] },
  defaultDock: 'left', allowedDocks: ['left'] }

function workbench(extra = {}) {
  const vm = { leftPaneKey: 'files', hasProject: true, hasNamedProject: true, isLooseWorkspace: false,
    isClientView: false, sidebarCollapsed: false, fileBatchMode: false, checkedFileCount: 0, projectId: 42,
    dynamicPlugins: [search], dockPanels: [search], panelDocks: { left: [search], right: [], bottom: [] },
    activeFileIdLeft: 11, activeFileIdRight: 22, lastActiveIdsByMode: { left: {}, right: {} },
    GLYPHS: ICONS, $t: t, toggleSidebar() { this.sidebarCollapsed = !this.sidebarCollapsed },
    openPluginTab() { assert.fail('sidebar search must not open a document tab') }, ...extra }
  for (const [name, method] of Object.entries(switching)) vm[name] = method.bind(vm)
  for (const name of ['isExplorerPane', 'explorerSearchPlugin', 'activeDynamicPlugin', 'leftPaneTitle']) {
    Object.defineProperty(vm, name, { get: computedMethod(name).bind(vm) })
  }
  return vm
}

function elementWithClass(nodes, className) {
  for (const node of nodes) {
    if (node.type === 1 && node.props.some(prop => prop.name === 'class' && prop.value?.content.split(' ').includes(className))) return node
    const child = elementWithClass(node.children || [], className)
    if (child) return child
  }
}
const ast = baseParse(page.template.content)
const renders = Object.fromEntries(['sidebar-header', 'rail-btn'].map(name => {
  const element = elementWithClass(ast.children, name)
  assert.ok(element, `real template ${name} exists`)
  const code = compile(element.loc.source, { mode: 'function', prefixIdentifiers: true,
    isCustomElement: tag => ['view', 'text', 'image'].includes(tag) }).code
  return [name, new Function('Vue', code)(Vue)]
}))
function nodesOf(node) {
  if (Array.isArray(node)) return node.flatMap(nodesOf)
  if (!node || typeof node !== 'object') return []
  return [node, ...nodesOf(node.children)]
}
function rendered(name, vm) { return nodesOf(renders[name](vm, [])) }
function byClass(nodes, name) { return nodes.filter(node => String(node.props?.class || '').split(' ').includes(name)) }

test('the real header puts an accessible search action before new-file, and click/Enter/Space activate it', () => {
  const vm = workbench()
  let toggles = 0
  vm.toggleExplorerSearch = () => toggles++
  const nodes = rendered('sidebar-header', vm)
  const [button] = byClass(nodes, 'explorer-search-toggle')
  assert.ok(button)
  assert.equal(button.props.role, 'button')
  assert.equal(button.props.tabindex, '0')
  assert.equal(button.props['aria-pressed'], false)
  assert.equal(button.props['aria-label'], 'config.sidebar.search')
  assert.ok(nodes.indexOf(button) < nodes.findIndex(node => 'data-create-trigger' in (node.props || {})))
  let stopped = 0, prevented = 0
  button.props.onClick({ stopPropagation() { stopped++ } })
  for (const key of ['Enter', ' ', 'Escape']) for (const handler of button.props.onKeydown) {
    handler({ key, preventDefault() { prevented++ } })
  }
  assert.equal(toggles, 3)
  assert.equal(stopped, 1)
  assert.equal(prevented, 2)
})

test('search shows a return action and explorer title, including when tree batch mode was active', () => {
  for (const fileBatchMode of [false, true]) {
    const vm = workbench({ leftPaneKey: 'plugin-search', fileBatchMode })
    const nodes = rendered('sidebar-header', vm)
    const [button] = byClass(nodes, 'explorer-search-toggle')
    assert.equal(button.props['aria-pressed'], true)
    assert.equal(button.props['aria-label'], 'files.backToFiles')
    assert.equal(byClass(nodes, 'sidebar-title')[0].children, 'config.sidebar.files')
    assert.equal(byClass(nodes, 'btn-select-all').length, 0)
    assert.equal(nodes.some(node => 'data-create-trigger' in (node.props || {})), false)
    button.props.onClick({ stopPropagation() {} })
    assert.equal(vm.leftPaneKey, 'files')
    assert.equal(vm.fileBatchMode, fileBatchMode)
  }
})

test('batch selection, unavailable search, no project and other panes do not offer a search button', () => {
  for (const state of [{ fileBatchMode: true }, { dynamicPlugins: [] }, { hasNamedProject: false }, { leftPaneKey: 'market' }]) {
    assert.equal(byClass(rendered('sidebar-header', workbench(state)), 'explorer-search-toggle').length, 0)
  }
  const batch = rendered('sidebar-header', workbench({ fileBatchMode: true }))
  assert.equal(byClass(batch, 'btn-select-all').length, 1)
  assert.equal(byClass(batch, 'sidebar-title').length, 0)
})

test('the files rail stays active while search is open and clears its active state when collapsed', () => {
  for (const leftPaneKey of ['files', 'plugin-search']) for (const sidebarCollapsed of [false, true]) {
    const vm = workbench({ leftPaneKey, sidebarCollapsed, LEFT_SIDEBAR_PLUGINS: [{ key: 'files', label: 'Files' }],
      isMovablePanel: () => false, draggingRailKey: null })
    const [button] = byClass(rendered('rail-btn', vm), 'rail-btn')
    assert.equal(button.props.class.split(' ').includes('active'), !sidebarCollapsed)
  }
})

test('dock filtering removes search both from the input and from extras, preserving live plugin access', () => {
  const vm = workbench()
  const files = { key: 'files' }, voice = { key: 'plugin-voice', label: 'Voice' }
  vm.panelDocks.left.push(voice)
  for (const input of [[files, search], [files]]) {
    assert.deepEqual(docking.applyPanelDocks.call(vm, input).map(item => item.key), ['files', 'plugin-voice'])
    assert.equal(vm.explorerSearchPlugin, search)
    assert.equal(vm.dynamicPlugins[0], search)
  }
})

test('the menu retains search independently of rail and removes it when unavailable or out of project scope', () => {
  let menu
  const methods = moduleValue('pages/project-overview/menuCommands.js', 'menuCommandsMethods', {
    patchMenuState: value => { menu = value },
  })
  const vm = workbench({ isActiveOverviewInstance: () => true, buildMenuFlags: () => ({}),
    LEFT_SIDEBAR_PLUGINS: [{ key: 'files', label: 'Files' }], menuBarRefreshKey: 0 })
  methods.pushMenuState.call(vm)
  assert.deepEqual(menu.views.map(view => view.key), ['files', 'plugin-search'])
  for (const state of [{ dynamicPlugins: [] }, { hasNamedProject: false }, { isClientView: true }]) {
    methods.pushMenuState.call({ ...vm, ...state, explorerSearchPlugin: state.dynamicPlugins ? null : search })
    assert.deepEqual(menu.views.map(view => view.key), ['files'])
  }
})

test('legacy and current search keys enter the same sidebar and toggle back without changing active documents', () => {
  for (const key of ['search', 'plugin-search']) {
    const vm = workbench({ sidebarCollapsed: true })
    vm.toggleLeftPane(key)
    assert.equal(vm.leftPaneKey, 'plugin-search')
    assert.equal(vm.sidebarCollapsed, false)
    assert.equal(vm.activeDynamicPlugin, search)
    assert.equal(vm.leftPaneTitle, 'config.sidebar.files')
    vm.toggleExplorerSearch()
    assert.equal(vm.leftPaneKey, 'files')
    vm.toggleExplorerSearch()
    assert.equal(vm.leftPaneKey, 'plugin-search')
    assert.deepEqual([vm.activeFileIdLeft, vm.activeFileIdRight], [11, 22])
  }
})

test('existing no-project and loose-file guards also block the relocated search entry', () => {
  for (const state of [{ hasProject: false }, { isLooseWorkspace: true }]) {
    const vm = workbench(state)
    vm.toggleExplorerSearch()
    assert.equal(vm.leftPaneKey, 'files')
    assert.deepEqual([vm.activeFileIdLeft, vm.activeFileIdRight], [11, 22])
  }
})

test('opening a search result preserves the hidden tree, while ordinary tab selection still reveals its file', () => {
  const { syncFileTreeSelectionWithActiveTab } = moduleValue('pages/project-overview/fileOpenTabs.js', 'fileOpenTabsMethods', {})
  const revealed = [], ticks = []
  const tree = { selectedFileId: 7, multiSelectedIds: [7], revealFile(id) { revealed.push(id); this.selectedFileId = id; return true } }
  const vm = workbench({ leftPaneKey: 'plugin-search', leftFiles: [{ id: 11, name: 'result.txt' }],
    $refs: { fileTree: tree }, isBrowserTab: () => false, $nextTick: callback => ticks.push(callback) })
  syncFileTreeSelectionWithActiveTab.call(vm)
  assert.deepEqual(revealed, [])
  assert.equal(ticks.length, 0)
  assert.equal(tree.selectedFileId, 7)
  assert.deepEqual(tree.multiSelectedIds, [7])
  vm.leftPaneKey = 'files'
  syncFileTreeSelectionWithActiveTab.call(vm)
  assert.deepEqual(revealed, [11])
  ticks.splice(0).forEach(callback => callback())
  assert.deepEqual(revealed, [11, 11])
  assert.equal(tree.selectedFileId, 11)
})
