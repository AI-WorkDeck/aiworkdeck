// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
const source = api.slice(api.indexOf('export function pluginPlatformRequest('), api.indexOf('export const getBundledPlugins')).replace('export function', 'function')
function fixture() {
  const calls = []
  const request = value => { calls.push(value); return Promise.resolve({}) }
  return { calls, perform: new Function('request', source + '; return pluginPlatformRequest')(request) }
}
test('host billing omits absent connectionId so Uni cannot serialize it as an empty service connection', async () => {
  const { calls, perform } = fixture()
  for (const action of ['billing.status', 'billing.checkout']) {
    for (const params of [{}, { connectionId: undefined }, { connectionId: null }]) {
      await perform('demo', action, params)
      assert.deepEqual(calls.at(-1).data, {}, action + ' must omit the query key entirely')
    }
  }
})
test('provider billing preserves its explicit connection and does not silently select host billing', async () => {
  const { calls, perform } = fixture()
  for (const action of ['billing.status', 'billing.checkout']) {
    for (const connectionId of ['own-provider', '']) {
      await perform('demo', action, { connectionId })
      assert.deepEqual(calls.at(-1).data, { connectionId })
    }
  }
})
