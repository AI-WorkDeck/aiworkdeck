// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
const store = new Map()
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
}
const BODY = '合成正文：甲方应履行付款义务。'
globalThis.Office = { context: { document: { url: 'file:///test/inline-retry.docx' } } }
globalThis.Word = {
  run: async cb => cb({ document: { body: { load() {}, text: BODY } }, sync: async () => {} })
}
const { activateSession, send, messages, stop, streaming } = await import('./chatSession.js')
const { postChat } = await import('./api.js')
const SETTINGS = { serverUrl: 'https://cloud.example', token: 'test-token' }
const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body })
const miss = { code: 'INLINE_CONTENT_CACHE_MISS', retryWithInlineContent: true }

function stream() {
  const queue = []
  let pending
  return {
    push(event, data) {
      const chunk = { done: false, value: new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
      if (pending) { const resolve = pending; pending = null; resolve(chunk) } else queue.push(chunk)
    },
    reader: { read: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { pending = resolve }) }
  }
}
async function until(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('SSE round did not finish')
}

for (const retrySucceeds of [true, false]) {
  test(`cache miss retries full snapshot once, success=${retrySucceeds}`, async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    let connection
    globalThis.fetch = async (url, options = {}) => {
      if (url.includes('/api/ai/history')) return json([])
      if (url.endsWith('/api/agent/conversations')) return json({ conversationId: `inline-${retrySucceeds}` })
      if (url.includes('/api/agent/connect/')) {
        connection = stream()
        return { ok: true, status: 200, body: { getReader: () => connection.reader } }
      }
      if (url.endsWith('/api/agent/chat')) {
        requests.push(JSON.parse(options.body))
        if (requests.length === 2 || (requests.length === 3 && !retrySucceeds)) return json(miss, 409)
        return json({ status: 'ok' })
      }
      if (url.includes('/api/agent/cancel/')) return json({})
      throw new Error('Unexpected request: ' + url)
    }
    try {
      await activateSession({ settings: SETTINGS, projectId: retrySucceeds ? '401' : '402' })
      await send('第一轮')
      connection.push('text_delta', { content: '<final>已读</final>' })
      connection.push('bubble_end', { status: 'finished' })
      await until(() => !streaming.value)
      await send('第二轮')
      assert.equal(requests.length, 3, 'initial full send, hash-only send, exactly one full resend')
      assert.equal(requests[0].activeContext.inlineContent, BODY)
      assert.equal(requests[1].activeContext.inlineContent, undefined)
      assert.equal(requests[2].activeContext.inlineContent, BODY)
      assert.equal(requests[2].activeContext.inlineContentHash, requests[1].activeContext.inlineContentHash)
      assert.equal(requests[2].conversationId, requests[1].conversationId)
      assert.ok(requests[1].clientRequestId)
      assert.equal(requests[2].clientRequestId, requests[1].clientRequestId)
      assert.notEqual(requests[0].clientRequestId, requests[1].clientRequestId)
      assert.equal(messages.value.filter(m => m.role === 'user' && m.text === '第二轮').length, 1)
      const last = messages.value.at(-1)
      assert.equal(Boolean(last.error), !retrySucceeds)
    } finally {
      await stop()
      globalThis.fetch = originalFetch
    }
  })
}

test('unrelated 409 and non-JSON HTTP failures do not acquire retry permission', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => json({ message: 'read only' }, 409)
    await assert.rejects(postChat(SETTINGS, {}), e => e.status === 409 && !e.retryWithInlineContent)
    globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new Error('HTML') } })
    await assert.rejects(postChat(SETTINGS, {}), e => e.status === 502 && !e.retryWithInlineContent)
  } finally { globalThis.fetch = originalFetch }
})

test('pending inbox snapshot loss resends an initial full-body request with the same key once', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/api/ai/history')) return json([])
    if (url.endsWith('/api/agent/conversations')) return json({ conversationId: 'inline-pending' })
    if (url.includes('/api/agent/connect/')) return { ok: true, status: 200, body: { getReader: () => stream().reader } }
    if (url.endsWith('/api/agent/chat')) {
      requests.push(JSON.parse(options.body))
      return requests.length === 1 ? json(miss, 409) : json({ status: 'ok' })
    }
    if (url.includes('/api/agent/cancel/')) return json({})
    throw new Error('Unexpected request: ' + url)
  }
  try {
    await activateSession({ settings: SETTINGS, projectId: '403' })
    await send('仅一次有效轮次')
    assert.equal(requests.length, 2)
    assert.equal(requests[0].activeContext.inlineContent, BODY)
    assert.deepEqual(requests[1], requests[0])
    assert.ok(requests[0].clientRequestId)
    assert.equal(messages.value.filter(m => m.role === 'user' && m.text === '仅一次有效轮次').length, 1)
    assert.equal(messages.value.at(-1).error, '')
  } finally {
    await stop()
    globalThis.fetch = originalFetch
  }
})
