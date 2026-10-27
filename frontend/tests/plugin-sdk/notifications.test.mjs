// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
function harness(send = async () => ({ code: 0, data: { id: 'notice:1', actionState: 'pending' } })) {
  const events = []
  const options = new Function('requestPluginNotifications', 'uni', body)(send, { $emit: (...args) => events.push(args) })
  const vm = { ...options.data(), pluginId: 'example-notice', permissions: ['notifications'], projectId: null }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  return { vm, events, options }
}
test('notification bridge binds plugin identity, works without a project, and never treats read as done', async () => {
  const calls = [], { vm, events } = harness(async (...args) => { calls.push(args); return { code: 0, data: { actionState: 'pending' } } })
  const input = { eventKey: 'case-1', title: '请确认', actionState: 'pending', pluginId: 'forged' }
  assert.deepEqual(await vm.handleCall('notifications.publish', input), { ok: true, result: { actionState: 'pending' } })
  assert.deepEqual(calls, [['example-notice', 'publish', input]])
  assert.deepEqual(events, [['awd:message-center-changed']])
})
test('missing notification permission stops transport and revoked context discards late response', async () => {
  let count = 0
  const denied = harness(async () => { count++; throw new Error('must not call') }); denied.vm.permissions = []
  assert.equal((await denied.vm.handleCall('notifications.publish', {})).error.code, 'permission_denied')
  assert.equal(count, 0)
  let finish
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  const call = h.vm.handleCall('notifications.resolve', { eventKey: 'x', state: 'done' })
  h.vm.sessionGeneration++; finish({ code: 0, data: { private: 'previous account' } })
  assert.equal((await call).error.code, 'stale_context'); assert.deepEqual(h.events, [])
})
test('server failure remains visible and installed legacy project plugin directs to updates', async () => {
  const { vm, options, events } = harness(async () => ({ code: 403, message: '权限已撤销' }))
  assert.equal((await vm.handleCall('notifications.publish', {})).error.message, '权限已撤销')
  vm.pluginId = 'project-im'; vm.authorizationReady = true; vm.installedPluginVersion = '0.1.1'
  assert.equal(options.computed.legacyProjectCommunication.call(vm), true)
  vm.openPluginUpdate(); assert.deepEqual(events[0], ['awd:plugin-open-settings', { pluginId: 'project-im' }])
  vm.installedPluginVersion = '0.2.0'; assert.equal(options.computed.legacyProjectCommunication.call(vm), false)
})
test('an old lawfirm plugin cannot silently open a local ledger in place of a cloud confirmation', () => {
  const { vm, options } = harness()
  vm.pluginId = 'lawfirm-management'; vm.authorizationReady = true; vm.installedPluginVersion = '0.1.1'
  assert.equal(options.computed.legacyLawfirmWorkflow.call(vm), false)
  vm.lawfirmWorkflowRequested = true
  assert.equal(options.computed.legacyLawfirmWorkflow.call(vm), true)
  vm.installedPluginVersion = '0.1.2'; assert.equal(options.computed.legacyLawfirmWorkflow.call(vm), false)
  vm.installedPluginVersion = '0.1.10'; assert.equal(options.computed.legacyLawfirmWorkflow.call(vm), false)
})
