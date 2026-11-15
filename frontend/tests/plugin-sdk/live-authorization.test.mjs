// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const body = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
const record = () => ({ id: 'demo', enabled: true, permissions: ['file_read'], version: '1.0', devInstalled: true, frontendEntry: 'web/index.html' })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
function harness() {
  let rows = [record()], fetcher = async () => rows, reads = 0, calls = 0
  const posted = [], events = []
  const options = new Function('getPlugins', 'endPluginImDrag', 'getProjectFiles', 'uni', body)(() => { reads++; return fetcher() }, () => {}, async () => { calls++; return [{ id: 1, name: 'private.txt' }] }, { $emit: name => events.push(name) })
  const vm = { ...options.data(), pluginId: 'demo', projectId: 1, permissions: ['file_read'], devInstalled: true, url: '/api/plugin-web/demo/index.html', $refs: { pluginFrame: { contentWindow: { postMessage: value => posted.push(value) } } } }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  options.created.call(vm)
  return { vm, options, posted, events, get calls() { return calls }, get reads() { return reads }, set rows(value) { rows = value }, set fetcher(value) { fetcher = value }, call: (method = 'files.list') => vm.onMessage({ source: vm.$refs.pluginFrame.contentWindow, data: { awd: 1, type: 'call', seq: 1, method, params: {} } }) }
}

test('iframe is gated until authority is captured; stale props cannot authorize even first call', async () => {
  assert.match(source, /v-(?:else-)?if="url && \(!isWebPlugin \|\| authorizationReady\)"/)
  const h = harness(); h.rows = [{ ...record(), permissions: [] }]
  await h.vm.initializeAuthorization()
  await h.call()
  assert.equal(h.vm.authorizationReady, false)
  assert.equal(h.calls, 0)
})
test('a live instance checks both sides of every call without a completed-cache TTL', async () => {
  const h = harness(); await h.vm.initializeAuthorization(); assert.equal(h.vm.authorizationReady, true)
  await h.call(); await h.call()
  assert.equal(h.reads, 5)
  assert.equal(h.calls, 2)
  assert.equal(h.posted.filter(x => x.ok).length, 2)
})
for (const [label, mutate] of [
  ['permission revoked', r => ({ ...r, permissions: [] })],
  ['permission added', r => ({ ...r, permissions: ['file_read', 'editor'] })],
  ['disabled', r => ({ ...r, enabled: false })],
  ['revoked', r => ({ ...r, revokedReason: 'withdrawn' })],
  ['incompatible', r => ({ ...r, incompatibleReason: 'host version' })],
  ['upgraded', r => ({ ...r, version: '2.0' })],
  ['dev trust removed', r => ({ ...r, devInstalled: false })],
  ['uninstalled', () => null]
]) test(`${label} invalidates the old instance before execution and disposes pending services`, async () => {
  const h = harness(); await h.vm.initializeAuthorization()
  let disposed = 0; h.vm._businessServices = { dispose() { disposed++ } }
  const next = mutate(record()); h.rows = next ? [next] : []
  await h.call()
  assert.equal(h.calls, 0); assert.equal(disposed, 1); assert.equal(h.vm.authorizationReady, false)
  h.rows = [record()]; await h.call()
  assert.equal(h.calls, 0, 'old iframe never revives without a new lifecycle')
})
test('revocation while a result is pending suppresses its private payload', async () => {
  const h = harness(); await h.vm.initializeAuthorization()
  const gate = deferred(); h.vm.handleCall = () => gate.promise
  const pending = h.call(); await new Promise(r => setImmediate(r))
  h.rows = [{ ...record(), permissions: [] }]; gate.resolve({ ok: true, result: 'private' }); await pending
  assert.equal(h.posted.some(x => x.ok), false); assert.equal(h.vm.authorizationReady, false)
})
test('failed metadata read fails closed; stale lifecycle never executes or replies', async () => {
  const h = harness(); await h.vm.initializeAuthorization(); h.fetcher = async () => { throw new Error('offline') }
  await h.call(); assert.equal(h.calls, 0); assert.equal(h.vm.authorizationReady, false)
  for (const destroyed of [false, true]) {
    const next = harness(); await next.vm.initializeAuthorization(); const gate = deferred(); next.fetcher = () => gate.promise
    const pending = next.call(); next.vm.sessionGeneration++; if (destroyed) next.vm._authorizationDestroyed = true
    gate.resolve([record()]); await pending
    assert.equal(next.calls, 0); assert.equal(next.posted.length, 0)
  }
})
test('authorization finishing after unmount cannot mount an iframe', async () => {
  const h = harness(), gate = deferred(); h.fetcher = () => gate.promise
  const pending = h.vm.initializeAuthorization(); h.vm._authorizationDestroyed = true; h.vm.sessionGeneration++
  gate.resolve([record()]); await pending
  assert.equal(h.vm.authorizationReady, false)
})

test('metadata changes refresh stale parent props once; network failure does not loop refresh', async () => {
  const h = harness(); await h.vm.initializeAuthorization(); h.rows = [{ ...record(), permissions: [] }]
  await h.call(); assert.deepEqual(h.events, ['awd:market-changed', 'awd:market-changed-from-sidebar'])
  await h.vm.initializeAuthorization(); assert.equal(h.events.length, 2)
  h.vm.permissions = []; await h.vm.initializeAuthorization(); assert.equal(h.vm.authorizationReady, true)
  await h.call(); assert.equal(h.posted.at(-1).error.code, 'permission_denied')
  h.fetcher = async () => { throw Error('offline') }; await h.call(); assert.equal(h.events.length, 2)
})

// 0.86.0 律所管理 B5：/api/plugins/list 的工具说明、视图/主题等名称按界面语言返回。切换语言不是授权变化，
// 否则下一次桥调用就会作废实例、重建 iframe，插件回到入口地址，丢掉当前页签和路由。
const localizedRecord = (lang) => ({
  ...record(),
  tools: [{ name: 'demo_overview', description: lang === 'zh' ? '查看概况' : 'Show the overview', permissions: ['file_read'] }],
  contributes: {
    capabilities: ['x'],
    views: [{ id: 'main', name: lang === 'zh' ? '律所管理' : 'Law firm', entry: 'web/index.html', placement: 'workspace' }],
    themes: [{ id: 't', name: lang === 'zh' ? '水墨' : 'Ink', description: lang === 'zh' ? '说明' : 'About', file: 'themes/t.json' }],
    templates: [{ id: 'tpl', name: lang === 'zh' ? '模板' : 'Template', description: lang === 'zh' ? '说明' : 'About', file: 'templates/a.docx', genre: 'bid' }],
    styleProfiles: [{ id: 'sp', name: lang === 'zh' ? '样式' : 'Style', file: 'profiles/s.json' }],
    evidenceSources: [{ sourceId: 'ev', name: lang === 'zh' ? '依据' : 'Basis', description: lang === 'zh' ? '说明' : 'About', transport: 'mcp', server: 's', tool: 't' }]
  }
})
test('switching the app language keeps the live instance: localized names and descriptions are not authority', async () => {
  const h = harness(); h.rows = [localizedRecord('zh')]
  await h.vm.initializeAuthorization(); assert.equal(h.vm.authorizationReady, true)
  const generation = h.vm.sessionGeneration
  h.rows = [localizedRecord('en')]
  await h.call()
  assert.equal(h.calls, 1, 'the call runs')
  assert.equal(h.vm.authorizationReady, true)
  assert.equal(h.vm.sessionGeneration, generation, 'no new iframe, so the panel keeps its route')
  assert.deepEqual(h.events, [], 'no market refresh either')
})
for (const [label, mutate] of [
  ['a tool added', r => ({ ...r, tools: [...r.tools, { name: 'demo_delete', description: 'x', permissions: ['file_write'] }] })],
  ['a tool permission widened', r => ({ ...r, tools: [{ ...r.tools[0], permissions: ['file_read', 'file_write'] }] })],
  ['a view entry changed', r => ({ ...r, contributes: { ...r.contributes, views: [{ ...r.contributes.views[0], entry: 'web/other.html' }] } })],
  ['an evidence source pointed at another server', r => ({ ...r, contributes: { ...r.contributes, evidenceSources: [{ ...r.contributes.evidenceSources[0], server: 'other' }] } })]
]) test(`${label} still invalidates even when the language changed at the same time`, async () => {
  const h = harness(); h.rows = [localizedRecord('zh')]
  await h.vm.initializeAuthorization()
  h.rows = [mutate(localizedRecord('en'))]
  await h.call()
  assert.equal(h.calls, 0); assert.equal(h.vm.authorizationReady, false)
})

// 插件工具权限升级重新授权：列表现在带工具的 access/confirm/mcp/handler/inputSchema，任一变化都作废旧实例；
// pendingToolChanges / toolApprovalToken 只是「还没批准」的状态，批准时不该再重建面板（闸在后端）。
const toolRecord = (tool = {}) => ({ ...record(), tools: [{ name: 'demo_add', description: 'x', permissions: [], access: 'write',
  handler: { type: 'service', service: 'calendar', operation: 'create' }, inputSchema: { type: 'object' }, ...tool }] })
for (const [label, change] of [
  ['access widened', { access: 'destructive' }],
  ['confirm turned off', { confirm: 'never' }],
  ['MCP projection turned on', { mcp: true }],
  ['handler rebound', { handler: { type: 'service', service: 'calendar', operation: 'delete' } }],
  ['input schema changed', { inputSchema: { type: 'object', properties: { taskId: { type: 'integer' } } } }]
]) test(`tool ${label} invalidates the live instance`, async () => {
  const h = harness(); h.rows = [toolRecord()]
  await h.vm.initializeAuthorization()
  h.rows = [toolRecord(change)]
  await h.call()
  assert.equal(h.calls, 0); assert.equal(h.vm.authorizationReady, false)
})
test('approving pending tool changes does not rebuild the panel', async () => {
  const pending = { ...toolRecord(), pendingToolChanges: [{ name: 'demo_add', reasons: ['access'] }], toolApprovalToken: 'abc' }
  const h = harness(); h.rows = [pending]
  await h.vm.initializeAuthorization()
  const generation = h.vm.sessionGeneration
  h.rows = [toolRecord()]
  await h.call()
  assert.equal(h.calls, 1); assert.equal(h.vm.sessionGeneration, generation)
})
