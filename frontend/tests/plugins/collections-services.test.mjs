// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/utils/pluginCollectionServices.js', import.meta.url), 'utf8')
const body = source.replace(/^import[\s\S]*?from '[^']*'\n/gm, '').replace(/^export /gm, '') + '\nreturn createPluginCollectionServices'
const envelope = data => ({ code: 0, data })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup(overrides = {}, config = {}) {
  const calls = [], emitted = []
  let project = config.global ? null : 7, current = true, permissions = ['tasks', 'file_read', 'file_write', 'clipboard', 'editor']
  const record = name => async (...args) => { calls.push([name, ...args]); return { id: 31, projectId: 7, ...args[0] } }
  const deps = {
    getTaskProjectOptions: async () => [{ id: 7, name: 'A', myRole: 'OWNER' }, { id: 8, name: 'B', myRole: 'PARTICIPANT' }, { id: 9, name: 'R', myRole: 'VIEWER' }],
    getProjectTasks: async pid => envelope({ tasks: [{ id: 31, projectId: Number(pid), title: 'Task' }] }),
    getCalendarTasks: async () => envelope({ tasks: [{ id: 31, projectId: 7 }, { id: 32, projectId: 8 }, { id: 39, projectId: 9 }] }),
    getCalendarSummary: async () => envelope({ today: 2 }),
    getProjectFiles: async pid => [{ id: Number(pid) * 10, name: 'Contract', parentId: null }],
    getProjectMembers: async () => envelope([{ userId: 1, displayName: 'Member' }]),
    getProjectFavorites: async () => [{ id: 11, content: 'Body', sourceUrl: 'https://example.test/page', imagePath: '/private/image', token: 'SECRET' }, { id: 12, content: '', imagePath: '/private/image' }],
    deleteFavorite: record('deleteFavorite'),
    listClipboard: async () => ({ items: [{ id: 21, type: 'TEXT', text: 'Clipboard', url: 'http://localhost/file?token=SECRET' }, { id: 22, type: 'IMAGE', path: '/private/image' }], limited: true, hiddenCount: 5 }),
    deleteClipboardItem: record('deleteClipboardItem'),
    getApiBaseUrl: () => 'https://host.test', getSessionId: () => 'SECRET',
    purchaseFeatureSku: record('purchaseFeatureSku'), refreshEntitlements: record('refreshEntitlements'),
    createTask: record('createTask'), updateTask: record('updateTask'), deleteTask: record('deleteTask'),
    t: key => key,
    uni: { $emit: (...args) => emitted.push(args), showToast: record('toast'), showModal: ({ success }) => success({ confirm: true }) },
    fetch: async (url, options) => { calls.push(['fetch', url, options]); return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { 'content-type': 'image/png' } }) },
    ...overrides,
  }
  const make = new Function(...Object.keys(deps), body)(...Object.values(deps))
  const service = make({ projectId: () => project, permissions: () => permissions, isCurrent: () => current,
    listFiles: async () => [{ id: 70, name: 'Contract' }, { id: 71, name: 'Folder', isFolder: true }],
    openFile: record('openFile'), actions: Object.fromEntries(['insertContent', 'previewImage', 'openBrowser', 'copyText', 'openProject', 'openTaskFile', 'openAccount'].map(name => [name, record(name)])) })
  return { ...service, calls, emitted, project: value => { project = value }, current: value => { current = value }, permissions: value => { permissions = value } }
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code)

test('calendar global and scoped reads preserve API envelopes and restrict scope', async () => {
  const local = setup()
  assert.deepEqual(await local.request('calendar', 'projects'), [{ id: 7, name: 'A', myRole: 'OWNER' }])
  assert.equal((await local.request('calendar', 'list')).data.tasks[0].projectId, 7)
  await rejects(local.request('calendar', 'projectTasks', { projectId: 8 }), 'permission_denied')
  await rejects(local.request('calendar', 'update', { id: 32, data: { status: 'DONE' } }), 'not_found')
  const global = setup({}, { global: true })
  assert.equal((await global.request('calendar', 'list')).data.tasks.length, 3)
  assert.equal((await global.request('calendar', 'summary')).data.today, 2)
  assert.equal((await global.request('calendar', 'files', { projectId: 8 }))[0].id, 80)
  await rejects(global.request('calendar', 'files', { projectId: 99 }), 'permission_denied')
})
test('calendar create/update/delete use host taskStore and strip cross-project and unsupported fields', async () => {
  const s = setup()
  await s.request('calendar', 'create', { data: { projectId: 7, title: 'New', fileIds: [70], remindBefore: 15, assigneeId: 1, arbitrary: 'bad' } })
  assert.deepEqual(s.calls[0], ['createTask', { title: 'New', assigneeId: 1, remindBefore: 15, fileIds: [70], projectId: 7 }])
  await s.request('calendar', 'update', { id: 31, data: { projectId: 8, dueDate: '2026-10-20', status: 'DONE' } })
  assert.deepEqual(s.calls[1], ['updateTask', '31', { dueDate: '2026-10-20', status: 'DONE' }])
  await s.request('calendar', 'delete', { id: 31 })
  assert.deepEqual(s.calls[2], ['deleteTask', '31'])
  await rejects(s.request('calendar', 'create', { data: { projectId: 7, title: 'bad', fileIds: [80] } }), 'permission_denied')
  await rejects(s.request('calendar', 'create', { data: { projectId: 7, title: 'bad', fileIds: [71] } }), 'permission_denied')
  await rejects(setup({}, { global: true }).request('calendar', 'delete', { id: 39 }), 'permission_denied')
})
test('calendar verified files, members and navigation preserve global project routing', async () => {
  const s = setup({}, { global: true })
  assert.equal((await s.request('calendar', 'members', { projectId: 8 })).data[0].userId, 1)
  await s.request('calendar', 'openProject', { projectId: 8 })
  await s.request('calendar', 'openFile', { projectId: 8, fileId: 80 })
  assert.deepEqual(s.calls, [['openProject', { projectId: 8 }], ['openTaskFile', { projectId: 8, fileId: 80 }]])
  await rejects(s.request('calendar', 'openFile', { projectId: 8, fileId: 70 }), 'not_found')
  const local = setup(); await local.request('calendar', 'openFile', { projectId: 7, fileId: 70 })
  assert.equal(local.calls[0][0], 'openFile')
})
test('favorites and clipboard list scrub host paths and private URLs, retain quota', async () => {
  const s = setup()
  const favorites = await s.request('favorites', 'list')
  assert.equal(favorites[0].imagePath, 'image')
  assert.equal(JSON.stringify(favorites).includes('SECRET'), false)
  assert.equal(JSON.stringify(favorites).includes('/private'), false)
  const clipboard = await s.request('clipboard', 'list')
  assert.equal(clipboard.hiddenCount, 5)
  assert.equal(clipboard.limited, true)
  assert.equal(JSON.stringify(clipboard).includes('SECRET'), false)
  await rejects(setup({}, { global: true }).request('favorites', 'list'), 'invalid_params')
})
test('collection operations resolve host-verified item content instead of iframe payload', async () => {
  const s = setup(); await s.request('favorites', 'list'); await s.request('clipboard', 'list')
  await s.request('favorites', 'copy', { id: 11, content: 'Forged' })
  await s.request('favorites', 'insert', { id: 11, content: 'Forged' })
  await s.request('favorites', 'open', { id: 11, url: 'javascript:bad' })
  await s.request('clipboard', 'copy', { id: 21 })
  await s.request('clipboard', 'insert', { id: 21 })
  assert.deepEqual(s.calls, [['copyText', 'https://example.test/page'], ['insertContent', { type: 'TEXT', content: 'Body' }], ['openBrowser', 'https://example.test/page'], ['copyText', 'Clipboard'], ['insertContent', { type: 'TEXT', content: 'Clipboard' }]])
  await rejects(s.request('favorites', 'delete', { id: 999 }), 'not_found')
  await s.request('favorites', 'delete', { id: 11 }); await s.request('clipboard', 'delete', { id: 21 })
  assert.deepEqual(s.emitted.map(event => event[0]), ['awd:favorites-changed', 'awd:clipboard-saved'])
  await rejects(s.request('favorites', 'insert', { id: 11 }), 'not_found')
})
test('image read/insert/preview uses fixed authenticated host endpoint and returns only image bytes', async () => {
  const s = setup(); await s.request('favorites', 'list'); await s.request('clipboard', 'list')
  const image = await s.request('favorites', 'image', { id: 12, url: 'https://attacker.test' })
  assert.deepEqual(image, { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
  assert.equal(s.calls[0][1], 'https://host.test/api/favorites/12/image')
  assert.equal(s.calls[0][2].headers['X-Session-Id'], 'SECRET')
  await s.request('favorites', 'insert', { id: 12 })
  await s.request('clipboard', 'preview', { id: 22 })
  assert.ok(s.calls.some(call => call[0] === 'insertContent' && call[1].type === 'IMAGE'))
  assert.ok(s.calls.some(call => call[0] === 'previewImage' && call[1] === image.dataUrl))
  await rejects(s.request('clipboard', 'image', { id: 21 }), 'invalid_params')
  const invalid = setup({ fetch: async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }) })
  await invalid.request('clipboard', 'list'); await rejects(invalid.request('clipboard', 'image', { id: 22 }), 'invalid_data')
})
test('permissions, unknown operations and cache scope cannot be bypassed', async () => {
  const s = setup(); await s.request('favorites', 'list')
  s.permissions(['file_read'])
  await rejects(s.request('favorites', 'delete', { id: 11 }), 'permission_denied')
  await rejects(s.request('favorites', 'insert', { id: 11 }), 'permission_denied')
  await rejects(s.request('favorites', 'copy', { id: 11 }), 'permission_denied')
  await rejects(s.request('calendar', 'list'), 'permission_denied')
  await rejects(s.request('clipboard', 'list'), 'permission_denied')
  await rejects(s.request('favorites', 'arbitrary'), 'unknown_method')
  s.project(8); await rejects(s.request('favorites', 'image', { id: 11 }), 'not_found')
})
test('abort, unmount, project change and permission removal during validation prevent writes', async () => {
  for (const invalidate of ['abort', 'unmount', 'project', 'permission']) {
    const gate = deferred()
    const s = setup({ getProjectTasks: () => gate.promise })
    const controller = new AbortController()
    const promise = s.request('calendar', 'update', { id: 31, data: { status: 'DONE' } }, controller.signal)
    if (invalidate === 'abort') controller.abort()
    if (invalidate === 'unmount') s.current(false)
    if (invalidate === 'project') s.project(8)
    if (invalidate === 'permission') s.permissions([])
    gate.resolve(envelope({ tasks: [{ id: 31, projectId: 7 }] }))
    await rejects(promise, invalidate === 'permission' ? 'permission_denied' : 'cancelled')
    assert.equal(s.calls.length, 0)
  }
})
test('clipboard purchase requires host confirmation, fixed SKU, refreshes entitlements and supports cancel', async () => {
  const s = setup()
  assert.deepEqual(await s.request('clipboard', 'purchase', { skuId: 'forged' }), { purchased: true })
  assert.deepEqual(s.calls[0], ['purchaseFeatureSku', 'feature:clipboard.unlimited'])
  assert.equal(s.calls[1][0], 'refreshEntitlements')
  assert.deepEqual(s.emitted.map(event => event[0]), ['awd:wallet-refresh', 'awd:entitlements-changed'])
  const cancelled = setup({ uni: { showModal: ({ success }) => success({ confirm: false }) } })
  assert.deepEqual(await cancelled.request('clipboard', 'purchase'), { cancelled: true })
  assert.equal(cancelled.calls.length, 0)
})
test('aborted confirmation never purchases; duplicate purchase waits on one host prompt', async () => {
  let confirm
  const s = setup({ uni: { showModal: ({ success }) => { confirm = success } } })
  const controller = new AbortController()
  const pending = s.request('clipboard', 'purchase', {}, controller.signal)
  await rejects(s.request('clipboard', 'purchase'), 'busy')
  controller.abort(); confirm({ confirm: true })
  await rejects(pending, 'cancelled')
  assert.equal(s.calls.length, 0)
})
test('insufficient credits offers trusted account navigation; already owned refreshes', async () => {
  const s = setup({ purchaseFeatureSku: async () => { throw Object.assign(new Error('balance'), { reason: 'insufficient_credits' }) } })
  assert.deepEqual(await s.request('clipboard', 'purchase'), { purchased: false })
  assert.deepEqual(s.calls, [['openAccount', undefined]])
  const owned = setup({ purchaseFeatureSku: async () => { throw Object.assign(new Error('owned'), { reason: 'already_owned' }) } })
  assert.deepEqual(await owned.request('clipboard', 'purchase'), { purchased: true })
  assert.equal(owned.calls[0][0], 'refreshEntitlements')
})

test('older backend octet-stream raster images work; declared MIME cannot disguise non-image bytes', async () => {
  const webp = setup({ fetch: async () => new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), { headers: { 'content-type': 'application/octet-stream' } }) })
  await webp.request('clipboard', 'list')
  assert.match((await webp.request('clipboard', 'image', { id: 22 })).dataUrl, /^data:image\/webp;base64,/)
  const forged = setup({ fetch: async () => new Response('<html>not an image</html>', { headers: { 'content-type': 'image/png' } }) })
  await forged.request('clipboard', 'list')
  await rejects(forged.request('clipboard', 'image', { id: 22 }), 'invalid_data')
})
test('image stream enforces byte cap without a content-length and cancels the reader', async () => {
  let cancelled = false
  const s = setup({ fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(11 * 1024 * 1024)) },
    cancel() { cancelled = true },
  }), { headers: { 'content-type': 'image/png' } }) })
  await s.request('clipboard', 'list')
  await rejects(s.request('clipboard', 'image', { id: 22 }), 'quota_exceeded')
  assert.equal(cancelled, true)
})
test('image completion after abort cannot trigger document insertion', async () => {
  const gate = deferred(), s = setup({ fetch: () => gate.promise })
  await s.request('clipboard', 'list')
  const controller = new AbortController()
  const pending = s.request('clipboard', 'insert', { id: 22 }, controller.signal)
  controller.abort()
  gate.resolve(new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])))
  await rejects(pending, 'cancelled')
  assert.equal(s.calls.some(call => call[0] === 'insertContent'), false)
})
test('calendar file/member output contains only selector metadata', async () => {
  const s = setup({
    getProjectFiles: async () => [{ id: 80, name: 'Contract', parentId: 1, downloadUrl: '/file?token=SECRET', storagePath: '/private' }],
    getProjectMembers: async () => envelope([{ userId: 1, displayName: 'Member', role: 'OWNER', email: 'private@example.invalid', phone: 'private' }]),
  }, { global: true })
  assert.deepEqual(await s.request('calendar', 'files', { projectId: 8 }), [{ id: 80, name: 'Contract', parentId: 1 }])
  assert.deepEqual((await s.request('calendar', 'members', { projectId: 8 })).data, [{ userId: 1, displayName: 'Member', role: 'OWNER' }])
})

// Existing deleted links remain visible as deleted chips in TaskDialog. Editing
// another field must preserve them; only newly associated IDs need a live file.
test('calendar edits retain verified existing soft-deleted file associations', async () => {
  for (const links of [{ files: [{ fileId: 79, fileName: null }] }, { fileId: 79 }]) {
    const s = setup({ getProjectTasks: async () => envelope({ tasks: [{ id: 31, projectId: 7, ...links }] }) })
    await s.request('calendar', 'update', { id: 31, data: { title: 'Revised', fileIds: [79, 70] } })
    assert.deepEqual(s.calls, [['updateTask', '31', { title: 'Revised', fileIds: [79, 70] }]])
    await rejects(s.request('calendar', 'update', { id: 31, data: { fileIds: [79, 80] } }), 'permission_denied')
    await rejects(s.request('calendar', 'create', { data: { projectId: 7, title: 'New', fileIds: [79] } }), 'permission_denied')
  }
})

test('scoped calendar retains directory metadata instead of SDK flat file projection', async () => {
  const tree = [{ id: 70, name: 'Contract', parentId: 71 }, { id: 71, name: 'Evidence', isFolder: true }, { id: 72, name: '__staging_area__', isFolder: true }, { id: 73, name: 'Hidden', parentId: 72 }]
  const s = setup({ getProjectFiles: async () => tree })
  assert.deepEqual(await s.request('calendar', 'files', { projectId: 7 }), tree)
})
