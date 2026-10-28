// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { NO_PROJECT_DEFAULT_PANE } from '../../src/pages/project-overview/noProjectShell.js'
// Execute the real SFC methods and market event subscriptions with a fake transport/event bus.
// No Vue dependency: unrelated page lifecycle and imports stay outside this harness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pluginWorkspaceTabMethods } from '../../src/pages/project-overview/pluginWorkspaceTabs.js'
import { pluginViews, isGlobalPlugin, hasPluginNavigation, hasPluginPanel, isLegacyThemeGallery } from '../../src/utils/pluginViews.js'

const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../../src/components/MarketSidebarPanel.vue', import.meta.url), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))
const quiet = { log() {}, warn() {}, error() {} }
const plugin = (extra = {}) => ({ id: 'tencent-meeting', name: '腾讯会议', enabled: true, frontendEntry: 'web/index.html', permissions: ['file_read'], ...extra })

function method(source, name, deps) {
  const match = new RegExp(`\\n    (?:async )?${name}\\([^\\n]*\\) \\{`).exec(source)
  assert.ok(match, `SFC method ${name} exists`)
  const end = source.indexOf('\n    },', match.index)
  assert.ok(end > match.index, `SFC method ${name} has a boundary`)
  return new Function(...Object.keys(deps), `return ({${source.slice(match.index, end + 6)}}).${name}`)(...Object.values(deps))
}

function harness() {
  let response = []
  let get = async () => response
  const listeners = new Map(), events = []
  const uni = {
    $on(name, fn) { const handlers = listeners.get(name) || []; handlers.push(fn); listeners.set(name, handlers) },
    $emit(name) { events.push(name); for (const fn of listeners.get(name) || []) fn() },
    showToast() {},
    showModal(options) { options.success({ confirm: true }) },
  }
  const deps = {
    pluginViews, isGlobalPlugin, hasPluginNavigation, hasPluginPanel, isLegacyThemeGallery,
    uni, console: quiet, NO_PROJECT_DEFAULT_PANE, getPlugins: () => get(), getSkills: async () => [],
    resolvePluginEntryUrl: (id, path) => path ? `/api/plugin-web/${id}/${path.slice(4)}` : '',
    getCurrentUser: () => ({ role: 'ADMIN' }), getPluginsForUser: () => [{ key: 'files' }],
    filterPluginsByEnabledSkills: rows => rows,
    rescanPlugins: async () => ({ pluginCount: response.length }), rescanSkills: async () => ({ skillCount: 0 }),
    getSkillMarket: async () => ({ skills: [] }), getPluginMarket: async () => ({ plugins: [] }),
    refreshPluginUpdates: async () => ({ accountConnected: false }),
    installMarketPlugin: async () => { response = [plugin({ enabled: false })] },
    isAccountLoginRetry: () => false,
  }
  const vm = { dynamicPlugins: [], enabledSkillIds: null, hasProject: true, hasNamedProject: true, leftPaneKey: 'files',
    leftFiles: [], rightFiles: [], lastActiveIdsByMode: { left: {}, right: {} }, saveActiveIdsByMode() {},
    ...pluginWorkspaceTabMethods,
    applyPanelDocks: rows => rows, applyRailOrder: rows => rows, ttsEnabled: true }
  for (const name of ['loadDynamicPlugins', 'loadEnabledSkills']) vm[name] = method(page, name, deps).bind(vm)
  Object.defineProperty(vm, 'rail', { get: method(page, 'LEFT_SIDEBAR_PLUGINS', deps).bind(vm) })
  Object.defineProperty(vm, 'activeDynamicPlugin', { get: method(page, 'activeDynamicPlugin', deps).bind(vm) })

  // Run the unchanged source of onLoad's initial loads + both market subscriptions.
  const start = page.indexOf('    this.loadDynamicPlugins() // Fetch dynamic plugins')
  const last = "    uni.$on('awd:market-changed-from-sidebar', this._onMarketChanged)"
  const end = page.indexOf(last, start) + last.length
  assert.ok(start > 0 && end > start, 'market lifecycle fragment exists')
  new Function('uni', page.slice(start, end)).call(vm, uni)

  const market = { rescanning: false, pluginBusyId: '', $t: key => key }
  for (const name of ['rescan', 'reloadAll', 'loadInstalled', 'loadMarketSkills', 'loadMarketPlugins', 'installPluginRow']) {
    market[name] = method(sidebar, name, deps).bind(market)
  }
  return { vm, market, events, setResponse(value) { response = value }, setTransport(fn) { get = fn }, async emit(event) { uni.$emit(event); await flush() } }
}

for (const event of ['awd:market-changed', 'awd:market-changed-from-sidebar']) {
  test(`${event} refreshes enabled plugins and removes disabled/uninstalled entries`, async () => {
    const h = harness(); await flush()
    h.setResponse([plugin()]); await h.emit(event)
    assert.deepEqual(h.vm.rail.map(p => p.key), ['files', 'plugin-tencent-meeting'])
    h.vm.leftPaneKey = 'plugin-tencent-meeting'
    assert.equal(h.vm.activeDynamicPlugin.pluginId, 'tencent-meeting')
    h.setResponse([plugin({ enabled: false })]); await h.emit(event)
    assert.deepEqual(h.vm.rail.map(p => p.key), ['files'])
    assert.equal(h.vm.activeDynamicPlugin, null)
    assert.equal(h.vm.leftPaneKey, 'files')
    h.setResponse([plugin()]); await h.emit(event)
    assert.equal(h.vm.rail.length, 2)
    h.vm.leftPaneKey = 'plugin-tencent-meeting'
    h.setResponse([]); await h.emit(event)
    assert.deepEqual(h.vm.rail.map(p => p.key), ['files'])
    assert.equal(h.vm.activeDynamicPlugin, null)
    assert.equal(h.vm.leftPaneKey, 'files')
  })
}

test('list endpoint includes every plugin: rail admits only enabled, compatible, non-revoked rows', async () => {
  const h = harness(); await flush()
  h.setResponse({ data: [plugin(), plugin({ id: 'disabled', enabled: false }), plugin({ id: 'revoked', revokedReason: '下架' }),
    plugin({ id: 'new-host', incompatibleReason: '需要更新' }), plugin({ id: 'missing-enabled', enabled: undefined })] })
  await h.vm.loadDynamicPlugins()
  assert.deepEqual(h.vm.rail.map(p => p.key), ['files', 'plugin-tencent-meeting'])
})

test('sidebar install notifies the page but does not show the disabled installation until enabled', async () => {
  const h = harness(); await flush()
  await h.market.installPluginRow({ id: 'tencent-meeting', raw: plugin() }); await flush()
  assert.ok(h.events.includes('awd:market-changed-from-sidebar'))
  assert.deepEqual(h.vm.rail.map(p => p.key), ['files'])
  h.setResponse([plugin()]); await h.emit('awd:market-changed')
  assert.equal(h.vm.rail.at(-1).pluginId, 'tencent-meeting')
})

test('successful sidebar rescan propagates newly loaded plugins into the rail', async () => {
  const h = harness(); await flush()
  h.setResponse([plugin()]); await h.market.rescan(); await flush()
  assert.ok(h.events.includes('awd:market-changed-from-sidebar'))
  assert.equal(h.vm.rail.at(-1).pluginId, 'tencent-meeting')
  assert.equal(h.market.rescanning, false)
})

test('transport failure and malformed payload preserve the last valid rail', async () => {
  const h = harness(); await flush(); h.setResponse([plugin()]); await h.vm.loadDynamicPlugins()
  const previous = h.vm.dynamicPlugins
  h.setTransport(async () => { throw new Error('offline') }); await h.vm.loadDynamicPlugins()
  assert.equal(h.vm.dynamicPlugins, previous)
  h.setTransport(async () => ({ data: { message: 'unavailable' } })); await h.vm.loadDynamicPlugins()
  assert.equal(h.vm.dynamicPlugins, previous)
})

test('a delayed old enabled response cannot resurrect an entry removed by a newer refresh', async () => {
  const h = harness(); await flush()
  let resolveOld
  h.setTransport(() => new Promise(resolve => { resolveOld = resolve }))
  const old = h.vm.loadDynamicPlugins()
  h.setTransport(async () => []); await h.vm.loadDynamicPlugins()
  resolveOld([plugin()]); await old
  assert.deepEqual(h.vm.rail.map(p => p.key), ['files'])
})

test('removed dynamic selection falls back without a project; unrelated selection and failures are preserved', async () => {
  const h = harness(); await flush()
  h.vm.hasProject = false; h.vm.hasNamedProject = false; h.vm.leftPaneKey = 'plugin-tencent-meeting'
  await h.vm.loadDynamicPlugins()
  assert.equal(h.vm.leftPaneKey, null)
  h.vm.leftPaneKey = 'market'; await h.vm.loadDynamicPlugins()
  assert.equal(h.vm.leftPaneKey, 'market')
  h.vm.leftPaneKey = 'plugin-tencent-meeting'
  h.setTransport(async () => { throw new Error('offline') }); await h.vm.loadDynamicPlugins()
  assert.equal(h.vm.leftPaneKey, 'plugin-tencent-meeting')
})

const migratedPluginIds = ['search', 'voice', 'desensitize', 'litigation-visual', 'calendar', 'favorites', 'clipboard', 'insight']
for (const [language, expected] of [
  ['zh-CN', ['搜索', '语音', '文件脱敏', '诉讼可视化', '日程', '收藏夹', '剪贴板', '依据']],
  ['en-US', ['Search', 'Voice', 'File Redaction', 'Litigation Visualization', 'Schedule', 'Favorites', 'Clipboard', 'References']],
]) {
  test(`migrated plugin navigation keeps its ${language} labels and preserves custom plugin names`, async () => {
    const messages = Object.fromEntries(await Promise.all(['config', 'calendar', 'insight'].map(async namespace =>
      [namespace, (await import(`../../src/locales/${language}/${namespace}.js`)).default])))
    const h = harness(); await flush()
    h.vm.$t = key => key.split('.').reduce((value, part) => value?.[part], messages) ?? key
    h.setResponse([
      ...migratedPluginIds.map(id => plugin(JSON.parse(readFileSync(new URL(`../../../official-plugins/${id}/manifest.json`, import.meta.url), 'utf8')))),
      plugin({ id: 'custom-review', name: '客户自定义 Review' }),
      plugin({ id: 'constructor', name: 'Custom Constructor' }),
    ])
    await h.vm.loadDynamicPlugins()
    assert.deepEqual(h.vm.dynamicPlugins.map(p => p.label), [...expected, '客户自定义 Review', 'Custom Constructor'])
    assert.deepEqual(h.vm.dynamicPlugins.map(p => p.pluginId), [...migratedPluginIds, 'custom-review', 'constructor'])
  })
}

test('explicit view declarations control navigation, including all three installed skins', async () => {
  const h = harness(); await flush()
  const skins = ['theme-inkwash-zen', 'theme-anime-twilight', 'theme-aurora-glass'].map(id =>
    plugin(JSON.parse(readFileSync(new URL(`../../../official-plugins/${id}/manifest.json`, import.meta.url), 'utf8'))))
  const view = placement => ({ id: placement, name: placement, entry: 'web/index.html', placement, scope: 'project' })
  h.setResponse([...skins, plugin({ id: 'service-only', contributes: { views: [] } }),
    plugin({ id: 'panel-only', contributes: { views: [view('sidebar')] } }),
    plugin({ id: 'workspace-only', frontendEntry: '', contributes: { views: [view('workspace')] } }), plugin()])
  await h.vm.loadDynamicPlugins()
  assert.deepEqual(h.vm.rail.map(p => p.key), ['files', 'plugin-panel-only', 'plugin-workspace-only', 'plugin-tencent-meeting'])
  assert.equal(h.vm.dynamicPlugins.find(p => p.pluginId === 'workspace-only').hasFrontend, true)
  for (const id of [...skins.map(p => p.id), 'service-only', 'panel-only']) {
    h.vm.leftPaneKey = 'plugin-' + id
    if (id !== 'panel-only') assert.equal(h.vm.activeDynamicPlugin, null)
    assert.equal(h.vm.openPluginTab(id), false)
  }
  // Updating an installed plugin to no UI cleans old selections and snapshots.
  h.vm.leftFiles = [{ id: 'plugin-service-only', tabType: 'plugin', pluginId: 'service-only' }]
  h.vm.activeFileIdLeft = 'plugin-service-only'; h.vm.leftPaneKey = 'plugin-service-only'
  await h.emit('awd:market-changed')
  assert.deepEqual(h.vm.leftFiles, [])
  assert.equal(h.vm.activeFileIdLeft, null)
  assert.equal(h.vm.leftPaneKey, 'files')
})


test('already installed legacy skin galleries stay preview-only, while functional theme workspaces keep navigation', async () => {
  const h = harness(); await flush()
  const gallery = { id: 'gallery', name: 'Preview', entry: 'web/index.html', placement: 'workspace', scope: 'global' }
  const skin = plugin({ id: 'old-skin', permissions: [], contributes: { themes: [{ id: 'skin', file: 'themes/skin.json' }], views: [gallery] } })
  h.setResponse([skin, { ...skin, id: 'theme-editor', contributes: { ...skin.contributes, views: [{ ...gallery, id: 'editor' }] } },
    { ...skin, id: 'business-plugin', permissions: ['file_read'] }])
  await h.vm.loadDynamicPlugins()
  assert.deepEqual(h.vm.rail.map(p => p.key), ['files', 'plugin-theme-editor', 'plugin-business-plugin'])
  assert.equal(h.vm.openPluginTab('old-skin'), false)
  h.vm.leftFiles = [{ id: 'plugin-old-skin', pluginId: 'old-skin', tabType: 'plugin' }]
  assert.deepEqual(h.vm.pluginWorkspaceTabs(h.vm.leftFiles), [])
  h.vm.reconcilePluginTabs()
  assert.deepEqual(h.vm.leftFiles, [])
})
