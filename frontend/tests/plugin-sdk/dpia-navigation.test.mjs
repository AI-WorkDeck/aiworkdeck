// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
const conversation = { conversationId: 'conv-owned', title: 'DPIA · 合成评估', projectId: 5 }
function harness({ rows = [conversation], query, openConversation, openBrowser, permissions = ['ai', 'network'] } = {}) {
  const queries = [], opened = [], urls = []
  const options = new Function('getAiConversations', 'URL', body)(async projectId => {
    queries.push(projectId)
    return query ? query(projectId) : { code: 0, data: rows }
  }, URL)
  const vm = { ...options.data(), projectId: 5, permissions, businessActions: {
    openConversation: async row => { opened.push(row); return openConversation ? openConversation(row) : true },
    openBrowser: async url => { urls.push(url); return openBrowser?.(url) }
  } }
  for (const [name, method] of Object.entries(options.methods)) vm[name] = method.bind(vm)
  return { vm, queries, opened, urls }
}

test('chat.open uses authorized project history and ignores forged row/project data', async () => {
  const h = harness()
  assert.deepEqual(await h.vm.handleCall('chat.open', { conversationId: 'conv-owned', projectId: 999, title: 'forged' }), { ok: true, result: {} })
  assert.deepEqual(h.queries, [5])
  assert.deepEqual(h.opened, [conversation])
})

test('chat.open requires ai permission and never opens an unknown conversation', async () => {
  const denied = harness({ permissions: ['network'] })
  assert.equal((await denied.vm.handleCall('chat.open', { conversationId: 'conv-owned' })).error.code, 'permission_denied')
  assert.deepEqual(denied.queries, [])
  const h = harness({ rows: [{ ...conversation, conversationId: 'conv-other' }] })
  assert.equal((await h.vm.handleCall('chat.open', { conversationId: 'conv-owned' })).error.code, 'not_found')
  assert.deepEqual(h.opened, [])
  for (const conversationId of ['', 'x'.repeat(201)]) assert.equal((await h.vm.handleCall('chat.open', { conversationId })).error.code, 'invalid_params')
})

test('chat.open rejects a reply from an earlier generation before opening', async () => {
  const gate = deferred(), h = harness({ query: () => gate.promise })
  const pending = h.vm.handleCall('chat.open', { conversationId: 'conv-owned' })
  h.vm.sessionGeneration++
  gate.resolve({ data: [conversation] })
  assert.equal((await pending).error.code, 'stale_context')
  assert.deepEqual(h.opened, [])
})

test('chat.open rejects a changed project even before its watcher increments generation', async () => {
  const gate = deferred(), h = harness({ query: () => gate.promise })
  const pending = h.vm.handleCall('chat.open', { conversationId: 'conv-owned' })
  h.vm.projectId = 6
  gate.resolve({ data: [conversation] })
  assert.equal((await pending).error?.code, 'stale_context')
  assert.deepEqual(h.opened, [])
})

test('chat.open reports opening failure without a success receipt', async () => {
  const h = harness({ openConversation: () => false })
  assert.equal((await h.vm.handleCall('chat.open', { conversationId: 'conv-owned' })).error.code, 'open_failed')
})

test('ui.openUrl requires network permission and allows only credential-free HTTPS', async () => {
  const h = harness()
  for (const url of ['', 'not-a-url', 'http://example.org', 'file:///private/secret', 'javascript:alert(1)', 'https://user:password@example.org']) {
    assert.equal((await h.vm.handleCall('ui.openUrl', { url })).error.code, 'invalid_params', url)
  }
  assert.deepEqual(h.urls, [])
  const url = 'https://www.edpb.europa.eu/public-consultations/example'
  assert.deepEqual(await h.vm.handleCall('ui.openUrl', { url }), { ok: true, result: {} })
  assert.deepEqual(h.urls, [url])
  const denied = harness({ permissions: ['ai'] })
  assert.equal((await denied.vm.handleCall('ui.openUrl', { url })).error.code, 'permission_denied')
  assert.deepEqual(denied.urls, [])
})

test('ui.openUrl reports missing browser capability', async () => {
  const h = harness()
  h.vm.businessActions.openBrowser = null
  assert.equal((await h.vm.handleCall('ui.openUrl', { url: 'https://example.org' })).error.code, 'unavailable')
})
