// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { subscribeProjectFileChanges } from '../../src/utils/projectFileChanges.js'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function harness(t, { status = 200, onChange } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const calls = []
  let refreshes = 0, session = 'first'
  const stop = subscribeProjectFileChanges(7, {
    url: '/api/projects/7/files/changes',
    getHeaders: () => ({ 'X-Session-Id': session }),
    onChange: onChange || (() => { refreshes++ }),
    fetchImpl: async (url, options) => {
      const call = { url, options, cancelled: false }
      calls.push(call)
      const body = new ReadableStream({
        start(controller) {
          call.send = text => controller.enqueue(new TextEncoder().encode(text))
          call.end = () => controller.close()
          options.signal.addEventListener('abort', () => {
            call.cancelled = true
            try { controller.error(new Error('aborted')) } catch (_) {}
          })
        },
        cancel() { call.cancelled = true },
      })
      return new Response(body, { status })
    },
  })
  t.after(stop)
  return { calls, stop, refreshes: () => refreshes, session: value => { session = value } }
}

test('ready and committed changes refresh; split frames, ping and other projects do not', async t => {
  const h = harness(t)
  await flush()
  assert.equal(h.calls[0].options.headers['X-Session-Id'], 'first')
  h.calls[0].send('event:rea')
  h.calls[0].send('dy\r\ndata: {"projectId":7}\r\n\r\n')
  await flush()
  assert.equal(h.refreshes(), 1)
  h.calls[0].send('event:ping\ndata:{"projectId":7}\n\nevent:files_changed\ndata:{"projectId":8}\n\n')
  await flush()
  assert.equal(h.refreshes(), 1)
  h.calls[0].send('event:files_changed\ndata:{"projectId":7}\n\n')
  await flush()
  assert.equal(h.refreshes(), 2)
})

test('EOF reconnects with current auth; ready catches changes missed while disconnected', async t => {
  const h = harness(t)
  await flush()
  h.calls[0].end()
  await flush()
  h.session('renewed')
  t.mock.timers.tick(999)
  await flush()
  assert.equal(h.calls.length, 1)
  t.mock.timers.tick(1)
  await flush()
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].options.headers['X-Session-Id'], 'renewed')
  h.calls[1].send('event:ready\ndata:{"projectId":7}\n\n')
  await flush()
  assert.equal(h.refreshes(), 1)
})

test('short lived ready connections retain exponential reconnect backoff', async t => {
  const h = harness(t)
  await flush()
  h.calls[0].end()
  await flush()
  t.mock.timers.tick(1000)
  await flush()
  h.calls[1].send('event:ready\ndata:{"projectId":7}\n\n')
  h.calls[1].end()
  await flush()
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(h.calls.length, 2)
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(h.calls.length, 3)
})

test('stopping on project switch cancels stream and suppresses queued events and reconnects', async t => {
  const h = harness(t)
  await flush()
  h.calls[0].send('event:files_changed\ndata:{"projectId":7}\n\n')
  h.stop()
  await flush()
  assert.equal(h.calls[0].cancelled, true)
  assert.equal(h.refreshes(), 0)
  t.mock.timers.tick(120000)
  await flush()
  assert.equal(h.calls.length, 1)
})

for (const status of [401, 403, 404]) {
  test(`HTTP ${status} stops instead of reconnecting forever`, async t => {
    const h = harness(t, { status })
    await flush()
    t.mock.timers.tick(120000)
    await flush()
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].cancelled, true)
    assert.equal(h.refreshes(), 0)
  })
}

test('missing heartbeat cancels a stalled connection and reconnects without polling files', async t => {
  const h = harness(t)
  await flush()
  t.mock.timers.tick(45000)
  await flush()
  assert.equal(h.calls[0].cancelled, true)
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(h.calls.length, 2)
  assert.equal(h.refreshes(), 0)
})

test('a server error closes its response body and retries the event stream', async t => {
  const h = harness(t, { status: 503 })
  await flush()
  assert.equal(h.calls[0].cancelled, true)
  t.mock.timers.tick(1000)
  await flush()
  assert.equal(h.calls.length, 2)
  assert.equal(h.refreshes(), 0)
})

test('a response arriving after unmount is cancelled without delivering its ready event', async t => {
  let resolveResponse, cancelled = false, refreshed = false
  const response = new Promise(resolve => { resolveResponse = resolve })
  const stop = subscribeProjectFileChanges(7, {
    url: '/synthetic', fetchImpl: () => response, onChange: () => { refreshed = true },
  })
  stop()
  resolveResponse(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('event:ready\ndata:{"projectId":7}\n\n')) },
    cancel() { cancelled = true },
  })))
  await flush()
  assert.equal(cancelled, true)
  assert.equal(refreshed, false)
})
