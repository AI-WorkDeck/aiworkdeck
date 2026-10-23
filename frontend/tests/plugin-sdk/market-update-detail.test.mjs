// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergePluginCatalog, isPluginUpdateAvailable } from '../../src/utils/marketUpdates.js'

const detail = readFileSync(new URL('../../src/components/MarketDetailPane.vue', import.meta.url), 'utf8')
const pane = readFileSync(new URL('../../src/components/MarketPane.vue', import.meta.url), 'utf8')
const quiet = { log() {}, warn() {}, error() {} }
const localPlugin = (extra = {}) => ({ id: 'project-im', version: '0.1.1', enabled: true, permissions: ['im'], ...extra })
const remotePlugin = (extra = {}) => ({ id: 'project-im', name: 'Project chat', version: '0.2.0', installed: true, updatable: true, permissions: ['im', 'file_write'], ...extra })
const pricingSource = readFileSync(new URL('../../src/utils/marketPricing.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replaceAll('export function', 'function')
const { paidState, canInstall } = new Function(pricingSource + '\nreturn { paidState, canInstall }')()

function method(source, name, deps) {
  const match = new RegExp(`\\n    (?:async )?${name}\\([^\\n]*\\) \\{`).exec(source)
  assert.ok(match, `SFC method ${name} exists`)
  const end = source.indexOf('\n    },', match.index)
  assert.ok(end > match.index)
  return new Function(...Object.keys(deps), `return ({${source.slice(match.index, end + 6)}}).${name}`)(...Object.values(deps))
}

function harness(kind = 'detail', { local = localPlugin(), remote = remotePlugin(), confirm = true, installFails = false, enableFails = false, accountConnected = true } = {}) {
  const state = { local, remote, installFails, enableFails, accountConnected }
  const calls = [], toasts = [], confirmations = [], events = []
  const translate = (key, vars = {}) => key + (Object.keys(vars).length ? JSON.stringify(vars) : '')
  const deps = {
    mergePluginCatalog, isPluginUpdateAvailable, paidState, canInstall,
    refreshEntitlements: async () => { if (state.purchaseOnRefresh) state.remote.purchased = true },
    requireAccount: async () => { state.accountConnected = true; return true },
    console: quiet, PERMISSION_LABELS: { im: 'Chat', file_write: 'Write files' }, CATEGORY_LABELS: {},
    uni: {
      showModal(options) { confirmations.push(options); options.success({ confirm }) },
      showToast(options) { toasts.push(options.title) },
      $emit(event) { events.push({ event, local: structuredClone(state.local) }) },
    },
    getPlugins: async () => state.getPlugins ? state.getPlugins() : (state.local ? [structuredClone(state.local)] : []),
    getPluginMarket: async () => ({ plugins: [structuredClone(state.remote)], accountConnected: state.accountConnected }),
    getBundledPlugins: async () => ({ plugins: [{ id: 'project-im', version: '0.1.0', bundled: true, installed: true }] }),
    getSkills: async () => [], getSkillMarket: async () => ({ skills: [] }),
    installMarketPlugin: async id => {
      calls.push(['install', id])
      if (state.installFails) throw Error('signature rejected')
      state.local = localPlugin({ version: state.remote.version, permissions: [...state.remote.permissions], enabled: false, ...state.actualInstalled })
    },
    installBundledPlugin: async id => { calls.push(['bundled', id]); throw Error('must not install an older bundled copy') },
    setPluginEnabled: async (id, enabled) => {
      calls.push(['enabled', id, enabled])
      if (state.enableFails) throw Error('requires newer host')
      state.local.enabled = enabled
    },
    isAccountLoginRetry: () => false,
  }
  const vm = {
    $t: translate, spec: { kind: 'plugin', id: 'project-im' },
    accountConnected,
    installedInfo: state.local && structuredClone(state.local), marketInfo: structuredClone(state.remote),
    busy: false, pluginBusyId: '', pluginActionError: '', pluginActionHint: '',
    reloadGeneration: 0,
    pluginActionErrors: {}, pluginActionHints: {}, plugins: state.local ? [structuredClone(state.local)] : [],
    loadContribution: async () => {}, stopPackPoll() {},
    loadSkills: async () => {}, loadMarket: async () => {},
  }
  const source = kind === 'detail' ? detail : pane
  const names = kind === 'detail'
    ? ['reload', 'notifyChanged', 'doInstallPlugin', 'onPluginToggle', 'onPurchasedRefresh', 'loginThenContinue']
    : ['reloadAll', 'loadPlugins', 'loadPluginMarket', 'installPlugin', 'notifyMarketChanged', 'installedPluginVersion', 'pluginUpdateAvailable', 'onToggle', 'permissionLabel', 'marketAction', 'refreshPluginPurchase', 'loginThenInstall']
  for (const name of names) vm[name] = method(source, name, deps).bind(vm)
  if (kind === 'detail') {
    for (const name of ['display', 'pluginUpdateAvailable', 'isBuiltinRedaction', 'paidStateValue', 'needsPurchase', 'pluginPermissionText']) {
      Object.defineProperty(vm, name, { get: method(source, name, deps).bind(vm) })
    }
  }
  return {
    vm, state, calls, toasts, confirmations, events,
    reload: () => kind === 'detail' ? vm.reload() : vm.reloadAll(),
    install: () => kind === 'detail' ? vm.doInstallPlugin() : vm.installPlugin(state.remote),
    error: () => kind === 'detail' ? vm.pluginActionError : vm.pluginActionErrors['project-im'],
    hint: () => kind === 'detail' ? vm.pluginActionHint : vm.pluginActionHints['project-im'],
  }
}

test('detail identifies local and latest versions separately and chooses the online update over bundled metadata', async () => {
  const h = harness()
  await h.reload()
  assert.equal(h.vm.marketInfo.version, '0.2.0')
  assert.ok(!h.vm.marketInfo.bundled)
  assert.equal(h.vm.display.version, '0.1.1')
  assert.equal(h.vm.pluginUpdateAvailable, true)
  assert.match(detail, /market.installedVersion/)
  assert.match(detail, /market.latestVersion/)
})

test('legacy bundled redaction continues to use its installed version and app update route', () => {
  const h = harness()
  h.vm.spec = { kind: 'skill', id: 'desensitize' }
  assert.equal(h.vm.isBuiltinRedaction, true)
  assert.equal(h.vm.display.version, '0.1.1')
  assert.equal(h.vm.pluginUpdateAvailable, false)
  assert.match(detail, /v-if="isBuiltinRedaction"[\s\S]*?goToBuiltinUpdates/)
})

test('a late detail refresh cannot overwrite the version fetched after updating', async () => {
  const h = harness()
  let releaseOld
  h.state.getPlugins = () => new Promise(resolve => { releaseOld = resolve })
  const oldReload = h.reload()
  h.state.getPlugins = null
  h.state.local = localPlugin({ version: '0.2.0' })
  await h.reload()
  releaseOld([localPlugin()])
  await oldReload
  assert.equal(h.vm.display.version, '0.2.0')
  assert.equal(h.vm.pluginUpdateAvailable, false)
})

test('failed local refresh retains the installed version instead of presenting an installed plugin as new', async () => {
  const h = harness()
  h.state.getPlugins = async () => { throw Error('temporarily unavailable') }
  await h.reload()
  assert.equal(h.vm.display.version, '0.1.1')
  assert.equal(h.vm.installedInfo.enabled, true)
})

test('open detail refreshes after manual update checks and removes its listener on unmount', () => {
  const handlers = new Map()
  const uni = {
    $on: (event, fn) => handlers.set(event, fn),
    $off: event => handlers.delete(event),
  }
  const reloads = []
  const vm = { reload: (...args) => { reloads.push(args) }, loadContribution() {}, stopPackPoll() {}, contributionGeneration: 0, reloadGeneration: 0 }
  vm.onUpdatesChecked = method(detail, 'onUpdatesChecked', {}).bind(vm)
  const lifecycle = name => {
    const start = detail.indexOf(`  ${name}() {`)
    const end = detail.indexOf('\n  },', start)
    return new Function('uni', `return ({${detail.slice(start, end + 5)}}).${name}`).call(null, uni)
  }
  lifecycle('mounted').call(vm)
  handlers.get('awd:market-update-checked')()
  assert.deepEqual(reloads, [[], [false]], 'background checks only refresh metadata')
  lifecycle('beforeUnmount').call(vm)
  assert.equal(handlers.has('awd:market-update-checked'), false)
})

test('background version checks preserve an unsaved plugin settings draft', async () => {
  const h = harness()
  h.vm.settingsDraft = { endpoint: 'unsaved input' }
  h.vm.loadContribution = async () => { h.vm.settingsDraft = { endpoint: 'saved value' } }
  await h.vm.reload(false)
  assert.deepEqual(h.vm.settingsDraft, { endpoint: 'unsaved input' })
  assert.equal(h.vm.marketInfo.version, '0.2.0')
  await h.vm.reload()
  assert.deepEqual(h.vm.settingsDraft, { endpoint: 'saved value' })
})

for (const kind of ['detail', 'pane']) {
  test(`${kind}: update confirms the new permissions, preserves enabled state and refreshes external lists`, async () => {
    const h = harness(kind)
    await h.reload()
    await h.install()
    assert.equal(h.confirmations[0].title, 'market.confirmUpdatePluginTitle')
    assert.match(h.confirmations[0].content, /Write files/)
    assert.match(h.confirmations[0].content, /0.2.0/)
    assert.deepEqual(h.calls, [['install', 'project-im'], ['enabled', 'project-im', true]])
    assert.equal(h.state.local.version, '0.2.0')
    assert.equal(h.state.local.enabled, true)
    assert.ok(h.events.some(e => e.event === 'awd:market-changed' && e.local.version === '0.2.0' && e.local.enabled))
    assert.deepEqual(h.toasts, ['market.updatedToast'])
  })

  test(`${kind}: update of a disabled plugin stays disabled`, async () => {
    const h = harness(kind, { local: localPlugin({ enabled: false }) })
    await h.install()
    assert.deepEqual(h.calls, [['install', 'project-im']])
    assert.equal(h.state.local.enabled, false)
    assert.deepEqual(h.toasts, ['market.updatedToast'])
  })

  test(`${kind}: a fresh install keeps the safe disabled default`, async () => {
    const h = harness(kind, { local: null, remote: remotePlugin({ installed: false, updatable: false }) })
    await h.install()
    assert.equal(h.confirmations[0].title, 'market.confirmInstallPluginTitle')
    assert.deepEqual(h.calls, [['install', 'project-im']])
    assert.equal(h.state.local.enabled, false)
    assert.ok(h.toasts.every(t => !t.includes('updatedToast')))
  })

  test(`${kind}: a failed update stays visible and can be retried without a false success`, async () => {
    const h = harness(kind, { installFails: true })
    await h.install()
    assert.match(h.error(), /market.updateFailed.*signature rejected/)
    assert.equal(h.state.local.version, '0.1.1')
    assert.equal(h.events.length, 0)
    assert.ok(h.toasts.every(t => !t.includes('updatedToast')))
    h.state.installFails = false
    await h.install()
    assert.equal(h.error(), '')
    assert.equal(h.state.local.version, '0.2.0')
    assert.equal(h.toasts.at(-1), 'market.updatedToast')
  })

  test(`${kind}: failed re-enable reports an updated disabled plugin and the enable switch can retry`, async () => {
    const h = harness(kind, { enableFails: true })
    await h.install()
    assert.match(h.hint(), /market.updatedDisabledHint.*requires newer host/)
    assert.ok(!h.error())
    assert.equal(h.state.local.version, '0.2.0')
    assert.equal(h.state.local.enabled, false)
    assert.ok(h.events.some(e => e.local.version === '0.2.0' && e.local.enabled === false))
    assert.ok(h.toasts.every(t => !t.includes('updateFailed') && !t.includes('updatedToast')))
    h.state.enableFails = false
    if (kind === 'detail') await h.vm.onPluginToggle(true)
    else await h.vm.onToggle(h.vm.plugins[0], true)
    assert.equal(h.hint(), '')
    assert.equal(h.state.local.enabled, true)
  })

  test(`${kind}: canceling permission approval leaves the plugin untouched`, async () => {
    const h = harness(kind, { confirm: false })
    await h.install()
    assert.deepEqual(h.calls, [])
    assert.equal(h.vm.busy, false)
    assert.equal(h.vm.pluginBusyId, '')
  })

  test(`${kind}: revoked plugins cannot be updated`, async () => {
    const h = harness(kind, { local: localPlugin({ revokedReason: 'revoked' }) })
    await h.install()
    assert.equal(h.confirmations.length, 0)
    assert.deepEqual(h.calls, [])
  })
}

for (const kind of ['detail', 'pane']) {
  test(`${kind}: installed paid update requires the current account entitlement`, async () => {
    const h = harness(kind, { remote: remotePlugin({ priceCents: 1000, purchased: false }) })
    await h.install()
    assert.deepEqual(h.calls, [])
    assert.equal(h.confirmations.length, 0)
    if (kind === 'detail') assert.equal(h.vm.needsPurchase, true)
    else assert.equal(h.vm.marketAction(h.state.remote, true), 'buy')
    h.state.purchaseOnRefresh = true
    if (kind === 'detail') await h.vm.onPurchasedRefresh()
    else await h.vm.refreshPluginPurchase(h.state.remote)
    assert.equal(h.confirmations[0].title, 'market.confirmUpdatePluginTitle')
    assert.equal(h.state.local.version, '0.2.0')
    assert.equal(h.state.local.enabled, true)
  })

  test(`${kind}: disconnected paid update can resume after login and entitlement refresh`, async () => {
    const h = harness(kind, { remote: remotePlugin({ priceCents: 1000, purchased: false }), accountConnected: false })
    await h.install()
    assert.deepEqual(h.calls, [])
    if (kind === 'detail') assert.equal(h.vm.paidStateValue, 'need-account')
    else assert.equal(h.vm.marketAction(h.state.remote, true), 'need-account')
    h.state.purchaseOnRefresh = true
    if (kind === 'detail') await h.vm.loginThenContinue()
    else await h.vm.loginThenInstall('plugin', h.state.remote)
    assert.equal(h.state.local.version, '0.2.0')
    assert.equal(h.state.local.enabled, true)
  })

  for (const [change, actualInstalled] of [
    ['version', { version: '0.3.0' }],
    ['permissions', { permissions: ['im', 'file_write', 'network'] }],
  ]) {
    test(`${kind}: changed installed ${change} never auto-enables unconfirmed code`, async () => {
      const h = harness(kind)
      h.state.actualInstalled = actualInstalled
      await h.install()
      assert.deepEqual(h.calls, [['install', 'project-im']])
      assert.equal(h.state.local.enabled, false)
      assert.match(h.hint(), /market.updateConfirmationChangedHint/)
      assert.ok(!h.error())
      if (kind === 'detail' && change === 'permissions') {
        assert.match(h.vm.pluginPermissionText, /network/)
        assert.doesNotMatch(h.confirmations[0].content, /network/)
      }
    })
  }

  test(`${kind}: failure to read the installed manifest leaves the new plugin disabled`, async () => {
    const h = harness(kind)
    h.state.getPlugins = async () => { throw Error('read unavailable') }
    await h.install()
    assert.deepEqual(h.calls, [['install', 'project-im']])
    assert.equal(h.state.local.version, '0.2.0')
    assert.equal(h.state.local.enabled, false)
    assert.match(h.hint(), /market.updateVerificationFailedHint/)
    assert.ok(!h.error())
    const displayed = kind === 'detail' ? h.vm.installedInfo : h.vm.plugins[0]
    assert.equal(displayed.enabled, false)
    assert.equal(displayed.version, '')
  })
}

test('update controls render native keyboard-accessible buttons with disabled state', () => {
  assert.match(detail, /<component\s+:is="'button'"\s+v-else-if="pluginUpdateAvailable && !needsPurchase"[\s\S]*?:disabled="busy"[\s\S]*?@click="doInstallPlugin"/)
  assert.match(pane, /<component\s+:is="'button'"[\s\S]*?:disabled="!!pluginBusyId"[\s\S]*?@click="installPlugin\(m\)"/)
  assert.match(detail, /marketInfo && \(!installedInfo \|\| pluginUpdateAvailable\) && needsPurchase/)
})
