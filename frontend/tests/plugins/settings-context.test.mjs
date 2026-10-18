// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../../src/components/MarketDetailPane.vue', import.meta.url), 'utf8')
const open = new Function('spec', page.split('    openMarketDetail(spec) {')[1].split('\n    formatTime(')[0].replace(/\n    },\s*$/, ''))
const loadBody = detail.split('    async loadContribution() {')[1].split('\n    async doSaveSettings()')[0].replace(/\n    },\s*$/, '')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

test('market entry carries current project and settings.open refreshes an existing singleton tab', () => {
  const vm = { projectId: 74, leftFiles: [], rightFiles: [], splitMode: false, $nextTick() {} }
  open.call(vm, { kind: 'plugin', id: 'example' })
  assert.equal(vm.leftFiles[0].marketSpec.projectId, 74)
  open.call(vm, { kind: 'plugin', id: 'example', projectId: 81 })
  assert.equal(vm.leftFiles.length, 1)
  assert.equal(vm.leftFiles[0].marketSpec.projectId, 81)
  open.call(vm, { kind: 'plugin', id: 'example', projectId: null })
  assert.equal(vm.leftFiles[0].marketSpec.projectId, null)
})

test('late project settings cannot replace settings loaded for a new context', async () => {
  const requests = []
  const load = new AsyncFunction('getPluginSettings', 'getContributedStyleProfiles', loadBody)
  const settings = (_id, projectId) => new Promise(resolve => requests.push({ projectId, resolve }))
  const profiles = async () => ({ profiles: [] })
  const vm = { contributionGeneration: 0, spec: { kind: 'plugin', id: 'example', projectId: 74 }, installedInfo: {} }
  const old = load.call(vm, settings, profiles)
  vm.spec = { ...vm.spec, projectId: 81 }
  const current = load.call(vm, settings, profiles)
  requests[1].resolve({ settings: [{ key: 'label', value: 'current' }] }); await current
  requests[0].resolve({ settings: [{ key: 'label', value: 'old' }] }); await old
  assert.deepEqual(requests.map(r => r.projectId), [74, 81])
  assert.equal(vm.settingsDraft.label, 'current')
})
