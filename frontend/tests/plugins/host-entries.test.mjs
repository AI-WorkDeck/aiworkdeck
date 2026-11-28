// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C1: plugin-served host entry "reviews" (manifest view entryPoint + awd.ui.setEntry).
import test from 'node:test'
import assert from 'node:assert/strict'
import { pluginViews } from '../../src/utils/pluginViews.js'
import { parseSetEntryParams, entryViewOf, withEntryState, qualifyingEntries, MAX_BADGE } from '../../src/utils/hostEntries.js'
import { reviewsEntryMethods, HOST_REVIEWS_KEY } from '../../src/pages/project-overview/reviewsEntry.js'

const resolve = (id, entry) => `plugin://${id}/${entry}`
const manifest = (id, view) => ({ id, contributes: { views: [{ id: 'main', name: 'Main', entry: 'web/index.html', placement: 'workspace', scope: 'global', ...view }] } })
const workbenchPlugin = (id, view = { entryPoint: 'reviews' }) => ({ pluginId: id, key: 'plugin-' + id, label: id.toUpperCase(), views: pluginViews(manifest(id, view), resolve) })

test('pluginViews keeps entryPoint only for a known name on a global workspace view', () => {
  assert.equal(pluginViews(manifest('a', { entryPoint: 'reviews' }), resolve)[0].entryPoint, 'reviews')
  assert.equal(pluginViews(manifest('a', { entryPoint: 'inbox' }), resolve)[0].entryPoint, undefined)
  assert.equal(pluginViews(manifest('a', { entryPoint: 'reviews', scope: 'project' }), resolve)[0].entryPoint, undefined)
  assert.equal(pluginViews(manifest('a', {}), resolve)[0].entryPoint, undefined)
})

test('setEntry params are checked strictly, never coerced', () => {
  assert.deepEqual(parseSetEntryParams({ entry: 'reviews', visible: true, badge: 3 }).value, { entry: 'reviews', visible: true, badge: 3 })
  assert.deepEqual(parseSetEntryParams({ entry: 'reviews', visible: false }).value, { entry: 'reviews', visible: false, badge: 0 })
  for (const bad of [
    null, [], { entry: 'inbox', visible: true }, { entry: 'reviews', visible: 'true' }, { entry: 'reviews', visible: 1 },
    { entry: 'reviews', visible: true, badge: '3' }, { entry: 'reviews', visible: true, badge: 2.5 },
    { entry: 'reviews', visible: true, badge: -1 }, { entry: 'reviews', visible: true, badge: MAX_BADGE + 1 },
    { entry: 'reviews', visible: true, url: 'https://x' },
  ]) assert.equal(parseSetEntryParams(bad).error, 'invalid_params', JSON.stringify(bad))
})

test('only a plugin declaring the entry has an entry view', () => {
  assert.ok(entryViewOf(workbenchPlugin('a'), 'reviews'))
  assert.equal(entryViewOf(workbenchPlugin('b', {}), 'reviews'), null)
  assert.equal(entryViewOf(undefined, 'reviews'), null)
})

test('state is per account: another account sees nothing until its plugin reports', () => {
  const plugins = [workbenchPlugin('a')]
  let store = withEntryState({}, 'acct-1', 'a', { entry: 'reviews', visible: true, badge: 2 }, 1)
  assert.deepEqual(qualifyingEntries(plugins, store, 'acct-1', 'reviews'), [{ pluginId: 'a', key: 'plugin-a', label: 'A', badge: 2 }])
  assert.deepEqual(qualifyingEntries(plugins, store, 'acct-2', 'reviews'), [])
  assert.deepEqual(qualifyingEntries(plugins, store, '', 'reviews'), [])
  store = withEntryState(store, 'acct-1', 'a', { entry: 'reviews', visible: false, badge: 0 }, 2)
  assert.deepEqual(qualifyingEntries(plugins, store, 'acct-1', 'reviews'), [])
})

test('a stored report for a plugin that no longer declares the entry (or is disabled) is ignored', () => {
  const store = withEntryState({}, 'acct-1', 'a', { entry: 'reviews', visible: true, badge: 1 }, 1)
  assert.deepEqual(qualifyingEntries([workbenchPlugin('a', {})], store, 'acct-1', 'reviews'), [])
  assert.deepEqual(qualifyingEntries([], store, 'acct-1', 'reviews'), [])
})

test('store keeps at most 20 accounts, newest first', () => {
  let store = {}
  for (let i = 0; i < 25; i++) store = withEntryState(store, 'acct-' + i, 'a', { entry: 'reviews', visible: true, badge: 0 }, i + 1)
  assert.equal(Object.keys(store).length, 20)
  assert.ok(store['acct-24'] && !store['acct-0'])
})

function workbench(entries) {
  const opened = []
  const sheets = []
  globalThis.uni = { showActionSheet: (o) => { sheets.push(o) } }
  const vm = { reviewEntries: entries, $t: (k, p) => p ? k + JSON.stringify(p) : k, openPluginTab: (id) => opened.push(id), ...reviewsEntryMethods }
  return { vm, opened, sheets }
}

test('one qualifying plugin: badge on its own button, no generic rail item, entry opens its view', () => {
  const { vm, opened, sheets } = workbench([{ pluginId: 'a', label: 'A', badge: 4 }])
  assert.deepEqual(vm.hostReviewsRailItems(), [])
  assert.equal(vm.reviewBadgeOf('a'), 4)
  assert.equal(vm.reviewBadgeOf('b'), 0)
  vm.openReviewsEntry()
  assert.deepEqual(opened, ['a'])
  assert.equal(sheets.length, 0)
})

test('two qualifying plugins: a generic 审阅 rail item and a picker naming each plugin', () => {
  const { vm, opened, sheets } = workbench([{ pluginId: 'a', label: 'A', badge: 2 }, { pluginId: 'b', label: 'B', badge: 0 }])
  const items = vm.hostReviewsRailItems()
  assert.equal(items.length, 1)
  assert.equal(items[0].key, HOST_REVIEWS_KEY)
  assert.equal(items[0].labelKey, 'workbench.reviewsEntry')
  vm.openReviewsEntry()
  assert.equal(sheets.length, 1)
  assert.equal(sheets[0].itemList[1], 'B')
  assert.match(sheets[0].itemList[0], /reviewsPickItem.*"name":"A".*"count":2/)
  sheets[0].success({ tapIndex: 1 })
  assert.deepEqual(opened, ['b'])
})

test('no qualifying plugin: nothing to open', () => {
  const { vm, opened, sheets } = workbench([])
  vm.openReviewsEntry()
  assert.equal(opened.length + sheets.length, 0)
})

// Bridge: PluginPane's ui.setEntry, with the store injected (same harness style as host-events-parity).
import { readFileSync } from 'node:fs'
const paneSource = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const paneBody = paneSource.slice(paneSource.indexOf('<script>') + 8, paneSource.indexOf('</script>')).replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
function pane(declares) {
  const saved = []
  const setHostEntry = async (pluginId, params) => {
    const parsed = parseSetEntryParams(params)
    if (parsed.error) return parsed
    saved.push([pluginId, parsed.value]); return parsed
  }
  const uni = { $on() {}, $off() {} }
  const options = new Function('uni', 'window', 'setHostEntry', paneBody)(uni, { addEventListener() {}, removeEventListener() {} }, setHostEntry)
  const instance = { ...options.data(), pluginId: 'a', permissions: [], isWebPlugin: true,
    businessActions: { declaresEntryPoint: (id, entry) => declares && id === 'a' && entry === 'reviews' } }
  for (const [key, fn] of Object.entries(options.methods)) instance[key] = fn.bind(instance)
  instance.verifyAuthorization = async () => true
  return { instance, saved }
}

test('ui.setEntry: refused unless the plugin declares the entry; strict params; stored for this plugin', async () => {
  const no = pane(false)
  const refused = await no.instance.handleCall('ui.setEntry', { entry: 'reviews', visible: true, badge: 1 })
  assert.equal(refused.ok, false); assert.equal(refused.error.code, 'permission_denied'); assert.equal(no.saved.length, 0)
  const yes = pane(true)
  const bad = await yes.instance.handleCall('ui.setEntry', { entry: 'reviews', visible: 'yes' })
  assert.equal(bad.error.code, 'invalid_params'); assert.equal(yes.saved.length, 0)
  const ok = await yes.instance.handleCall('ui.setEntry', { entry: 'reviews', visible: true, badge: 3 })
  assert.equal(ok.ok, true); assert.deepEqual(yes.saved, [['a', { entry: 'reviews', visible: true, badge: 3 }]])
})
