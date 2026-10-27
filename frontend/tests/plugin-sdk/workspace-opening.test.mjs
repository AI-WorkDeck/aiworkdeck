// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const body = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
const options = new Function(body)()
test('openWorkspace uses the authenticated caller, ignoring supplied plugin identity and URL', async () => {
  const calls = []
  const vm = { ...options.data(), pluginId: 'my-plugin', permissions: [], businessActions: {
    openPluginWorkspace(id) { calls.push(id); return true }
  } }
  assert.deepEqual(await options.methods.handleCall.call(vm, 'ui.openWorkspace', { pluginId: 'other', url: 'https://invalid.example/' }), { ok: true, result: {} })
  assert.deepEqual(calls, ['my-plugin'])
})
test('openWorkspace does not report success without a declared, available workspace', async () => {
  for (const businessActions of [{}, { openPluginWorkspace: () => false }]) {
    const vm = { ...options.data(), pluginId: 'my-plugin', businessActions }
    assert.equal((await options.methods.handleCall.call(vm, 'ui.openWorkspace', {})).error.code, 'unavailable')
  }
})
