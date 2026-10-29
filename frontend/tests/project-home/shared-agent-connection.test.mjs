// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAgentConnection } from '../../src/composables/sharedAgentConnection.mjs'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'
const tick = () => new Promise(resolve => setImmediate(resolve))
const encode = text => new TextEncoder().encode(text)

test('background generation and opened chat share emitter ownership, late chat restores partial output and both observe completion', async () => {
  let source, requests = 0, signal
  const original = globalThis.fetch
  const oldStorage = globalThis.sessionStorage
  globalThis.sessionStorage = { getItem: () => 'same-window' }
  globalThis.fetch = async (_url, init) => {
    if (!_url.includes('/connect/')) return { ok: true, json: async () => [] }
    requests++
    signal = init.signal
    const body = new ReadableStream({ start(c) { source = c } })
    const captured = source
    init.signal.addEventListener('abort', () => { try { captured.close() } catch {} }, { once: true })
    return { ok: true, status: 200, body }
  }
  const background = buildAgentStreamFactory()
  const chat = buildAgentStreamFactory()
  try {
    background.setConversationId('diagram')
    assert.equal(await background.reattachSSE('diagram'), true)
    source.enqueue(encode('id: 1\nevent: state_recovery\ndata: {"content":"<final>已有正文"}\n\n'))
    await tick()
    chat.setConversationId('diagram')
    assert.equal(await chat.reattachSSE('diagram'), true)
    assert.equal(requests, 2)
    source.enqueue(encode('id: 2\nevent: state_recovery\ndata: {"content":"<final>已有正文"}\n\n'))
    await tick()
    assert.equal(chat.bubbles.value.at(-1).content, background.bubbles.value.at(-1).content)
    assert.match(chat.bubbles.value.at(-1).content, /已有正文/)
    source.enqueue(encode('id: 3\nevent: bubble_end\ndata: {"status":"finished"}\n\n'))
    await tick()
    for (const stream of [background, chat]) {
      assert.equal(stream.agentRunStatus.value, 'FINISHED')
      assert.equal(stream.isStreaming.value, false)
      assert.equal(stream.linkStatus.value.state, 'live')
    }
    chat.resetSSE()
    assert.equal(signal.aborted, false)
    background.resetSSE()
    assert.equal(signal.aborted, true)
  } finally {
    chat.resetSSE(); background.resetSSE()
    globalThis.fetch = original
    globalThis.sessionStorage = oldStorage
  }
})

test('new reader rotates once with the delivered cursor; frames and failures reach all readers', async () => {
  let source, requests = 0
  const original = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    requests++
    if (requests === 2) assert.equal(new Headers(init.headers).get('Last-Event-ID'), '1')
    const body = new ReadableStream({ start(c) { source = c } })
    const captured = source
    init.signal.addEventListener('abort', () => { try { captured.close() } catch {} }, { once: true })
    return { ok: true, status: 200, body }
  }
  const a = new AbortController(), b = new AbortController()
  const open = controller => fetchAgentConnection('/frames', {
    signal: controller.signal, headers: { 'X-Client-Instance': 'one' },
  })
  try {
    const ra = (await open(a)).body.getReader()
    source.enqueue(encode('id: 1\ndata: first\n\n'))
    await ra.read()
    const rb = (await open(b)).body.getReader()
    source.enqueue(encode('id: 2\ndata: '))
    await tick()
    source.enqueue(encode('中文\n\n'))
    const expected = 'id: 2\ndata: 中文\n\n'
    assert.equal(new TextDecoder().decode((await ra.read()).value), expected)
    assert.equal(new TextDecoder().decode((await rb.read()).value), expected)
    assert.equal(requests, 2)
    source.error(new Error('network lost'))
    await assert.rejects(ra.read(), /network lost/)
    await assert.rejects(rb.read(), /network lost/)
  } finally {
    a.abort(); b.abort(); globalThis.fetch = original
  }
})
