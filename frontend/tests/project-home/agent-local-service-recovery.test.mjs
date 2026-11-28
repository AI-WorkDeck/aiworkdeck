// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C34 leftover (dev-board#1868, lane Q re-run 11-28): after the supervisor restarted a crashed backend, the
// live chat showed "[Connection lost]" and no Resume banner until a reload. The SSE reconnect had backed off
// to 30 s while the backend was down, so the run_state INTERRUPTED that brings the banner arrived late.
// When the local service comes back, the chat reconnects at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAgentStreamFactory } from '../_lib/agent-stream-factory.mjs'
import { watchLocalServiceRecovery } from '../../src/utils/localServiceRecovery.js'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('a local-service recovery cuts a long reconnect backoff short', async t => {
  const window = new EventTarget()
  const document = new EventTarget()
  document.visibilityState = 'visible'
  const timers = new Map()
  let nextTimer = 0
  const connections = []
  const unmounts = []
  const stream = buildAgentStreamFactory({
    window, document,
    console: { log() {}, warn() {}, error() {} },
    getCurrentInstance: () => ({}),
    onUnmounted: cb => unmounts.push(cb),
    setTimeout: (cb, delay) => { const id = ++nextTimer; timers.set(id, { cb, delay }); return id },
    clearTimeout: id => timers.delete(id),
    setInterval: () => ++nextTimer, clearInterval() {},
    fetch: async (url, { signal } = {}) => {
      if (!url.includes('/connect/')) return { ok: true, json: async () => [] }
      let controller
      const body = new ReadableStream({ start(c) { controller = c } })
      const conn = { closed: false, close() { if (!this.closed) { this.closed = true; controller.close() } } }
      signal.addEventListener('abort', () => conn.close(), { once: true })
      connections.push(conn)
      return { ok: true, body }
    },
  })
  t.after(async () => { unmounts.forEach(cb => cb()); await flush() })
  stream.setConversationId('chat')
  assert.equal(await stream.reattachSSE('chat'), true)
  // The backend dies; the stream ends and reconnects back off (several failed attempts while it is down).
  connections.forEach(c => c.close()); await flush()
  // While the backend was down the reconnect backed off; in production it sits at the 30 s cap by now.
  timers.clear(); timers.set(++nextTimer, { cb: async () => {}, delay: 30000 })
  const before = connections.length
  window.dispatchEvent(new Event('awd:local-service-recovered'))
  const quick = [...timers.values()].filter(item => item.delay <= 1000)
  assert.ok(quick.length >= 1, `a reconnect within 1 s is scheduled (timers: ${[...timers.values()].map(i => i.delay)})`)
  for (const item of quick) await item.cb()
  await flush()
  assert.equal(connections.length, before + 1, 'reconnected right after the service came back')
})

test('watchLocalServiceRecovery fires once per down → healthy, not on every healthy snapshot', async () => {
  let push
  const backend = { onHealthChanged: (cb) => { push = cb; return () => { push = null } } }
  let fired = 0
  const stop = watchLocalServiceRecovery(backend, () => fired++)
  push({ state: 'healthy', ok: true })
  assert.equal(fired, 0, 'healthy at start is not a recovery')
  for (const state of ['degraded', 'restarting', 'starting']) push({ state, ok: false })
  push({ state: 'healthy', ok: true })
  push({ state: 'healthy', ok: true })
  assert.equal(fired, 1)
  stop()
  assert.equal(push, null, 'unsubscribes')
  assert.doesNotThrow(() => watchLocalServiceRecovery(undefined, () => {})(), 'web edition: no host backend, no-op')
})

test('the chat panel wires the desktop health signal to the recovery event', () => {
  const src = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
  assert.match(src, /watchLocalServiceRecovery\(host\.backend,/)
  assert.match(src, /dispatchEvent\(new Event\('awd:local-service-recovered'\)\)/)
})
