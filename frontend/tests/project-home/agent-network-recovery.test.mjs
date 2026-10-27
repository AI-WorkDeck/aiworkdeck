// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))

function harness(t, delayedConversation = null) {
  const window = new EventTarget()
  const document = new EventTarget()
  document.visibilityState = 'visible'
  const timers = new Map()
  const connections = []
  const unmounts = []
  let releaseHeaders
  let nextTimer = 0
  const createTimer = (callback, delay) => {
    const id = ++nextTimer
    timers.set(id, { callback, delay })
    return id
  }
  const first = buildAgentStreamFactory({
    // All instances must share ONE evaluated module, otherwise its singleton
    // cannot collide and the original defect would pass this test.
    expose: 'createAnother: useAgentStream',
    window, document,
    console: { log() {}, warn() {}, error() {} },
    getCurrentInstance: () => ({}),
    onUnmounted: callback => unmounts.push(callback),
    setTimeout: createTimer,
    clearTimeout: id => timers.delete(id),
    setInterval: () => ++nextTimer,
    clearInterval() {},
    fetch: async (url, { signal } = {}) => {
      if (!url.includes('/connect/')) return { ok: true, json: async () => [] }
      let controller
      const body = new ReadableStream({ start(value) { controller = value } })
      const connection = { id: url.split('/').at(-1), closed: false, close() {
        if (!this.closed) { this.closed = true; controller.close() }
      } }
      signal.addEventListener('abort', () => connection.close(), { once: true })
      connections.push(connection)
      // Deliberately ignore fetch's abort while headers are in flight, to model
      // an already resolved response whose continuation races with resetSSE.
      if (connection.id === delayedConversation) await new Promise(resolve => { releaseHeaders = resolve })
      return { ok: true, body }
    },
  })
  const second = first.createAnother()
  t.after(async () => { unmounts.forEach(callback => callback()); await flush() })
  const connect = async (stream, id) => {
    stream.setConversationId(id)
    assert.equal(await stream.reattachSSE(id), true)
  }
  const disconnect = async () => { connections.forEach(connection => connection.close()); await flush() }
  const recover = async type => {
    if (type === 'online') window.dispatchEvent(new Event('online'))
    else document.dispatchEvent(new Event('visibilitychange'))
    const scheduled = [...timers.entries()].filter(([, item]) => item.delay < 15000)
    for (const [id, item] of scheduled) { timers.delete(id); await item.callback() }
    await flush()
  }
  const count = id => connections.filter(connection => connection.id === id).length
  return { first, second, connect, disconnect, recover, count, unmounts, document, releaseHeaders: () => releaseHeaders() }
}

test('network and foreground recovery reconnect both the chat and the separate drawing stream', async t => {
  const h = harness(t)
  await h.connect(h.first, 'chat')
  await h.connect(h.second, 'drawing')
  await h.disconnect()
  await h.recover('online')
  assert.equal(h.count('chat'), 2)
  assert.equal(h.count('drawing'), 2)
  await h.disconnect()
  h.document.visibilityState = 'hidden'
  await h.recover('visibilitychange')
  assert.equal(h.count('chat'), 2)
  assert.equal(h.count('drawing'), 2)
  h.document.visibilityState = 'visible'
  await h.recover('visibilitychange')
  assert.equal(h.count('chat'), 3)
  assert.equal(h.count('drawing'), 3)
})

test('unmounting the most recently connected stream preserves the other stream recovery', async t => {
  const h = harness(t)
  await h.connect(h.first, 'chat')
  await h.connect(h.second, 'drawing')
  h.unmounts[1]()
  await h.disconnect()
  await h.recover('online')
  assert.equal(h.count('chat'), 2)
  assert.equal(h.count('drawing'), 1)
})

test('resetting one stream detaches it without affecting another instance', async t => {
  const h = harness(t)
  await h.connect(h.first, 'chat')
  await h.connect(h.second, 'drawing')
  h.second.resetSSE()
  await h.disconnect()
  await h.recover('online')
  assert.equal(h.count('chat'), 2)
  assert.equal(h.count('drawing'), 1, 'explicit reset must not reconnect the old conversation')
})

test('switching a drawing conversation replaces its recovery registration without duplicates', async t => {
  const h = harness(t)
  await h.connect(h.first, 'chat')
  await h.connect(h.second, 'drawing-old')
  await h.connect(h.second, 'drawing-new')
  await h.disconnect()
  await h.recover('online')
  assert.equal(h.count('chat'), 2)
  assert.equal(h.count('drawing-old'), 1)
  assert.equal(h.count('drawing-new'), 2)
  await h.recover('online')
  assert.equal(h.count('drawing-new'), 2, 'an already connected instance must not open another connection')
})

test('a reset during connection setup cannot resurrect its recovery callback when headers arrive late', async t => {
  const h = harness(t, 'drawing')
  await h.connect(h.first, 'chat')
  h.second.setConversationId('drawing')
  const connecting = h.second.reattachSSE('drawing')
  h.second.resetSSE()
  h.releaseHeaders()
  assert.equal(await connecting, false)
  await h.disconnect()
  await h.recover('online')
  assert.equal(h.count('chat'), 2)
  assert.equal(h.count('drawing'), 1)
})
