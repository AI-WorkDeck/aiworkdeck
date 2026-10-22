// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/dd/DdClientChecklist.vue', import.meta.url), 'utf8')
function fixture(api = {}) {
  const body = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const options = new Function('ddClientRead', 'ddClientWrite', 'ddClientUpload', 'ddClientDownload', body)(api.read || (async () => []), api.write || (async () => {}), api.upload || (async () => {}), async () => {})
  const vm = { ...options.data(), requestId: 1, projectId: 2, connectionId: 'client-one' }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  return vm
}
test('AI findings stay distinct from lawyer confirmation and preserve manual review/appeal', () => {
  const vm = fixture(); const item = { id: 7, status: 'UPLOADED' }; vm.request = { status: 'PUBLISHED' }
  vm.submissions[7] = { reviewStatus: 'UPLOADED', aiStatus: 'PASSED' }
  assert.equal(vm.statusLabel(item), '材料核验通过'); assert.equal(vm.canSubmit(item), true)
  vm.submissions[7].reviewStatus = 'APPROVED'
  assert.equal(vm.statusLabel(item), '律师已确认'); assert.equal(vm.canSubmit(item), false)
  vm.submissions[7] = { reviewStatus: 'UPLOADED', aiStatus: 'MANUAL_REQUIRED' }
  assert.equal(vm.canAppeal(item), true)
  vm.submissions[7].appealedAt = '2026-10-21T10:00:00'
  assert.equal(vm.statusLabel(item), '律师复核中'); assert.equal(vm.canAppeal(item), false)
  vm.submissions[7].reviewedAt = '2026-10-21T11:00:00'
  assert.equal(vm.statusLabel(item), '待律师确认')
})
test('switching an item retains selected files and retry identity', async () => {
  const vm = fixture(); await vm.selectItem({ id: 7 }); const file = { name: 'license.pdf' }
  vm.addFiles([file]); const key = vm.uploadKey; vm.reason = 'Existing draft'
  await vm.selectItem({ id: 8 }); assert.deepEqual(vm.pendingFiles, [])
  await vm.selectItem({ id: 7 }); assert.deepEqual(vm.pendingFiles, [file]); assert.equal(vm.uploadKey, key); assert.equal(vm.reason, 'Existing draft')
})
test('a late response for another request cannot populate the active checklist', async () => {
  const pending = []; const vm = fixture({ read: () => new Promise(resolve => pending.push(resolve)) })
  const first = vm.load(); vm.requestId = 3; const second = vm.load()
  pending[1]({ request: { id: 3 }, items: [] }); await second
  pending[0]({ request: { id: 1 }, items: [{ id: 7 }] }); await first
  assert.equal(vm.request.id, 3); assert.deepEqual(vm.items, [])
})
test('failed uploads retain files and reuse the same idempotency key on retry', async () => {
  const keys = []; const vm = fixture({ upload: async (...args) => { keys.push(args[3]); throw new Error('network') } })
  vm.request = { status: 'PUBLISHED' }; vm.addFiles([{ name: 'license.pdf' }]); await vm.upload({ id: 7 }); await vm.upload({ id: 7 })
  assert.equal(vm.pendingFiles.length, 1); assert.equal(keys[0], keys[1]); assert.ok(keys[0]); assert.equal(vm.busy, false)
})

test('changing AI consent creates a new attempt and consent stays with each item draft', async () => {
  const vm = fixture(); await vm.selectItem({ id: 7 }); vm.addFiles([{ name: 'license.pdf' }]); const key = vm.uploadKey
  vm.changeAiConsent(true); assert.notEqual(vm.uploadKey, key); const consentKey = vm.uploadKey
  await vm.selectItem({ id: 8 }); assert.equal(vm.aiConsent, false)
  await vm.selectItem({ id: 7 }); assert.equal(vm.aiConsent, true); assert.equal(vm.uploadKey, consentKey)
  vm.changeAiConsent(true); assert.equal(vm.uploadKey, consentKey)
  vm.reset(); assert.deepEqual(vm.drafts, {}); assert.equal(vm.aiConsent, false); assert.equal(vm.uploadKey, '')
})

test('the workspace reads registered case servers from the real API envelope', async () => {
  const workspace = readFileSync(new URL('../../src/components/dd/DdClientWorkspace.vue', import.meta.url), 'utf8')
  const body = workspace.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const rows = [{ id: 1, name: 'Case server' }]
  const options = new Function('DdClientChecklist', 'listCloudConnections', 'isClientPortalBuild', 'ddNotificationPermission', 'ddClientIdentity', body)(null, async () => ({ code: 0, data: { connections: rows } }), () => false, () => 'unavailable', () => 'local')
  const vm = { ...options.data(), load: () => {}, refreshNotifications: () => {} }
  const timer = globalThis.setInterval; globalThis.setInterval = () => 0
  try { options.mounted.call(vm); await Promise.resolve(); assert.deepEqual(vm.cloudConnections, rows) }
  finally { globalThis.setInterval = timer }
})

test('category parents are not counted as materials, while preserved parent submissions stay actionable', () => {
  const vm = fixture(); const parent = { id: 1, status: 'PENDING' }; const child = { id: 2, parentId: 1, status: 'PENDING' }
  vm.items = [parent, child]; vm.request = { status: 'PUBLISHED' }
  assert.equal(vm.isCategory(parent), true); assert.equal(vm.actionableItems.length, 1); assert.equal(vm.canSubmit(parent), false)
  vm.submissions[1] = { reviewStatus: 'UPLOADED', aiStatus: 'PASSED' }
  assert.equal(vm.isCategory(parent), false); assert.equal(vm.actionableItems.length, 2)
})

function transportFixture(onSend) {
  const serviceSource = readFileSync(new URL('../../src/services/ddClient.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/export /g, '')
  class Xhr {
    constructor() { this.upload = {}; this.headers = {} }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(name, value) { this.headers[name] = value }
    send(body) { this.body = body; onSend(this) }
  }
  return new Function('getApiBaseUrl', 'getCloudAccountGeneration', 'getAuthHeaders', 'getSessionId', 'isClientPortalBuild', 'XMLHttpRequest', serviceSource + '\nreturn { ddClientUpload };')(
    () => 'http://127.0.0.1:1234', () => 0, () => ({ 'X-Session-Id': 'local', 'Content-Type': 'application/json' }), () => 'local', () => false, Xhr,
  )
}
test('desktop upload reports progress, leaves multipart boundary to the browser and keeps the global session', async () => {
  let sent; const progress = []
  const api = transportFixture(xhr => {
    sent = xhr; xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 })
    xhr.status = 200; xhr.responseText = '{"id":9}'; xhr.onload()
  })
  await api.ddClientUpload({ connectionId: 'bound', projectId: 4, requestId: 5 }, 7, [new File(['synthetic'], 'proof.pdf')], 'retry-1', true, value => progress.push(value))
  assert.equal(sent.headers['Content-Type'], undefined)
  assert.equal(sent.headers['X-Session-Id'], 'local')
  assert.equal(sent.body.getAll('files').length, 1)
  assert.equal(sent.body.get('aiConsent'), 'true')
  assert.equal(sent.timeout, 180000); assert.deepEqual(progress, [50])
  assert.equal(sent.url, 'http://127.0.0.1:1234/api/dd-client/connections/bound/dd/items/7/submissions?requestId=5')
})
test('upload timeout returns a retryable error without a second submission', async () => {
  let sends = 0
  const api = transportFixture(xhr => { sends++; xhr.ontimeout() })
  await assert.rejects(api.ddClientUpload({ connectionId: 'bound', requestId: 5 }, 7, [], 'retry-1', false), /上传超时.*已保留/)
  assert.equal(sends, 1)
})
test('only published and unconfirmed items allow file, explanation and appeal actions', async () => {
  let writes = 0; const vm = fixture({ upload: async () => writes++, write: async () => writes++ })
  const item = { id: 7 }; vm.submissions[7] = { reviewStatus: 'UPLOADED', aiStatus: 'FAILED' }
  vm.pendingFiles = [{ name: 'proof.pdf' }]; vm.reason = 'Please review'; vm.formMode = 'appeal'
  for (const status of ['COMPLETED', 'ARCHIVED', 'DRAFT']) {
    vm.request = { status }; assert.equal(vm.canSubmit(item), false); assert.equal(vm.canAppeal(item), false)
    await vm.upload(item); await vm.submitReason(item)
  }
  vm.request = { status: 'PUBLISHED' }; vm.submissions[7].reviewStatus = 'APPROVED'
  assert.equal(vm.canSubmit(item), false); assert.equal(vm.canAppeal(item), false)
  await vm.upload(item); await vm.submitReason(item); assert.equal(writes, 0)
})

test('portal refresh restores only invitation sessions and forgetting removes them', async () => {
  const source = readFileSync(new URL('../../src/services/ddClient.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/export /g, '')
  const stored = new Map(); const sessionStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) }
  const sessions = []
  const fetch = async (url, options) => {
    sessions.push(options.headers['X-Session-Id'])
    return { status: 200, json: async () => url.endsWith('client-login')
      ? { code: 0, data: { sessionId: 'invitation-only', projectId: 7 } }
      : { name: 'Synthetic project' } }
  }
  function load(portal = true) {
    return new Function('getApiBaseUrl', 'getCloudAccountGeneration', 'getAuthHeaders', 'getSessionId', 'isClientPortalBuild', 'sessionStorage', 'fetch',
      source + '\nreturn { connectDdClient, listDdClientConnections, removeDdClientConnection, ddClientRead };')(
      () => 'https://case.example', () => 0, () => ({ 'X-Session-Id': 'personal' }), () => 'personal', () => portal, sessionStorage, fetch)
  }
  const first = load(); const invitation = await first.connectDdClient('code')
  assert.equal(invitation.session, undefined)
  const refreshed = load(); assert.deepEqual(await refreshed.listDdClientConnections(), [invitation])
  await refreshed.ddClientRead({ connectionId: invitation.id, projectId: 7 }, '/projects')
  assert.equal(sessions.at(-1), 'invitation-only')
  await load(false).listDdClientConnections(); assert.equal(sessions.at(-1), 'personal')
  await refreshed.removeDdClientConnection(invitation.id)
  assert.deepEqual(await load().listDdClientConnections(), [])
})
