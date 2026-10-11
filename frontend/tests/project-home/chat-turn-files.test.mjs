// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'
import { fileChangesForBubble, summarizeFileChanges } from '../../src/utils/chatFileChange.js'
import { isInternalToolOutput } from '../../src/utils/toolOutputHumanize.js'

const change = { fileName: '合同.docx', fileId: 42, projectId: 9, changeType: 'ADDED' }
test('confirmed SSE changes attach to their assistant and are deduplicated; a later turn cannot steal them', () => {
  const s = buildAgentStreamFactory({ expose: 'handleEvent, createAssistantBubble, currentAssistantBubble' })
  test.after(() => s.resetSSE())
  const first = s.createAssistantBubble()
  s.bubbles.value.push(first)
  s.currentAssistantBubble.value = first
  for (const c of [change, change, { ...change, changeType: 'MODIFIED' }, { ...change, fileId: 43, success: false }]) {
    s.handleEvent('file_change', JSON.stringify(c))
  }
  const next = s.createAssistantBubble()
  s.bubbles.value.push(next)
  s.currentAssistantBubble.value = next
  assert.deepEqual(fileChangesForBubble(first), [change])
  assert.deepEqual(fileChangesForBubble(next), [])
})
test('history attaches real identities to the persisted message, never legacy unbound records or same-name siblings', () => {
  const metadata = [{ ...change, assistantMessageId: 5 }, { ...change, fileId: 43, assistantMessageId: 6 },
    { fileName: '旧文件.docx', changeType: 'MODIFIED' }]
  assert.equal(fileChangesForBubble({ id: '5' }, metadata)[0].fileId, 42)
  assert.equal(fileChangesForBubble({ id: 6 }, metadata)[0].fileId, 43)
  assert.deepEqual(fileChangesForBubble({ id: 7 }, metadata), [])
  assert.equal(summarizeFileChanges(metadata).length, 3)
})
test('only internal instruction tools hide output; legal evidence, failures and user code answers remain data', () => {
  for (const code of ['litigation_reference("schema")', 'list_tools({})', 'use_skill({})']) assert.equal(isInternalToolOutput({ code }), true)
  for (const code of ['read_file({})', 'read_document({})', 'law_search({})', 'run_python({})']) assert.equal(isInternalToolOutput({ code }), false)
  const s = buildAgentStreamFactory()
  const body = '下面是你要的代码：\n```json\n{"schema_version":1}\n```'
  assert.equal(s.parseAssistantHistory(body).content, body)
})

test('late file effects target the originating request and never the next assistant or another conversation', () => {
  const s = buildAgentStreamFactory({ expose: 'handleEvent, createAssistantBubble, currentAssistantBubble' })
  test.after(() => s.resetSSE())
  s.currentConversationId.value = 'conv-current'
  const first = { ...s.createAssistantBubble(), originClientRequestId: 'first-request' }
  const next = { ...s.createAssistantBubble(), originClientRequestId: 'next-request' }
  s.bubbles.value.push(first, next)
  s.currentAssistantBubble.value = next
  for (const override of [{}, { clientRequestId: 'unknown-old-request' }, { conversationId: 'other-conversation' }]) {
    s.handleEvent('file_change', JSON.stringify({ ...change, clientRequestId: 'first-request', conversationId: 'conv-current', ...override }))
  }
  assert.deepEqual(fileChangesForBubble(first), [change])
  assert.deepEqual(fileChangesForBubble(next), [])
})
test('metadata response arriving after switching conversations cannot restore another conversation files', async () => {
  let finish
  const s = buildAgentStreamFactory({ getConversationMetadata: () => new Promise(resolve => { finish = resolve }) })
  s.currentConversationId.value = 'old'
  const pending = s.loadConversationMetadata('old')
  s.setConversationId('new')
  finish({ fileChanges: [change] })
  await pending
  assert.deepEqual(s.fileChanges.value, [])
})
