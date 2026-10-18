// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/utils/pluginPlatformServices.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace('export function', 'function')
function fixture(options = {}) {
  const calls = [], events = [], urls = []
  const api = {
    pluginPlatformRequest: async (...args) => { calls.push(args); return { data: { url: 'https://checkout.example/order' }, connections: [{ id: 'own' }] } },
    getPluginSettings: async () => ({ settings: [{ key: 'personal', scope: 'user', value: 'a' }, { key: 'secret', scope: 'user', secret: true }, { key: 'global', scope: 'installation' }] }),
    savePluginSettings: async (...args) => { calls.push(args) }, ...options.api
  }
  const uni = { $emit: (...args) => events.push(args), showModal: args => args.success({ confirm: options.confirm === true }) }
  const create = new Function('api', 'uni', 'openExternalUrl', `const {pluginPlatformRequest,getPluginSettings,savePluginSettings}=api; ${source}; return createPluginPlatformServices`)(api, uni, url => urls.push(url))
  return { bridge: create({ pluginId: 'plugin-one', projectId: 7, permissions: options.permissions || ['network'], isCurrent: options.isCurrent }), calls, events, urls }
}
test('plugin cannot select another project or write credentials/installation settings', async () => {
  const { bridge, calls } = fixture()
  for (const key of ['secret', 'global', 'unknown']) assert.equal((await bridge.request('settings.update', { values: { [key]: 'x' } })).error.code, 'permission_denied')
  assert.deepEqual(calls, [])
  await bridge.request('settings.update', { projectId: 99, values: { personal: 'b' } })
  assert.deepEqual(calls[0], ['plugin-one', { personal: 'b' }, 7])
  await bridge.request('mcp.call', { projectId: 99, serverId: 'own', name: 'echo' })
  assert.equal(calls[1][2].projectId, 7)
})
test('connect opens trusted host UI and never passes supplied tokens to HTTP', async () => {
  const { bridge, calls, events } = fixture()
  assert.equal((await bridge.request('connections.connect', { id: 'own', token: 'do-not-forward' })).ok, true)
  assert.deepEqual(calls, [])
  assert.deepEqual(events, [['awd:plugin-open-settings', { pluginId: 'plugin-one', projectId: 7, connectionId: 'own' }]])
})
test('network permission blocks service and MCP calls before HTTP', async () => {
  const { bridge, calls } = fixture({ permissions: [] })
  for (const method of ['connections.list', 'mcp.call']) assert.equal((await bridge.request(method)).error.code, 'permission_denied')
  assert.deepEqual(calls, [])
})
test('dispose aborts actual request and rejects late replies', async () => {
  let complete, signal
  const { bridge } = fixture({ api: { pluginPlatformRequest: (_id, _action, _params, s) => { signal = s; return new Promise(resolve => { complete = resolve }) } } })
  const promise = bridge.request('mcp.call')
  bridge.dispose(); assert.equal(signal.aborted, true)
  complete({ result: { content: [] } })
  assert.equal((await promise).error.code, 'cancelled')
})
test('checkout requires host confirmation and current identity after response', async () => {
  for (const confirm of [false, true]) {
    const { bridge, urls } = fixture({ confirm })
    await bridge.request('billing.checkout')
    assert.equal(urls.length, confirm ? 1 : 0)
  }
  const { bridge, calls } = fixture({ isCurrent: () => false })
  assert.equal((await bridge.request('billing.checkout')).error.code, 'cancelled')
  assert.equal(calls.length, 0)
})
