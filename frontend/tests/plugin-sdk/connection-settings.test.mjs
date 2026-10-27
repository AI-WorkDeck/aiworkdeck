// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/PluginConnectionSettings.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture(options = {}) {
  const calls = [], events = [], listeners = {}
  const request = async (...args) => { calls.push(args); return options.request ? options.request(...args) : { connections: [] } }
  const uni = { $on: (name, fn) => { listeners[name] = fn }, $off: name => { delete listeners[name] }, $emit: (...args) => events.push(args), showModal: value => value.success({ confirm: true }) }
  const component = new Function('pluginPlatformRequest', 'getPluginDevTrust', 'setPluginDevTrust', 'openExternalUrlChecked', 'uni', source)(request, async () => ({ trusted: true, devInstalled: true }), async () => {}, options.open || (async () => {}), uni)
  const vm = { ...component.data(), pluginId: 'example', $t: key => key }
  for (const [name, fn] of Object.entries(component.methods)) vm[name] = fn.bind(vm)
  component.mounted.call(vm)
  return { vm, component, calls, events, listeners }
}
const oauth = { id: 'oauth-provider', authType: 'oauth2', connected: false }
test('OAuth opening failure is visible and never emits a successful settings refresh', async () => {
  const f = fixture({ request: async () => ({ data: { authorizationUrl: 'https://service.example/authorize' } }), open: async () => { throw Error('browser unavailable') } })
  await f.vm.act(oauth)
  assert.match(f.vm.error, /browser unavailable/); assert.equal(f.vm.busy, ''); assert.deepEqual(f.events, []); assert.equal(f.calls.length, 1)
})
test('OAuth waits for system opening and ignores its late rejection after account change', async () => {
  const pending = deferred()
  const f = fixture({ request: async (_id, operation) => operation === 'connections.authorize' ? { data: { authorizationUrl: 'https://service.example/authorize' } } : { connections: [] }, open: () => pending.promise })
  const action = f.vm.act(oauth); await flush(); assert.equal(f.vm.busy, oauth.id)
  f.listeners['awd:account-changed'](); await flush()
  pending.reject(Error('old account error')); await action
  assert.equal(f.vm.error, ''); assert.equal(f.vm.busy, ''); assert.deepEqual(f.events, [])
})
test('account change before authorization response prevents external navigation', async () => {
  const pending = deferred(); let opened = 0
  const f = fixture({ request: (_id, operation) => operation === 'connections.authorize' ? pending.promise : { connections: [] }, open: async () => { opened++ } })
  const action = f.vm.act(oauth); f.listeners['awd:account-changed']()
  pending.resolve({ data: { authorizationUrl: 'https://service.example/authorize' } }); await action
  assert.equal(opened, 0); assert.deepEqual(f.events, [])
})
test('bearer token is removed immediately from UI and never retained after unmount', async () => {
  const pending = deferred(); const f = fixture({ request: () => pending.promise })
  f.vm.tokens.own = 'synthetic-only'; const action = f.vm.act({ id: 'own', authType: 'bearer' })
  assert.equal(f.vm.tokens.own, ''); assert.equal(f.calls[0][2].token, 'synthetic-only')
  f.component.beforeUnmount.call(f.vm); pending.resolve({}); await action
  assert.deepEqual(f.vm.tokens, {}); assert.deepEqual(f.events, []); assert.equal(Object.keys(f.listeners).length, 0)
})
test('late subscription response from previous account does not update new state', async () => {
  const pending = deferred(); const f = fixture({ request: (_id, operation) => operation === 'billing.status' ? pending.promise : { connections: [] } })
  const action = f.vm.checkBilling({ id: 'own' }); f.listeners['awd:account-changed']()
  pending.resolve({ data: { active: true } }); await action
  assert.deepEqual(f.vm.subscription, {})
})
test('latest reload wins when same-account list responses arrive out of order', async () => {
  const old = deferred(), latest = deferred(); let count = 0
  const f = fixture({ request: () => (++count === 1 ? old.promise : latest.promise) })
  const first = f.vm.reload(); await flush(); const second = f.vm.reload(); await flush()
  latest.resolve({ connections: [{ id: 'own', connected: false }] }); await second
  old.resolve({ connections: [{ id: 'own', connected: true }] }); await first
  assert.equal(f.vm.rows[0].connected, false)
})
test('disconnect invalidates pending lists and clears previous subscription immediately', async () => {
  const old = deferred(), disconnect = deferred(); let lists = 0
  const f = fixture({ request: (_id, operation) => operation === 'connections.disconnect' ? disconnect.promise : (++lists === 1 ? old.promise : { connections: [{ id: 'own', connected: false }] }) })
  f.vm.subscription.own = 'pluginPlatform.active'
  const refresh = f.vm.reload(); await flush(); const action = f.vm.act({ id: 'own', connected: true })
  assert.equal(f.vm.subscription.own || '', '')
  old.resolve({ connections: [{ id: 'own', connected: true }] }); await refresh
  assert.deepEqual(f.vm.rows, [])
  disconnect.resolve({}); await action; assert.equal(f.vm.rows[0].connected, false)
})
test('subscription refresh clears prior success and latest failed check cannot be overwritten', async () => {
  const old = deferred(), latest = deferred(); let count = 0
  const f = fixture({ request: () => (++count === 1 ? old.promise : latest.promise) })
  f.vm.subscription.own = 'pluginPlatform.active'
  const first = f.vm.checkBilling({ id: 'own' }); assert.equal(f.vm.subscription.own || '', '')
  const second = f.vm.checkBilling({ id: 'own' }); latest.reject(Error('subscription unavailable')); await second
  old.resolve({ data: { active: true } }); await first
  assert.equal(f.vm.subscription.own || '', ''); assert.match(f.vm.error, /subscription unavailable/)
})
