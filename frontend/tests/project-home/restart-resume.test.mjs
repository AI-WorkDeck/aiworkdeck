// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chat = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
const body = chat.slice(chat.indexOf('    let restartResuming = false'), chat.indexOf('    // Expose methods for parent ref access'))
const stream = readFileSync(new URL('../../src/composables/useAgentStream.js', import.meta.url), 'utf8')
const reconnect = stream.slice(stream.indexOf('reattachSSE: async')).split('// Load metadata')[0]
  .replace('reattachSSE: ', '').trim().replace(/,$/, '')
const reattach = (connectSSE, isConnected) => new Function('connectSSE', 'isConnected', 'console', `return (${reconnect})`)(connectSSE, isConnected, { warn() {} })

function fixture(connect = async () => true) {
  const currentConversationId = { value: 'original' }
  const activeDocChip = { value: { id: 99 } }
  const props = { projectId: 42 }
  let generation = 1
  const calls = []
  const pending = [{ conversationId: 'original', projectId: 42, activeFileId: 99 }]
  const fn = new Function('currentConversationId', 'props', 'activeDocChip', 'getCloudAccountGeneration',
    'getPendingAgentRestarts', 'reattachSSE', 'resumeAgentRestart', `${body}; return resumeAfterRestart`)(
    currentConversationId, props, activeDocChip, () => generation,
    async () => pending, connect, async payload => { calls.push(payload); return { resumed: true } })
  return { fn, calls, pending, currentConversationId, activeDocChip, switchAccount() { generation++ } }
}

test('failed SSE connection does not consume a restart checkpoint', async () => {
  const connect = reattach(async () => { throw new Error('offline') }, { value: false })
  const f = fixture(() => connect('original'))
  assert.equal(await f.fn(99), false)
  assert.deepEqual(f.calls, [])
})

test('ready original editor resumes only once for concurrent recovery callbacks', async () => {
  const f = fixture()
  const results = await Promise.all([f.fn(99), f.fn(99)])
  assert.deepEqual(results, [true, false])
  assert.deepEqual(f.calls, [{ conversationId: 'original', projectId: 42, activeFileId: 99 }])
})

test('cancel, account switch and changed editor during connection prevent recovery', async () => {
  for (const change of ['cancel', 'account', 'editor', 'conversation']) {
    let live = true
    const f = fixture(async () => {
      if (change === 'cancel') live = false
      if (change === 'account') f.switchAccount()
      if (change === 'editor') f.activeDocChip.value = { id: 100 }
      if (change === 'conversation') f.currentConversationId.value = 'other'
      return true
    })
    assert.equal(await f.fn(99, () => live), false, change)
    assert.equal(f.calls.length, 0, change)
  }
})

test('targetless checkpoint remains targetless even when another tab is open', async () => {
  const f = fixture()
  f.pending[0].activeFileId = null
  assert.equal(await f.fn(null), true)
  assert.equal(f.calls[0].activeFileId, null)
})
