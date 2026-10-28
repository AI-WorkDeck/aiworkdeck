// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/MarketDetailPane.vue', import.meta.url), 'utf8')
function method(name, deps = {}) {
  const start = source.indexOf(`    async ${name}(`)
  assert.ok(start >= 0)
  const end = source.indexOf('\n    },', start)
  return new Function(...Object.keys(deps), `return ({${source.slice(start, end + 6)}}).${name}`)(...Object.values(deps))
}
test('late ready response cannot overwrite a refreshed uninstalled pack or reenable its skill', async () => {
  let resolve, enabled = 0
  const refresh = method('refreshPackStatus', { packStatus: () => new Promise(r => { resolve = r }) })
  const vm = { packId: 'litigation-visual', reloadGeneration: 1, installedInfo: { packReady: true, enabled: false },
    packStatusInfo: null, packBusy: false, stopPackPoll() {}, onPanelSkillToggle: async () => { enabled++ } }
  const pending = refresh.call(vm)
  // An uninstall/reload has completed while the earlier native status request was pending.
  vm.reloadGeneration++
  vm.installedInfo = { packReady: false, enabled: false }
  vm.packStatusInfo = { state: 'not_installed' }
  resolve({ status: { state: 'ready' } })
  await pending
  assert.equal(vm.installedInfo.packReady, false)
  assert.equal(vm.packStatusInfo.state, 'not_installed')
  assert.equal(enabled, 0)
})
test('current ready response still updates the pack and enables the disabled skill', async () => {
  let enabled = 0
  const refresh = method('refreshPackStatus', { packStatus: async () => ({ status: { state: 'ready' } }) })
  const vm = { packId: 'litigation-visual', reloadGeneration: 1, installedInfo: { packReady: false, enabled: false },
    packStatusInfo: null, packBusy: true, stopPackPoll() {}, onPanelSkillToggle: async () => { enabled++ } }
  await refresh.call(vm)
  assert.equal(vm.installedInfo.packReady, true)
  assert.equal(enabled, 1)
})
test('confirmed uninstall invalidates pending status before awaiting the native mutation', async () => {
  let resolveStatus, finishDisable, stopping = 0, enabled = 0
  const refresh = method('refreshPackStatus', { packStatus: () => new Promise(r => { resolveStatus = r }) })
  const uninstall = method('doUninstallPack', {
    uni: { showModal: o => o.success({ confirm: true }), showToast() {} },
    setSkillActivation: () => new Promise(r => { finishDisable = r }), packUninstall: async () => {}, console
  })
  const vm = { packId: 'litigation-visual', reloadGeneration: 1, installedInfo: { packReady: true, enabled: false },
    packMeta: {}, spec: { id: 'litigation-visual' }, busy: false, packBusy: false, packStatusInfo: null,
    $t: key => key, stopPackPoll() { stopping++ }, onPanelSkillToggle: async () => { enabled++ },
    reload: async () => { vm.reloadGeneration++; vm.installedInfo = { packReady: false, enabled: false } }, notifyChanged() {} }
  const pendingStatus = refresh.call(vm)
  const pendingUninstall = uninstall.call(vm)
  await Promise.resolve()
  assert.equal(typeof finishDisable, 'function')
  resolveStatus({ status: { state: 'ready' } })
  await pendingStatus
  assert.equal(enabled, 0)
  assert.equal(vm.packStatusInfo, null)
  finishDisable()
  await pendingUninstall
  assert.equal(vm.installedInfo.packReady, false)
  assert.equal(vm.busy, false)
  assert.ok(stopping > 0)
})
