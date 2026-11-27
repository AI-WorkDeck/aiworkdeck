// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X39: "Continue" a cut-off answer, end to end through the real composable (fetch / SSE stubbed):
// a long answer breaks with a stream error, Continue sends continueTurn, creates no new bubble,
// and the continuation is appended to the same bubble with the seam text exactly once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'
import { continueDecision } from '../../src/utils/continueDecision.js'

/** 一条可控的 SSE 响应体：push 一段原文、end 正常收尾（服务端关流）、fail 异常断开。 */
function controllableBody() {
  const encoder = new TextEncoder()
  const queue = []
  let waiter = null
  const settle = (item) => {
    if (waiter) { const w = waiter; waiter = null; w(item) } else queue.push(item)
  }
  return {
    body: {
      getReader: () => ({
        read: () => new Promise((resolve, reject) => {
          const deliver = (item) => (item.error ? reject(item.error) : resolve(item.chunk))
          if (queue.length) deliver(queue.shift())
          else waiter = deliver
        }),
      }),
    },
    push: (text) => settle({ chunk: { value: encoder.encode(text), done: false } }),
    end: () => settle({ chunk: { value: undefined, done: true } }),
    fail: (error) => settle({ error }),
  }
}

let seq = 0
const sse = (event, data) => `id:${++seq}\nevent:${event}\ndata:${data}\n\n`

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    await nextTick()
  }
}

function harness() {
  const listeners = { window: {}, document: {} }
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => { listeners.document[name] = fn },
  }
  const fakeWindow = { addEventListener: (name, fn) => { listeners.window[name] = fn } }
  globalThis.window = fakeWindow
  globalThis.document = fakeDocument

  const streams = []
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null })
    if (String(url).includes('/api/agent/connect/')) {
      const s = controllableBody()
      streams.push(s)
      return { ok: true, status: 200, body: s.body }
    }
    if (String(url).includes('/api/agent/chat')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { status: 'accepted', messageId: 'm-1', state: 'applied', submissionMode: 'steer' } }),
      }
    }
    if (String(url).includes('/api/agent/cancel/')) {
      return { ok: true, status: 200, json: async () => ({ cancelled: true }) }
    }
    // /api/agent/tasks/active 等恢复性补拉
    return { ok: true, status: 200, json: async () => [] }
  }

  const s = buildAgentStreamFactory()

  const connects = () => calls.filter((c) => c.url.includes('/api/agent/connect/')).length
  const becomeVisible = () => {
    fakeDocument.visibilityState = 'visible'
    listeners.document.visibilitychange && listeners.document.visibilitychange()
  }
  const goOnline = () => listeners.window.online && listeners.window.online()
  // 收尾：清掉重连定时器与心跳，node:test 不留挂起的 timer
  const dispose = () => s.resetSSE()
  return { s, streams, calls, connects, becomeVisible, goOnline, dispose }
}


const PART = '第一段：合同第四条约定违约金为总价的百分之五十，明显过高。'.repeat(9) + '第二段写到一半，'
const TAIL = '这一句是续写出来的结尾。'

test('Continue appends into the same bubble without duplicating the seam', async () => {
  const h = harness()
  try {
    const pending = h.s.sendMessage({ prompt: '写一份风险提示', projectId: 1 })
    await flush(); await pending
    const first = h.streams[0]
    first.push(sse('bubble_start', '{}'))
    first.push(sse('text_delta', JSON.stringify({ content: '<final>' + PART })))
    await flush()
    first.push(sse('error', 'Stream Error: SSE Connection Failed: 502'))
    first.end()
    await flush()
    const bubbles = h.s.bubbles.value
    const answer = bubbles[bubbles.length - 1]
    assert.equal(answer.role, 'ASSISTANT')
    assert.equal(answer.errorNotice && answer.errorNotice.key, 'streamInterrupted')
    assert.equal(answer.toolInFlightAtCut, false)
    assert.equal(continueDecision({ errorKey: answer.errorNotice.key, partialText: answer.content }).offerContinue, true,
      'a long cut-off answer offers Continue')
    const countBefore = bubbles.length

    const resumed = h.s.sendMessage({ prompt: 'continue', projectId: 1, continueBubble: answer })
    await flush(); await resumed
    const chat = h.calls.filter((c) => c.url.includes('/api/agent/chat'))
    assert.equal(chat.at(-1).body.continueTurn, true, 'the request asks the backend to continue')
    assert.equal(h.s.bubbles.value.length, countBefore, 'no new user or assistant bubble')
    assert.equal(answer.errorNotice, null, 'the error line gives way to the streaming state')
    assert.equal(answer.isStreaming, true)

    const second = h.streams.at(-1)
    second.push(sse('bubble_start', '{}'))
    second.push(sse('text_delta', JSON.stringify({ content: '<final>' + TAIL + '</final>' })))
    second.push(sse('bubble_end', JSON.stringify({ status: 'finished' })))
    second.end()
    await flush()
    assert.ok(answer.content.includes(PART) && answer.content.includes(TAIL), answer.content)
    assert.ok(answer.content.indexOf(PART) < answer.content.indexOf(TAIL), 'continuation comes after the cut')
    const seam = '第二段写到一半，'
    assert.equal(answer.content.split(seam).length - 1, 1, 'seam text appears once')
    assert.ok(answer.content.includes(seam + TAIL), 'the continuation joins the cut sentence with no paragraph break')
    assert.equal(answer.failedContinues, 0)
  } finally { h.dispose() }
})

test('a continuation that breaks again is counted; the second failure stops offering Continue', async () => {
  const h = harness()
  try {
    const pending = h.s.sendMessage({ prompt: '写一份风险提示', projectId: 1 })
    await flush(); await pending
    const s0 = h.streams[0]
    s0.push(sse('text_delta', JSON.stringify({ content: '<final>' + PART })))
    s0.push(sse('error', 'Stream Error: SSE Connection Failed: 502')); s0.end(); await flush()
    const answer = h.s.bubbles.value.at(-1)
    for (let i = 1; i <= 2; i++) {
      const p = h.s.sendMessage({ prompt: 'continue', projectId: 1, continueBubble: answer })
      await flush(); await p
      const s = h.streams.at(-1)
      s.push(sse('text_delta', JSON.stringify({ content: '再写几个字' })))
      s.push(sse('error', 'Stream Error: SSE Connection Failed: 502')); s.end(); await flush()
      assert.equal(answer.failedContinues, i)
    }
    const d = continueDecision({ errorKey: answer.errorNotice.key, partialText: answer.content, failedContinues: answer.failedContinues })
    assert.deepEqual(d, { offerContinue: false, messageKey: 'streamInterruptedTwice' })
  } finally { h.dispose() }
})
