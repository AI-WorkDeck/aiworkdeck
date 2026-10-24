// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createI18n } from 'vue-i18n'
import zh from '../../src/locales/zh-CN/ddWorkflow.js'
import en from '../../src/locales/en-US/ddWorkflow.js'
const translate = (locale = 'zh-CN') => createI18n({ legacy: true, locale, messages: { 'zh-CN': { ddWorkflow: zh }, 'en-US': { ddWorkflow: en } } }).global.t
const source = readFileSync(new URL('../../src/components/dd/DdClientChecklist.vue', import.meta.url), 'utf8')
function fixture(api = {}, locale = 'zh-CN') {
  const body = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const options = new Function('ddClientRead', 'ddClientWrite', 'ddClientUpload', 'ddClientDownload', body)(api.read || (async () => []), api.write || (async () => {}), api.upload || (async () => {}), async () => {})
  const vm = { ...options.data(), $emit: () => {}, $t: translate(locale), requestId: 1, projectId: 2, connectionId: 'client-one' }
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

test('a message opens its exact item once and polling does not override the next user selection', async () => {
  const vm = fixture(); vm.items = [{ id: 7 }, { id: 8 }]; vm.focusItemId = '8'; vm.filter = 'done'; vm.query = 'hidden'
  vm.focusRequestedItem(); assert.equal(vm.selectedId, 8); assert.equal(vm.filter, 'all'); assert.equal(vm.query, '')
  await vm.selectItem(vm.items[0]); vm.focusRequestedItem(); assert.equal(vm.selectedId, 7)
  vm.focusItemId = 999; vm.focusRequestedItem(); assert.equal(vm.selectedId, 7)
})

function navigationFixture(read) {
  const workspace = readFileSync(new URL('../../src/components/dd/DdClientWorkspace.vue', import.meta.url), 'utf8')
  const body = workspace.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('export default', 'return')
  const options = new Function('DdClientChecklist', 'ddNotificationPermission', 'ddClientRead', body)(null, () => 'unavailable', read)
  const vm = { ...options.data(), $t: translate(), navigationTarget: null }
  for (const [key, fn] of Object.entries(options.methods)) vm[key] = fn.bind(vm)
  for (const [key, fn] of Object.entries(options.computed)) Object.defineProperty(vm, key, { get: fn.bind(vm) })
  vm.connections = [{ id: 'client-one', projectId: 2 }, { id: 'client-two', projectId: 3 }]
  return vm
}

test('message navigation requires the saved connection/project pair and an available request', async () => {
  const seen = []; const vm = navigationFixture(async (scope, path) => { seen.push([scope, path]); return [{ id: 4 }, { id: 5 }] })
  vm.navigationTarget = { connectionId: 'client-one', projectId: 3, requestId: 5, itemId: 8 }
  await vm.applyNavigationTarget(); assert.equal(seen.length, 0); assert.ok(vm.error)
  vm.navigationTarget = { connectionId: 'client-one', projectId: 2, requestId: '5', itemId: 8 }
  await vm.applyNavigationTarget(); assert.equal(vm.requestId, 5); assert.equal(vm.focusItemId, 8)
  assert.deepEqual(seen[0], [{ connectionId: 'client-one', projectId: 2 }, '/projects'])
})

test('a late navigation request cannot replace the newest message target', async () => {
  const pending = []; const vm = navigationFixture(() => new Promise(resolve => pending.push(resolve)))
  vm.navigationTarget = { connectionId: 'client-one', projectId: 2, requestId: 4, itemId: 7 }
  const old = vm.applyNavigationTarget()
  vm.navigationTarget = { connectionId: 'client-two', projectId: 3, requestId: 5, itemId: 8 }
  const current = vm.applyNavigationTarget()
  pending[1]([{ id: 5 }]); await current
  pending[0]([{ id: 4 }]); await old
  assert.equal(vm.selectedId, 'client-two'); assert.equal(vm.requestId, 5); assert.equal(vm.focusItemId, 8)
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

function transportFixture(onSend, locale = 'zh-CN') {
  const serviceSource = readFileSync(new URL('../../src/services/ddClient.js', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '').replace(/export /g, '')
  class Xhr {
    constructor() { this.upload = {}; this.headers = {} }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(name, value) { this.headers[name] = value }
    send(body) { this.body = body; onSend(this) }
  }
  return new Function('getApiBaseUrl', 'getCloudAccountGeneration', 'getAuthHeaders', 'getSessionId', 'isClientPortalBuild', 'XMLHttpRequest', 't', 'getAppLanguage', 'zhDdWorkflow', serviceSource + '\nreturn { ddClientUpload };')(
    () => 'http://127.0.0.1:1234', () => 0, () => ({ 'X-Session-Id': 'local', 'Content-Type': 'application/json' }), () => 'local', () => false, Xhr, translate(locale), () => locale, zh,
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
  assert.equal(sent.headers['X-App-Language'], 'zh-CN')
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
    return new Function('getApiBaseUrl', 'getCloudAccountGeneration', 'getAuthHeaders', 'getSessionId', 'isClientPortalBuild', 'sessionStorage', 'fetch', 't', 'getAppLanguage', 'zhDdWorkflow',
      source + '\nreturn { connectDdClient, listDdClientConnections, removeDdClientConnection, ddClientRead };')(
      () => 'https://case.example', () => 0, () => ({ 'X-Session-Id': 'personal' }), () => 'personal', () => portal, sessionStorage, fetch, translate(), () => 'zh-CN', zh)
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


test('client status labels and submit notices use the selected language', async () => {
  const vm = fixture({}, 'en-US'); const item = { id: 7, status: 'PENDING' }; vm.request = { status: 'PUBLISHED' }
  assert.equal(vm.statusLabel(item), 'To prepare')
  vm.submissions[7] = { reviewStatus: 'UPLOADED', aiStatus: 'PASSED' }
  assert.equal(vm.statusLabel(item), 'Document checks passed')
  vm.submissions[7].reviewStatus = 'APPROVED'
  assert.equal(vm.statusLabel(item), 'Confirmed by lawyer')
  vm.submissions[7] = { reviewStatus: 'UPLOADED', aiStatus: 'MANUAL_REQUIRED' }
  assert.equal(vm.statusLabel(item), 'Awaiting lawyer confirmation')
  vm.submissions[7].appealedAt = '2026-10-21T10:00:00'
  assert.equal(vm.statusLabel(item), 'Lawyer reviewing appeal')
  vm.load = async () => {}; vm.loadHistory = async () => {}; vm.addFiles([new File(['test'], 'proof.pdf')])
  await vm.upload(item)
  assert.equal(vm.notice, 'Documents submitted. You can follow the checks here.')
})

test('English upload error and language header preserve the same retry semantics', async () => {
  let sent; let sends = 0
  const api = transportFixture(xhr => { sent = xhr; sends++; xhr.ontimeout() }, 'en-US')
  await assert.rejects(api.ddClientUpload({ connectionId: 'bound', requestId: 5 }, 7, [], 'retry-en', false), /upload timed out.*files are retained/i)
  assert.equal(sent.headers['X-App-Language'], 'en-US'); assert.equal(sent.headers['X-Session-Id'], 'local')
  assert.equal(sent.body.get('idempotencyKey'), 'retry-en'); assert.equal(sends, 1)
})


test('returning to the materials list keeps the active form and reopening does not toggle it closed', async () => {
  const vm = fixture(); const item = { id: 7 }; vm.items = [item]
  await vm.selectItem(item); vm.addFiles([{ name: 'selected.pdf' }]); vm.reason = 'draft'; vm.formMode = 'explanation'
  const files = vm.pendingFiles; const key = vm.uploadKey
  vm.showDetails = false; await vm.selectItem(item)
  assert.equal(vm.showDetails, true); assert.equal(vm.selectedId, 7); assert.equal(vm.pendingFiles, files)
  assert.equal(vm.uploadKey, key); assert.equal(vm.reason, 'draft'); assert.equal(vm.formMode, 'explanation')
})

test('one pending upload locks other materials and ignores callbacks after its request changes', async () => {
  let finish, progress, calls = 0; const captured = []
  const vm = fixture({ upload: (scope, itemId, files, key, consent, notify) => { calls++; captured.push([scope, itemId]); progress = notify; return new Promise(resolve => { finish = resolve }) } })
  const item = { id: 7 }; vm.request = { status: 'PUBLISHED' }; vm.items = [item]; await vm.selectItem(item); vm.addFiles([{ name: 'original.pdf' }])
  const pending = vm.upload(item); await vm.upload(item); await vm.selectItem({ id: 8 })
  assert.equal(calls, 1); assert.equal(vm.selectedId, 7); progress(45); assert.equal(vm.uploadProgress, 45)
  vm.requestId = 3; vm.reset(); vm.pendingFiles = [{ name: 'new-request.pdf' }]; vm.reason = 'new draft'
  progress(100); finish(); await pending
  assert.deepEqual(captured, [[{ connectionId: 'client-one', requestId: 1, projectId: 2 }, 7]])
  assert.equal(vm.uploadProgress, null); assert.equal(vm.pendingFiles[0].name, 'new-request.pdf'); assert.equal(vm.reason, 'new draft'); assert.equal(vm.notice, '')
})

test('workspace prevents connection, request, refresh and notification navigation during submission', async () => {
  const calls = []; const vm = navigationFixture(async (...args) => { calls.push(args); return [] })
  vm.selectedId = 'client-one'; vm.requestId = 4; vm.requests = [{ id: 4 }, { id: 5 }]; vm.submissionBusy = true
  vm.selectConnection('client-two'); vm.selectRequest(5); await vm.loadRequests(); await vm.openNotification({ connectionId: 'client-two', requestId: 5 })
  assert.equal(vm.selectedId, 'client-one'); assert.equal(vm.requestId, 4); assert.equal(calls.length, 0)
  vm.navigationTarget = { connectionId: 'client-two', projectId: 3, requestId: 5 }
  await vm.applyNavigationTarget(); assert.equal(vm.selectedId, 'client-one'); assert.equal(vm.pendingNavigation, true)
})
