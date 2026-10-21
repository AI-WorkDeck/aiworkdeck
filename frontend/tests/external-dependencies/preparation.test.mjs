// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const src = readFileSync(new URL('../../src/components/admin/ExternalDependenciesPanel.vue', import.meta.url), 'utf8')
const script = src.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =')
function setup(check, open = async () => {}) {
  const sandbox = { SettingsSection: {}, checkExternalDependencies: check, openExternalUrlChecked: open, window: { addEventListener() {}, removeEventListener() {} } }
  vm.runInNewContext(script, sandbox)
  const component = sandbox.component
  const instance = { ...component.data(), $t: key => key, alive: true }
  for (const [key, value] of Object.entries(component.methods)) instance[key] = value.bind(instance)
  return { component, instance }
}
test('installer return rechecks without claiming that opening a page installed anything', async () => {
  let checks = 0
  const { instance } = setup(async () => ({ code: 0, platform: 'windows', dependencies: [{ id: 'docker', status: ++checks === 1 ? 'DAEMON_UNAVAILABLE' : 'AVAILABLE' }] }))
  await instance.check(); assert.equal(instance.statuses.docker, 'DAEMON_UNAVAILABLE')
  await instance.open('https://docs.docker.com/desktop/'); assert.equal(instance.statuses.docker, 'DAEMON_UNAVAILABLE')
  instance.onReturn(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2); assert.equal(instance.statuses.docker, 'AVAILABLE')
})
test('failed recheck clears stale available status and can be retried', async () => {
  let failed = true
  const { instance } = setup(async () => { if (failed) throw new Error('offline'); return { code: 0, dependencies: [] } })
  instance.statuses = { docker: 'AVAILABLE' }; await instance.check()
  assert.equal(instance.error, 'offline'); assert.equal(Object.keys(instance.statuses).length, 0)
  failed = false; await instance.check(); assert.equal(instance.error, '')
})
test('returning from installation during an active check queues one fresh probe', async () => {
  let finish, calls = 0
  const { instance } = setup(() => {
    calls++
    if (calls === 1) return new Promise(resolve => { finish = resolve })
    return Promise.resolve({ code: 0, dependencies: [{ id: 'docker', status: 'AVAILABLE' }] })
  })
  const pending = instance.check()
  await instance.open('https://docs.docker.com/desktop/')
  instance.onReturn()
  finish({ code: 0, dependencies: [{ id: 'docker', status: 'DAEMON_UNAVAILABLE' }] })
  await pending
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 2)
  assert.equal(instance.statuses.docker, 'AVAILABLE')
})
test('leaving settings prevents late response replacing state; duplicate checks are coalesced', async () => {
  let finish, calls = 0
  const { component, instance } = setup(() => { calls++; return new Promise(resolve => { finish = resolve }) })
  const pending = instance.check(); await instance.check(); assert.equal(calls, 1)
  component.beforeUnmount.call(instance); finish({ code: 0, dependencies: [{ id: 'docker', status: 'AVAILABLE' }] }); await pending
  assert.equal(Object.keys(instance.statuses).length, 0)
})
test('blocked browser exposes a retryable error without pretending installation started', async () => {
  const { instance } = setup(async () => {}, async () => { throw new Error('browser blocked') })
  await instance.open('https://example.invalid/'); assert.equal(instance.awaitingReturn, false); assert.equal(instance.error, 'browser blocked')
})
