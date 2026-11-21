// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const body = ((s) => s.slice(s.indexOf('<script>') + 8, s.indexOf('</script>')))(readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8'))
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
test('openWorkspace({ projectId }) asks the workbench to open that project for this plugin only', async () => {
  const calls = []
  const vm = (state) => ({ ...options.data(), pluginId: 'my-plugin', permissions: [], businessActions: {
    openPluginWorkspace() { calls.push('in-place'); return true },
    async openPluginWorkspaceInProject(id, projectId) { calls.push([id, projectId]); return state }
  } })
  assert.deepEqual(await options.methods.handleCall.call(vm('opened'), 'ui.openWorkspace', { projectId: 42, pluginId: 'other' }), { ok: true, result: {} })
  assert.equal((await options.methods.handleCall.call(vm('forbidden'), 'ui.openWorkspace', { projectId: '7' })).error.code, 'permission_denied')
  assert.equal((await options.methods.handleCall.call(vm(undefined), 'ui.openWorkspace', { projectId: '7' })).error.code, 'unavailable')
  assert.deepEqual(calls, [['my-plugin', '42'], ['my-plugin', '7'], ['my-plugin', '7']])
  for (const projectId of ['../1', '1&openPlugin=x', 'abc', { id: 1 }]) {
    assert.equal((await options.methods.handleCall.call(vm('opened'), 'ui.openWorkspace', { projectId })).error.code, 'invalid_params')
  }
  assert.equal(calls.length, 3, 'a malformed projectId never reaches the workbench')
  // Without the argument (or with an empty one) nothing changes: the workspace opens in place.
  await options.methods.handleCall.call(vm('opened'), 'ui.openWorkspace', { projectId: '' })
  assert.equal(calls.at(-1), 'in-place')
})
test('the init context tells plugins which project features this host has', () => {
  const src = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
  assert.match(src, /capabilities: \['view\.openProjectId', 'ui\.openWorkspace\.projectId'\]/)
})
