// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MessageChannel } from 'node:worker_threads'
import vm from 'node:vm'
const source = await readFile(new URL('../awd-plugin-sdk.js', import.meta.url), 'utf8')

function harness(t) {
  const { port1, port2 } = new MessageChannel()
  const sent = [], timers = new Map()
  let listener, timerId = 0
  const parent = { postMessage: msg => port1.postMessage(msg) }
  const window = { parent, addEventListener: (type, cb) => { if (type === 'message') listener = cb } }
  port1.on('message', data => listener({ source: parent, data }))
  port2.on('message', msg => sent.push(msg))
  vm.runInNewContext(source, { window, setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id) })
  t.after(() => { port1.close(); port2.close() })
  const response = (msg, result = {}, error) => port2.postMessage({ awd: 1, type: 'result', seq: msg.seq, ok: !error, result, error })
  const next = () => new Promise(resolve => port2.once('message', resolve))
  return { awd: window.awd, sent, timers, response, next, spoof: data => listener({ source: {}, data }) }
}

test('new APIs round-trip actual structured messages with no signal/secret crossing bridge', async t => {
  const h = harness(t)
  const cases = [
    [() => h.awd.ui.openWorkspace(), 'ui.openWorkspace', {}],
    [() => h.awd.services.request('search', 'query', { query: 'demo' }, { requestId: 'request-one' }), 'services.request', { service: 'search', operation: 'query', params: { query: 'demo' }, requestId: 'request-one' }],
    [() => h.awd.services.cancel({ requestId: 'request-one' }), 'services.cancel', { requestId: 'request-one' }],
    [() => h.awd.mcp.servers(), 'mcp.servers', {}],
    [() => h.awd.mcp.call('server', 'tool', { a: 1 }), 'mcp.call', { serverId: 'server', name: 'tool', arguments: { a: 1 } }],
    [() => h.awd.connections.list(), 'connections.list', {}],
    [() => h.awd.connections.connect('provider'), 'connections.connect', { id: 'provider' }],
    [() => h.awd.connections.disconnect('provider'), 'connections.disconnect', { id: 'provider' }],
    [() => h.awd.connections.request('provider', 'query', { input: 'hello' }), 'connections.request', { id: 'provider', operation: 'query', params: { input: 'hello' } }],
    [() => h.awd.billing.status('provider'), 'billing.status', { connectionId: 'provider' }],
    [() => h.awd.billing.checkout('provider'), 'billing.checkout', { connectionId: 'provider' }],
    [() => h.awd.settings.open(), 'settings.open', {}],
    [() => h.awd.settings.update({ greeting: 'hi' }, { scope: 'project', projectId: 7 }), 'settings.update', { values: { greeting: 'hi' }, scope: 'project', projectId: 7 }]
  ]
  for (const [invoke, method, params] of cases) {
    const next = h.next(), promise = invoke(), message = await next
    assert.equal(message.awd, 1); assert.equal(message.method, method); assert.deepEqual(message.params, params)
    h.response(message, { accepted: method })
    assert.deepEqual(await promise, { accepted: method })
    assert.equal(h.timers.size, 0)
  }
})

test('abort rejects, cancels service once and ignores late success', async t => {
  const h = harness(t), controller = new AbortController()
  const next = h.next(), promise = h.awd.services.request('search', 'query', {}, { signal: controller.signal, requestId: 'abort-me' })
  const message = await next
  const rejected = assert.rejects(promise, error => error.code === 'aborted' && error.name === 'AbortError')
  const cancellation = h.next()
  controller.abort()
  await rejected
  const cancel = await cancellation
  assert.equal(cancel.method, 'services.cancel'); assert.equal(cancel.params.requestId, 'abort-me')
  h.response(message, { shouldNeverResolve: true }); h.response(cancel)
  const nextCall = h.next(), valid = h.awd.files.read('notes.txt')
  const validMessage = await nextCall
  h.response(validMessage, { path: 'notes.txt', content: 'ok', truncated: false })
  assert.equal((await valid).content, 'ok')
  assert.equal(h.timers.size, 0)
})

test('timeout discards late reply; old host error is preserved instead of fake success', async t => {
  const h = harness(t)
  const next = h.next(), promise = h.awd.settings.open({ timeoutMs: 5 })
  const message = await next
  const rejected = assert.rejects(promise, error => error.code === 'timeout')
  const expire = [...h.timers.values()][0]; expire(); await rejected
  h.response(message, { opened: true })
  const next2 = h.next(), unsupported = h.awd.connections.list()
  const message2 = await next2
  h.spoof({ awd: 1, type: 'result', seq: message2.seq, ok: true, result: 'spoofed' })
  h.response(message2, null, { code: 'unknown_method', message: 'upgrade host' })
  await assert.rejects(unsupported, error => error.code === 'unknown_method')
  assert.equal(h.timers.size, 0)
})

test('pre-aborted calls and invalid timeouts send nothing', async t => {
  const h = harness(t), controller = new AbortController(); controller.abort()
  await assert.rejects(h.awd.services.request('search', 'query', {}, { signal: controller.signal }), error => error.code === 'aborted')
  for (const timeoutMs of [0, -1, Infinity, '5', 300001]) await assert.rejects(h.awd.files.list({ timeoutMs }), error => error.code === 'invalid_params')
  assert.equal(h.sent.length, 0); assert.equal(h.timers.size, 0)
})

test('legacy return shapes remain unchanged and accept transport options', async t => {
  const h = harness(t)
  for (const [invoke, reply, expected] of [
    [() => h.awd.files.list({ timeoutMs: 50 }), { files: [{ path: 'x', name: 'x', size: 1 }] }, [{ path: 'x', name: 'x', size: 1 }]],
    [() => h.awd.ai.request('hello', { purpose: 'demo', timeoutMs: 50 }), { text: 'reply' }, 'reply'],
    [() => h.awd.storage.get('x'), { value: 7 }, 7],
    [() => h.awd.doc.getText(), { result: { text: 'doc' } }, { text: 'doc' }]
  ]) {
    const next = h.next(), promise = invoke(), message = await next
    h.response(message, reply); assert.deepEqual(await promise, expected)
  }
})

test('service timeout sends cancellation for its request and settled calls detach abort listener', async t => {
  const h = harness(t), controller = new AbortController()
  const next = h.next(), promise = h.awd.services.request('search', 'query', {}, { timeoutMs: 10, requestId: 'timed-out' })
  const message = await next
  const rejected = assert.rejects(promise, error => error.code === 'timeout'), cancellation = h.next()
  ;[...h.timers.values()][0]()
  await rejected
  const cancel = await cancellation
  assert.equal(cancel.params.requestId, 'timed-out'); assert.equal(cancel.method, 'services.cancel')
  h.response(cancel); h.response(message, { late: true })
  const next2 = h.next(), completed = h.awd.services.request('search', 'tags', {}, { signal: controller.signal })
  const msg2 = await next2
  h.response(msg2, { tags: [] }); await completed
  const count = h.sent.length; controller.abort()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.sent.length, count); assert.equal(h.timers.size, 0)
})

test('all distributed SDK copies are identical and safe to embed in website template', async () => {
  for (const copy of ['../../../backend/src/main/resources/plugin-dev/awd-plugin-sdk.js', '../../../examples/hello-web-plugin/web/awd-plugin-sdk.js', '../../../examples/plugin-service-demo/web/awd-plugin-sdk.js', '../../../official-plugins/baoqingtian/web/awd-plugin-sdk.js', '../../../official-plugins/tencent-meeting/web/awd-plugin-sdk.js', '../../../official-plugins/theme-inkwash-zen/web/awd-plugin-sdk.js', '../../../official-plugins/theme-anime-twilight/web/awd-plugin-sdk.js', '../../../official-plugins/theme-aurora-glass/web/awd-plugin-sdk.js']) {
    assert.equal(await readFile(new URL(copy, import.meta.url), 'utf8'), source)
  }
  assert.equal(source.includes('`'), false); assert.equal(source.includes('${'), false)
})

test('five-minute services survive two minutes, settle normally, and cancel only at their own deadline', async () => {
  let clock = 0, nextId = 0, listener
  const timers = new Map(), sent = []
  const parent = { postMessage: message => sent.push(message) }
  const window = { parent, addEventListener: (_name, callback) => { listener = callback } }
  vm.runInNewContext(source, { window,
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { at: clock + delay, callback }); return id },
    clearTimeout: id => timers.delete(id),
  })
  const advance = async duration => {
    clock += duration
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback() }
    await Promise.resolve(); await Promise.resolve()
  }
  const reply = (message, result) => listener({ source: parent, data: { awd: 1, type: 'result', seq: message.seq, ok: true, result } })
  let completed = false
  const pending = window.awd.services.request('sensitive', 'preview', {}, { timeoutMs: 300000, requestId: 'slow-preview' }).then(value => { completed = true; return value })
  await advance(120001)
  assert.equal(completed, false)
  assert.equal(sent.filter(message => message.method === 'services.cancel').length, 0)
  reply(sent[0], { preview: 'complete' })
  assert.deepEqual(await pending, { preview: 'complete' })
  assert.equal(timers.size, 0)
  const expiring = window.awd.services.request('sensitive', 'redact', {}, { timeoutMs: 300000, requestId: 'slow-redact' })
  const rejected = assert.rejects(expiring, error => error.code === 'timeout')
  await advance(299999)
  assert.equal(sent.filter(message => message.method === 'services.cancel').length, 0)
  await advance(1); await rejected
  const cancellation = sent.filter(message => message.method === 'services.cancel')
  assert.equal(cancellation.length, 1)
  assert.equal(cancellation[0].params.requestId, 'slow-redact')
  reply(cancellation[0], {})
  const normal = window.awd.settings.open()
  const defaultExpired = assert.rejects(normal, error => error.code === 'timeout')
  await advance(59999); assert.equal(timers.size, 1)
  await advance(1); await defaultExpired
  assert.equal(timers.size, 0)
})

// The target identity comes from the host iframe, never from a plugin argument.
test('workspace opening sends no target and preserves unavailable / old-host errors', async t => {
  const h = harness(t)
  assert.equal(h.awd.version, '1.8.0')
  for (const code of ['unavailable', 'unknown_method']) {
    const next = h.next(), promise = h.awd.ui.openWorkspace({ pluginId: 'another-plugin', viewId: 'other' })
    const message = await next
    assert.equal(message.method, 'ui.openWorkspace')
    assert.deepEqual(message.params, {})
    h.response(message, null, { code, message: code })
    await assert.rejects(promise, error => error.code === code)
    assert.equal(h.timers.size, 0)
  }
})
