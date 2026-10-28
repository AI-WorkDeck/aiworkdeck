// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const start = source.indexOf('    async confirmDeleteConversation(chat) {')
const end = source.indexOf('\n    },', start)
const method = source.slice(start, end + 6).trim().replace(/,$/, '')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture({ host = null, active = 'deleted', remove = async () => {}, refresh = async () => {} } = {}) {
  const panel = { currentConversationId: active, bubbles: ['old message'], startNewChat() { this.currentConversationId = null; this.bubbles = [] } }
  const state = {
    currentConversationId: host, $refs: { chatInterface: panel }, historyActionBusy: false,
    $t: key => key, fetchChatHistory: refresh,
    startNewChat() { this.currentConversationId = null },
  }
  const run = new Function('uni', 'deleteAiConversation', `return ({${method}}).confirmDeleteConversation`)(
    { showModal: options => options.success({ confirm: true }), showToast() {} }, remove)
  return { state, panel, run: () => run.call(state, { conversationId: 'deleted' }) }
}

test('new conversation held only by ChatInterface is cleared immediately on delete', async () => {
  const refresh = deferred()
  const f = fixture({ refresh: () => refresh.promise })
  const running = f.run()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.panel.bubbles, [])
  assert.equal(f.panel.currentConversationId, null)
  assert.equal(f.state.currentConversationId, null)
  refresh.resolve()
  await running
})

test('deleting another conversation preserves currently displayed messages', async () => {
  const f = fixture({ active: 'other' })
  await f.run()
  assert.deepEqual(f.panel.bubbles, ['old message'])
  assert.equal(f.panel.currentConversationId, 'other')
})

test('switch while delete request is pending preserves newly selected conversation', async () => {
  const remove = deferred()
  const f = fixture({ host: 'deleted', remove: () => remove.promise })
  const running = f.run()
  await new Promise(resolve => setImmediate(resolve))
  f.panel.currentConversationId = 'other'
  f.state.currentConversationId = 'other'
  remove.resolve()
  await running
  assert.equal(f.panel.currentConversationId, 'other')
  assert.deepEqual(f.panel.bubbles, ['old message'])
})

test('switch during list refresh is not cleared by late completion', async () => {
  const refresh = deferred()
  const f = fixture({ host: 'deleted', refresh: () => refresh.promise })
  const running = f.run()
  await new Promise(resolve => setImmediate(resolve))
  f.panel.currentConversationId = 'other'
  f.panel.bubbles = ['new message']
  f.state.currentConversationId = 'other'
  refresh.resolve()
  await running
  assert.deepEqual(f.panel.bubbles, ['new message'])
  assert.equal(f.state.currentConversationId, 'other')
})

test('delete failure keeps the conversation intact', async () => {
  const f = fixture({ remove: async () => { throw new Error('failure') } })
  await f.run()
  assert.deepEqual(f.panel.bubbles, ['old message'])
  assert.equal(f.panel.currentConversationId, 'deleted')
  assert.equal(f.state.historyActionBusy, false)
})

test('blank new chat is authoritative even when the host still holds the deleted ID', async () => {
  const f = fixture({ host: 'deleted', active: null })
  f.panel.bubbles = ['unsent draft sentinel']
  await f.run()
  assert.deepEqual(f.panel.bubbles, ['unsent draft sentinel'])
})

test('legacy host without ChatInterface clears its selected conversation', async () => {
  const f = fixture({ host: 'deleted' })
  delete f.state.$refs.chatInterface
  await f.run()
  assert.equal(f.state.currentConversationId, null)
})
