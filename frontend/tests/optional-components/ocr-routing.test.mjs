// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOcrRoutingHandler } from '../../src/composables/useOcrRouting.js'

function fixture() {
  const data = { conversation: 'conv', identity: 'user1', count: 1, streaming: false, state: null, posts: [], sent: [], cancelled: [] }
  const handler = createOcrRoutingHandler({
    conversation: () => data.conversation, identity: () => data.identity, userCount: () => data.count,
    streaming: () => data.streaming, lastUserMessage: () => '转换合成扫描件',
    onState: state => { data.state = state },
    choose: async body => { data.posts.push(body); if (data.post) await data.post() },
    captureCancel: () => { const identity = data.identity; return async body => { data.cancelled.push({ ...body, identity }); if (data.cancelPost) await data.cancelPost() } },
    resend: async text => { data.sent.push(text) },
  })
  handler.onAction({ conversationId: 'conv', decisionId: 'server-nonce', version: 'v1', localAvailable: true })
  return { data, handler }
}
test('no selection and cancellation never authorize or resume', async () => {
  const { data, handler } = fixture()
  handler.cancel(); await handler.choose('cloud', true)
  assert.equal(data.posts.length, 0); assert.equal(data.sent.length, 0)
})
test('explicit cloud choice sends server nonce and resumes original message exactly once', async () => {
  const { data, handler } = fixture()
  await handler.choose('cloud', true); await handler.choose('cloud', true)
  assert.deepEqual(data.posts, [{ conversationId: 'conv', decisionId: 'server-nonce', version: 'v1', choice: 'cloud', remember: true }])
  assert.deepEqual(data.sent, ['转换合成扫描件'])
})
test('local selection waits for current turn before automatically continuing into existing component flow', async () => {
  const { data, handler } = fixture(); data.streaming = true
  await handler.choose('local', false)
  assert.equal(data.sent.length, 0); assert.equal(data.state.phase, 'ready')
  data.streaming = false; await handler.continueReady(); await handler.continueReady()
  assert.deepEqual(data.sent, ['转换合成扫描件'])
})
test('late choice response never resumes another account or conversation', async () => {
  for (const key of ['conversation', 'identity', 'count']) {
    const { data, handler } = fixture()
    let done; data.post = () => new Promise(resolve => { done = resolve })
    const choosing = handler.choose('cloud', false)
    data[key] = key === 'count' ? 2 : 'changed'
    done(); await choosing
    assert.equal(data.sent.length, 0)
  }
})
test('cancel during request and stale decision errors leave no automatic retry loop', async () => {
  const { data, handler } = fixture()
  let done; data.post = () => new Promise(resolve => { done = resolve })
  const choosing = handler.choose('cloud', false); handler.cancel(); done(); await choosing
  assert.equal(data.sent.length, 0); assert.equal(data.state, null)
  const second = fixture(); second.data.post = () => { throw new Error('选择已过期') }
  await second.handler.choose('cloud')
  assert.equal(second.data.state.error, '选择已过期'); assert.equal(second.data.posts.length, 1)
  assert.equal(second.data.sent.length, 0)
})
test('unavailable local runtime cannot enter a same-version install loop', async () => {
  const { data, handler } = fixture()
  handler.onAction({ conversationId: 'conv', decisionId: 'old-runtime', localAvailable: false })
  await handler.choose('local')
  assert.equal(data.posts.length, 0)
})


test('cancel during save revokes the server nonce in both request arrival orders', async () => {
  const { data, handler } = fixture()
  let done; data.post = () => new Promise(resolve => { done = resolve })
  const saving = handler.choose('cloud')
  await handler.cancel()
  data.identity = 'user2'
  done(); await saving
  assert.equal(data.sent.length, 0)
  assert.equal(data.cancelled.length, 2)
  assert.ok(data.cancelled.every(c => c.decisionId === 'server-nonce' && c.identity === 'user1'))
})
test('successful handoff does not cancel authorization and duplicate action does not revoke it', async () => {
  const { data, handler } = fixture()
  handler.onAction({ conversationId: 'conv', decisionId: 'server-nonce', version: 'v1', localAvailable: true })
  await handler.choose('cloud')
  assert.equal(data.cancelled.length, 0)
  assert.equal(data.sent.length, 1)
})
test('failed cancellation is visible and can be retried without resuming', async () => {
  const { data, handler } = fixture()
  data.cancelPost = () => { throw new Error('network down') }
  await handler.cancel()
  assert.equal(data.state.phase, 'cancelFailed')
  assert.match(data.state.error, /取消尚未确认/)
  data.cancelPost = null
  await handler.cancel()
  assert.equal(data.state, null)
  assert.equal(data.sent.length, 0)
})
