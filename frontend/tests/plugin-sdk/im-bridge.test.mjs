// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { preparePluginImDrag, endPluginImDrag, consumePluginImDrag } from '../../src/utils/pluginImDrag.js'
import { addPluginImFileToAi } from '../../src/utils/pluginImAi.js'
import { nativeDataTransfer } from '../../src/utils/fileTreeExternalDrop.js'

const source = readFileSync(new URL('../../src/components/PluginPane.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '').replace(/export\s+default/, 'return')
const files = [{ id: 7, name: '项目沟通', isFolder: true }, { id: 42, parentId: 7, name: '证据.pdf', fileType: 'pdf' }]
const path = '项目沟通/证据.pdf'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }

function harness(deps = {}) {
  const sent = [], events = [], listeners = new Map()
  const win = { addEventListener() {}, removeEventListener() {}, ...deps.window }
  const uni = { $on: (key, fn) => listeners.set(key, fn), $off: key => listeners.delete(key), $emit: (...args) => events.push(args) }
  const options = new Function('getProjectFiles', 'requestPluginIm', 'preparePluginImDrag', 'endPluginImDrag',
    'ACCOUNT_CHANGED_EVENT', 'APP_THEME_EVENT', 'window', 'uni', 'setTimeout', 'subscribeTaskChanges', 'getPlugins', body)(deps.getProjectFiles || (async () => files),
    deps.requestPluginIm || (async () => ({ code: 0, data: { conversations: [] } })), preparePluginImDrag, endPluginImDrag,
    'awd:account-changed', 'theme', win, uni, deps.setTimeout || setTimeout, () => () => {}, async () => [{ id: 'project-im', enabled: true, permissions: ['im', 'file_read'], version: '1.0', devInstalled: false }])
  const vm = { ...options.data(), projectId: 5, pluginId: 'project-im', url: '/api/plugin-web/project-im/index.html',
    permissions: ['im', 'file_read'], addFileToAi: deps.addFileToAi || (async value => { events.push(['addFile', value]) }),
    $refs: { pluginFrame: { contentWindow: { postMessage: message => sent.push(message) } } },
    $emit: (...args) => events.push(args) }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  options.created.call(vm)
  return { vm, options, sent, events, listeners }
}
function dataTransfer(descriptor, forged = {}) {
  const data = new Map([[descriptor.dragType, descriptor.dragToken],
    ['application/x-checkba-file', JSON.stringify({ ...descriptor, ...forged })]])
  return { types: [...data.keys()], getData: type => data.get(type) || '' }
}

test('IM bridge binds host project/plugin and unwraps data; failures are visible', async () => {
  const calls = []
  const h = harness({ requestPluginIm: async (...args) => { calls.push(args); return { code: 0, data: { ok: true } } } })
  assert.deepEqual(await h.vm.handleCall('im.request', { action: 'list', projectId: 999, params: { query: 'a' } }), { ok: true, result: { ok: true } })
  assert.deepEqual(calls, [['project-im', 5, 'list', { query: 'a' }]])
  const failed = harness({ requestPluginIm: async () => { throw new Error('无法连接账户服务') } })
  assert.match((await failed.vm.handleCall('im.request', { action: 'list' })).error.message, /无法连接账户服务/)
  const denied = harness({ requestPluginIm: async () => ({ code: 403, message: '不在会话中' }) })
  assert.equal((await denied.vm.handleCall('im.request', { action: 'list' })).error.message, '不在会话中')
  for (const params of [{}, { action: 'list', params: [] }]) assert.equal((await h.vm.handleCall('im.request', params)).error.code, 'invalid_params')
})

test('permission denied never calls network or adds files', async () => {
  const h = harness({ getProjectFiles: () => { throw new Error('must not read') }, requestPluginIm: () => { throw new Error('must not call') } })
  h.vm.permissions = []
  for (const method of ['im.request', 'im.downloadAttachment', 'chat.addFile', 'files.prepareDrag', 'files.endDrag']) {
    assert.equal((await h.vm.handleCall(method, { action: 'list', path })).error.code, 'permission_denied')
  }
  assert.deepEqual(h.events, [])
})

test('AI file references resolve from current project; supplied ids and unknown paths have no authority', async () => {
  const h = harness()
  assert.equal((await h.vm.handleCall('chat.addFile', { path: '../other/secret.pdf', fileId: 42 })).error.code, 'not_found')
  assert.equal((await h.vm.handleCall('chat.addFile', { path, fileId: 999, projectId: 999 })).ok, true)
  const added = h.events.find(event => event[0] === 'addFile')[1]
  assert.equal(added.projectId, 5)
  assert.equal(added.file.id, 42)
  assert.equal(added.file.fileType, 'pdf')
  assert.equal((await harness({ addFileToAi: async () => { throw new Error('对话不可用') } }).vm.handleCall('chat.addFile', { path })).error.message, '对话不可用')
})

test('changing project while resolving a path prevents add, open and drag side effects', async () => {
  for (const method of ['chat.addFile', 'files.prepareDrag', 'ui.openFile']) {
    const gate = deferred()
    const h = harness({ getProjectFiles: () => gate.promise })
    const result = h.vm.handleCall(method, { path })
    h.vm.projectId = 6
    h.options.watch.projectId.call(h.vm, 6)
    gate.resolve(files)
    assert.equal((await result).error.code, 'stale_context')
    assert.deepEqual(h.events, [])
  }
})

test('account change invalidates in-flight IM results and pushes subscribed event', async () => {
  const gate = deferred(), h = harness({ requestPluginIm: () => gate.promise })
  h.options.mounted.call(h.vm)
  await h.vm.initializeAuthorization()
  await h.vm.handleCall('events.subscribe', { events: ['account.changed'] })
  const request = h.vm.onMessage({ source: h.vm.$refs.pluginFrame.contentWindow,
    data: { awd: 1, type: 'call', seq: 1, method: 'im.request', params: { action: 'list' } } })
  await new Promise(resolve => setImmediate(resolve))
  h.listeners.get('awd:account-changed')()
  gate.resolve({ code: 0, data: { private: 'old account' } })
  await request
  assert.equal(h.sent.some(message => message.type === 'result'), false)
  assert.equal(h.sent.some(message => message.type === 'event' && message.event === 'account.changed'), true)
  h.options.beforeUnmount.call(h.vm)
  assert.equal(h.listeners.has('awd:account-changed'), false)
})

test('prepared drag is one-use, host-authoritative and cleared on context change', async () => {
  const h = harness()
  let receipt = (await h.vm.handleCall('files.prepareDrag', { path })).result
  assert.equal(consumePluginImDrag({ types: [], getData: () => '' }, 5).handled, false, 'preparation alone cannot impersonate a drag')
  let dt = dataTransfer(receipt, { fileId: 999, name: 'forged.pdf' })
  assert.equal(consumePluginImDrag(dt, 5).file.id, 42)
  assert.equal(consumePluginImDrag(dt, 5).file, null)
  receipt = (await h.vm.handleCall('files.prepareDrag', { path })).result
  dt = dataTransfer(receipt)
  assert.equal(consumePluginImDrag(dt, 999).file, null)
  receipt = (await h.vm.handleCall('files.prepareDrag', { path })).result
  h.options.watch.projectId.call(h.vm, 6)
  assert.equal(consumePluginImDrag(dataTransfer(receipt), 5).file, null)
  await h.vm.initializeAuthorization()
  receipt = (await h.vm.handleCall('files.prepareDrag', { path })).result
  await h.vm.handleCall('files.endDrag', {})
  assert.equal(consumePluginImDrag(dataTransfer(receipt), 5).file, null)
})

test('AI panel asynchronous opening cannot attach after project/account changes', async () => {
  const gate = deferred(), added = []
  const vm = { projectId: 5, resolveChatInterface: () => gate.promise }
  const promise = addPluginImFileToAi(vm, { projectId: 5, file: { id: 42 } })
  vm.projectId = 6
  gate.resolve({ addFile: file => added.push(file) })
  await assert.rejects(promise, /已切换/)
  assert.deepEqual(added, [])
  await assert.rejects(addPluginImFileToAi({ projectId: 5, resolveChatInterface: async () => null }, { projectId: 5 }), /暂不可用/)
  const pending = deferred(), owner = { sessionGeneration: 0 }
  const receipt = preparePluginImDrag(owner, { id: 42 }, 5)
  const drop = consumePluginImDrag(dataTransfer(receipt), 5)
  const add = addPluginImFileToAi({ projectId: 5, resolveChatInterface: () => pending.promise }, { ...drop, projectId: 5 })
  owner.sessionGeneration++
  pending.resolve({ addFile: file => added.push(file) })
  await assert.rejects(add, /已切换/)
  assert.deepEqual(added, [])
})

test('actual workbench drop recovers native transfer and rejects expired plugin MIME instead of legacy fallback', () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const method = page.slice(page.indexOf('    handleAiDrop(e) {') + '    handleAiDrop(e) {'.length,
    page.indexOf('    /** 把一份项目文件挂进 AI 上下文'))
  const drop = new Function('consumePluginImDrag', 'nativeDataTransfer', 'uni',
    'return function(e) {' + method.replace(/},\s*$/, '}'))
  const added = [], warnings = []
  const handler = drop(consumePluginImDrag, nativeDataTransfer, { showToast: p => warnings.push(p.title) })
  const vm = { projectId: 5, onPluginAddFileToAi: async value => { added.push(value.file) } }
  const owner = {}, receipt = preparePluginImDrag(owner, { id: 42, name: '证据.pdf', fileType: 'pdf' }, 5)
  const original = globalThis.window
  try {
    globalThis.window = { event: { dataTransfer: dataTransfer(receipt, { fileId: 999 }) } }
    handler.call(vm, { preventDefault() {} })
    assert.deepEqual(added.map(file => file.id), [42])
    handler.call(vm, { preventDefault() {} })
    assert.equal(added.length, 1)
    assert.match(warnings[0], /已过期/)
  } finally { globalThis.window = original; endPluginImDrag() }
})

test('drag receipts expire and clear on focus loss without writing global file fallback', () => {
  const events = new Map(), win = { addEventListener: (type, fn) => events.set(type, fn), removeEventListener: type => events.delete(type) }
  const owner = {}, file = { id: 42, name: '证据.pdf', fileType: 'pdf' }
  const receipt = preparePluginImDrag(owner, file, 5, win)
  events.get('blur')()
  assert.equal(consumePluginImDrag(dataTransfer(receipt), 5).file, null)
  const now = Date.now
  try {
    const fresh = preparePluginImDrag(owner, file, 5, win)
    Date.now = () => fresh.expiresAt + 1
    assert.equal(consumePluginImDrag(dataTransfer(fresh), 5).file, null)
  } finally { Date.now = now; endPluginImDrag() }
})

function downloadHarness(options = {}) {
  const downloads = [], blobs = [], revoked = [], timers = [], calls = []
  const window = {
    atob: (value) => atob(value), Blob,
    URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:synthetic-authorized' }, revokeObjectURL: (url) => revoked.push(url) },
    document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push({ href: this.href, name: this.download }) }, remove() {} }) }
  }
  const h = harness({ window, setTimeout: (cb, ms) => timers.push({ cb, ms }), requestPluginIm: async (...args) => {
    calls.push(args)
    return options.request ? options.request(...args) : { code: 0, data: { id: 'attachment-1', name: '../../合成\\合同?.txt', base64: btoa('synthetic bytes') } }
  } })
  h.vm.permissions = ['im']
  return { ...h, downloads, blobs, revoked, timers, calls }
}
const downloadParams = { conversationId: 'conversation-1', attachmentId: 'attachment-1' }
test('attachment download requires only IM and sends IDs, never plugin paths/URLs or project writes', async () => {
  const h = downloadHarness()
  const result = await h.vm.handleCall('im.downloadAttachment', { ...downloadParams, path: '/private/secret', url: 'https://attacker.invalid/file', projectId: 999 })
  assert.equal(result.ok, true); assert.equal(result.result.started, true)
  assert.deepEqual(h.calls, [['project-im', 5, 'download', downloadParams]])
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].href, 'blob:synthetic-authorized')
  assert.doesNotMatch(h.downloads[0].name, /[/\\?]/); assert.ok(!h.downloads[0].name.startsWith('.'))
  assert.equal(await h.blobs[0].text(), 'synthetic bytes'); assert.deepEqual(h.events, [])
  assert.equal(h.timers[0].ms, 60000); h.timers[0].cb(); assert.deepEqual(h.revoked, ['blob:synthetic-authorized'])
})
test('download rejects missing IDs, unauthorized response, mismatched bytes and oversized data before saving', async () => {
  const h = downloadHarness()
  assert.equal((await h.vm.handleCall('im.downloadAttachment', { url: 'https://example.invalid' })).error.code, 'invalid_params')
  assert.equal(h.calls.length, 0)
  for (const response of [
    { code: 403, message: '抱歉文件还在准备中，请联系您的律师。' },
    { code: 0, data: { id: 'another-file', base64: 'YQ==' } },
    { code: 0, data: { id: 'attachment-1', base64: '@@@@' } },
    { code: 0, data: { id: 'attachment-1', base64: 'A'.repeat(Math.ceil(8 * 1024 * 1024 / 3) * 4 + 4) } }
  ]) {
    const denied = downloadHarness({ request: async () => response })
    assert.equal((await denied.vm.handleCall('im.downloadAttachment', downloadParams)).ok, false)
    assert.equal(denied.downloads.length, 0); assert.equal(denied.blobs.length, 0)
  }
})
test('a late authorized download after account or project switch never reaches the save mechanism', async () => {
  const wait = deferred(), h = downloadHarness({ request: () => wait.promise })
  const pending = h.vm.handleCall('im.downloadAttachment', downloadParams)
  h.vm.sessionGeneration++
  wait.resolve({ code: 0, data: { id: 'attachment-1', name: 'file.txt', base64: 'YQ==' } })
  assert.equal((await pending).ok, false); assert.equal(h.downloads.length, 0)
})

test('conversation-authorized download also works without a current project', async () => {
  const h = downloadHarness(); h.vm.projectId = null
  assert.equal((await h.vm.handleCall('im.downloadAttachment', downloadParams)).ok, true)
  assert.equal(h.calls[0][1], null); assert.equal(h.downloads.length, 1)
})
