// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../../examples/plugin-service-demo/web/app.js', import.meta.url), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function fixture(override = {}, ready = Promise.resolve()) {
  const nodes = {}, events = {}, windowEvents = {}, calls = []
  function node(id) { return nodes[id] ||= { value: '', textContent: '', dataset: {}, disabled: false, listeners: {}, addEventListener(event, handler) { this.listeners[event] = handler } } }
  const names = ['settingsOpen', 'settingsSave', 'ai', 'search', 'connections', 'connect', 'disconnect', 'provider', 'servers', 'mcp', 'hostBilling', 'hostCheckout', 'providerBilling', 'checkout']
  const buttons = names.map(name => { const button = node(name); button.dataset.action = name; return button })
  for (const id of ['prompt', 'greeting', 'example-provider-status', 'oauth-provider-status']) node(id)
  node('provider').value = 'example-provider'; node('server').value = 'example-mcp'; node('tool').value = 'echo'; node('arguments').value = '{"text":"hello"}'
  const api = (group, name) => (...args) => { calls.push([group + '.' + name, ...args]); return override[group + '.' + name]?.(...args) ?? Promise.resolve({}) }
  const awd = { ready: () => ready, events: { on(name, fn) { events[name] = fn; return () => { delete events[name] } } } }
  for (const [group, methods] of Object.entries({ settings: ['open', 'update'], ai: ['request'], services: ['request'], connections: ['list', 'connect', 'disconnect', 'request'], mcp: ['servers', 'call'], billing: ['status', 'checkout'] })) awd[group] = Object.fromEntries(methods.map(name => [name, api(group, name)]))
  new Function('document', 'window', 'awd', source)({ getElementById: node, querySelectorAll: () => buttons }, { addEventListener: (name, fn) => { windowEvents[name] = fn } }, awd)
  return { nodes, calls, events, windowEvents, click: name => node(name).listeners.click() }
}
test('demo distinguishes selected provider, host billing and opening settings from login', async () => {
  const f = fixture(); await flush()
  f.nodes.provider.value = 'oauth-provider'
  await f.click('connect'); assert.equal(f.calls.at(-1)[1], 'oauth-provider'); assert.match(f.nodes.result.textContent, /尚不代表已登录/)
  await f.click('provider'); assert.deepEqual(f.calls.at(-1).slice(0, 3), ['connections.request', 'oauth-provider', 'query'])
  await f.click('hostCheckout'); assert.equal(f.calls.at(-1)[1], undefined); assert.match(f.nodes.result.textContent, /尚不代表已付款/)
  await f.click('checkout'); assert.equal(f.calls.at(-1)[1], 'oauth-provider')
})
test('demo displays actual independent connection states', async () => {
  const f = fixture({ 'connections.list': () => Promise.resolve({ connections: [{ id: 'example-provider', connected: true }, { id: 'oauth-provider', connected: false }] }) }); await flush()
  await f.click('connections')
  assert.equal(f.nodes['example-provider-status'].textContent, '已连接')
  assert.equal(f.nodes['oauth-provider-status'].textContent, '未连接')
})
test('MCP application errors remain errors and invalid argument JSON never calls service', async () => {
  const f = fixture({ 'mcp.call': () => Promise.resolve({ isError: true, content: [{ type: 'text', text: 'tool rejected input' }] }) }); await flush()
  await f.click('mcp'); assert.deepEqual(f.calls[0].slice(1, 4), ['example-mcp', 'echo', { text: 'hello' }]); assert.equal(f.nodes.result.dataset.error, 'true'); assert.match(f.nodes.result.textContent, /tool rejected/)
  f.nodes.arguments.value = '[]'; await f.click('mcp'); assert.equal(f.calls.length, 1); assert.equal(f.nodes.result.dataset.error, 'true')
})
test('account change clears sensitive input and discards late connection status', async () => {
  const pending = deferred(); const f = fixture({ 'connections.list': () => pending.promise }); await flush()
  f.nodes.prompt.value = 'private'; const request = f.click('connections'); const signal = f.calls[0][1].signal
  f.events['account.changed'](); assert.equal(signal.aborted, true); assert.equal(f.nodes.prompt.value, '')
  pending.resolve({ connections: [{ id: 'example-provider', connected: true }] }); await request
  assert.equal(f.nodes['example-provider-status'].textContent, '未查询'); assert.match(f.nodes.result.textContent, /上下文已改变/); assert.equal(f.nodes.connect.disabled, true)
})
test('cancel waits for SDK abort and does not claim remote side effects were rolled back', async () => {
  const f = fixture({ 'mcp.call': (_id, _name, _args, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) }); await flush()
  const request = f.click('mcp'); f.click('cancel'); await request
  assert.match(f.nodes.result.textContent, /远端操作可能仍在执行/); assert.equal(f.nodes.mcp.disabled, false); assert.equal(f.nodes.cancel.disabled, true)
})
test('late SDK ready after pagehide never re-enables detached demo', async () => {
  const ready = deferred(); const f = fixture({}, ready.promise)
  f.windowEvents.pagehide(); ready.resolve(); await flush()
  assert.equal(f.nodes.connect.disabled, true); assert.equal(Object.keys(f.events).length, 0); assert.match(f.nodes.result.textContent, /上下文已改变/)
})
