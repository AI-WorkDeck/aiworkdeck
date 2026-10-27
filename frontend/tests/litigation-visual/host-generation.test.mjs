// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../../src/composables/useLitigationGeneration.js', import.meta.url), 'utf8')
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

// Execute the complete host composable, including its interval closure. Only
// network calls, the generation controller, and Vue/app lifecycle are replaced.
function fixture(t, overrides = {}) {
  const vm = { projectId: 1, canWriteProject: true }
  const controllers = [], unmounts = []
  let tick, accountGeneration = 1
  const deps = {
    getCurrentInstance: () => ({ proxy: vm }),
    onBeforeUnmount: callback => unmounts.push(callback),
    useAgentStream: () => ({}),
    getCurrentUser: () => ({ id: 7 }),
    t: key => key,
    getApiBaseUrl: () => 'http://test.local',
    getCloudAccountGeneration: () => accountGeneration,
    getAccountStatus: async () => ({ accountId: 'synthetic-account' }),
    getPlugins: async () => [{ id: 'litigation-visual', enabled: true, permissions: ['file_read', 'file_write', 'ai'] }],
    getSkills: async () => [{ id: 'litigation-visual', enabled: true }],
    getLitigationKickoffPrompt() {},
    getLitigationDiagrams() {},
    issueAgentConversation() {},
    getAiHistory() {},
    getAgentInbox() {},
    fetchAiModels() {},
    uni: { getStorageSync() {}, setStorageSync() {}, $emit() {} },
    setInterval: callback => { tick = callback; return 1 },
    clearInterval() {},
    createLitigationGeneration: config => {
      const record = { projectId: config.api.projectId, disposed: false, revocations: [], requests: [] }
      controllers.push(record)
      return {
        observe: async () => ({ phase: 'running' }),
        request: async operation => { record.requests.push(operation); return { phase: 'running' } },
        dispose: () => { record.disposed = true },
        revoke: async message => { record.revocations.push(message) },
      }
    },
    ...overrides,
  }
  const body = SOURCE.replace(/^import[\s\S]*?from ['"][^'"]+['"]\n/gm, '')
    .replace('export function useLitigationGeneration()', 'function useLitigationGeneration()')
  const make = new Function(...Object.keys(deps), body + '\nreturn useLitigationGeneration()')
  const request = make(...Object.values(deps))
  t.after(() => unmounts.forEach(callback => callback()))
  return { vm, controllers, request, tick: () => tick(), switchAccount: () => { accountGeneration++ } }
}

test('a late revoked-permission result from the old project cannot stop the new project task', async t => {
  const permission = deferred()
  const f = fixture(t, { getPlugins: () => permission.promise })
  await f.request('generation')
  const pendingCheck = f.tick()
  await flush()
  f.vm.projectId = 2
  await f.request('generate')
  permission.resolve([])
  await pendingCheck
  assert.equal(f.controllers.length, 2)
  assert.equal(f.controllers[0].disposed, true)
  assert.deepEqual(f.controllers[0].revocations, [])
  assert.deepEqual(f.controllers[1].requests, ['generate'])
  assert.deepEqual(f.controllers[1].revocations, [], 'the old check must never revoke the replacement controller')
})

test('revoked permissions still stop the task when its project and controller are current', async t => {
  const f = fixture(t, { getPlugins: async () => [] })
  await f.request('generate')
  await f.tick()
  assert.equal(f.controllers[0].revocations.length, 1)
  assert.match(f.controllers[0].revocations[0], /litTaskDisabled/)
})

for (const change of ['project', 'account']) {
  test(`initialization discards the old account response after a ${change} change`, async t => {
    const account = deferred()
    let accountCalls = 0
    const f = fixture(t, { getAccountStatus: () => ++accountCalls === 1
      ? account.promise : Promise.resolve({ accountId: 'current-account' }) })
    const oldRequest = f.request('generate')
    const rejected = assert.rejects(oldRequest, /litTaskContextChanged/)
    if (change === 'project') f.vm.projectId = 2
    else f.switchAccount()
    account.resolve({ accountId: 'old-account' })
    await rejected
    assert.equal(f.controllers.length, 0, 'stale initialization must not construct or submit a controller')
    await f.request('generate')
    assert.equal(accountCalls, 2, 'a current request must start a fresh initialization')
    assert.equal(f.controllers.length, 1)
    assert.equal(f.controllers[0].projectId, f.vm.projectId)
    assert.deepEqual(f.controllers[0].requests, ['generate'])
  })
}


test('temporary permission lookup failure does not cancel an accepted background task', async t => {
  const f = fixture(t, { getPlugins: async () => { throw new Error('synthetic network timeout') } })
  await f.request('generate')
  await f.tick()
  assert.deepEqual(f.controllers[0].revocations, [])
})
