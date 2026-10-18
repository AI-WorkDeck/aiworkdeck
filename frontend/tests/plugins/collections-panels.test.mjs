// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parse, compileTemplate } = require('@vue/compiler-sfc')
const root = new URL('../../plugin-app/', import.meta.url)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function source(path) { return readFileSync(new URL(path, root), 'utf8') }
function component(path, deps = {}) {
  const descriptor = parse(source(path)).descriptor
  const names = []
  const script = descriptor.script.content.replace(/^import\s+([\s\S]*?)\s+from ['"][^'"]+['"]\s*$/gm, (_, spec) => {
    if (spec.trim().startsWith('{')) names.push(...spec.replace(/[{}]/g, '').split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean))
    else names.push(spec.trim())
    return ''
  }).replace('export default', 'return')
  const all = { ...Object.fromEntries(names.map(name => [name, {}])), uni: { showToast() {}, $emit() {} }, ...deps }
  return new Function(...Object.keys(all), script)(...Object.values(all))
}
function vm(options, props = {}) {
  const result = { ...props, $t: key => key, $emit() {} }
  Object.assign(result, options.data?.call(result))
  for (const [name, method] of Object.entries(options.methods || {})) result[name] = method.bind(result)
  return result
}
function api(name, request, awd = { events: { on() {} } }) {
  const s = source(name + '/api.js').replace(/^import.*\n/gm, '').replace(/^export /gm, '')
  const exports = [...s.matchAll(/^const (\w+)/gm)].map(m => m[1])
  return new Function('request', 'window', s + '\nreturn { ' + exports.join(',') + ' }')(request, { awd })
}

test('all migrated Vue templates compile, with no host credential/native module imports', () => {
  for (const path of ['calendar/Panel.vue', 'calendar/TaskDialog.vue', 'calendar/FilePickerDialog.vue', 'favorites/Panel.vue', 'favorites/SafeImage.vue', 'clipboard/Panel.vue', 'clipboard/SafeImage.vue', 'clipboard/UnlockHint.vue']) {
    const text = source(path)
    const { descriptor, errors } = parse(text, { filename: path })
    assert.deepEqual(errors, [])
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: path, id: path }).errors, [], path)
    assert.doesNotMatch(text, /from ['"]@\/(?:services\/host|utils\/auth)|getSessionId|token=/)
    component(path)
  }
})
test('calendar API preserves all store/task dialog mappings through services bridge', async () => {
  const calls = [], a = api('calendar', async (...args) => { calls.push(args); return { value: 'host' } })
  await a.getTaskProjectOptions(); await a.getCalendarTasks('2026-10-01', '2026-10-31'); await a.getCalendarSummary()
  await a.getProjectTasks(7, { fileId: 70 }); await a.getProjectFiles(7, null, true); await a.getProjectMembers(7)
  await a.createTask({ projectId: 7, title: 'Task' }); await a.updateTask(31, { status: 'DONE' }); await a.deleteTask(31)
  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ['calendar', 'projects', {}], ['calendar', 'list', { from: '2026-10-01', to: '2026-10-31' }], ['calendar', 'summary', {}],
    ['calendar', 'projectTasks', { projectId: 7, fileId: 70 }], ['calendar', 'files', { projectId: 7 }], ['calendar', 'members', { projectId: 7 }],
    ['calendar', 'create', { data: { projectId: 7, title: 'Task' } }], ['calendar', 'update', { id: 31, data: { status: 'DONE' } }], ['calendar', 'delete', { id: 31 }],
  ])
})
test('collection adapters preserve request options and subscribe with cleanup', async () => {
  const calls = [], subscriptions = [], off = () => {}
  for (const name of ['favorites', 'clipboard']) {
    const a = api(name, (...args) => { calls.push(args); return Promise.resolve([]) }, { events: { on: (...args) => { subscriptions.push(args); return off } } })
    if (name === 'favorites') { await a.getProjectFavorites(7, 'contract'); await a.deleteFavorite(11) }
    else { await a.listClipboard('contract'); await a.deleteClipboardItem(21) }
    const options = { signal: new AbortController().signal }
    await a.perform('image', { id: 22 }, options)
    assert.equal(calls.at(-1)[3], options)
    assert.equal(a.subscribe(() => {}), off)
    assert.equal(subscriptions.at(-1)[0], name + '.changed')
  }
})
test('favorites copied actions use item IDs, deletion forces refresh within throttle and handles empty results', async () => {
  const calls = []
  const c = component('favorites/Panel.vue', {
    perform: async (...args) => { calls.push(args); return { ok: true } },
    getProjectFavorites: async () => [], deleteFavorite: async id => calls.push(['delete', id]), shouldAcceptResponse: (a, b) => a === b,
  })
  const s = vm(c, { projectId: 7 })
  s._lastRefreshAt = Date.now(); s._lastRefreshQuery = ''
  await s.insertFav({ id: 11, content: 'client content' }); await s.copyFav({ id: 11 }); await s.openUrl({ id: 11 })
  assert.deepEqual(calls.slice(0, 3), [['insert', { id: 11 }], ['copy', { id: 11 }], ['open', { id: 11 }]])
  s.items = [{ id: 11 }]; s.confirmDeleteId = 11
  await s.confirmDelete(11)
  assert.deepEqual(s.items, []); assert.equal(s.confirmDeleteId, null)
})
test('clipboard preserves quota and delete-confirm card guard, insert/copy/preview routes', async () => {
  const calls = []
  const c = component('clipboard/Panel.vue', { perform: async (...args) => { calls.push(args); return { ok: true } }, listClipboard: async () => ({ items: [{ id: 21, type: 'TEXT', text: 'body' }], limited: true, hiddenCount: 3 }), shouldAcceptResponse: (a, b) => a === b })
  const s = vm(c), item = { id: 21, type: 'TEXT', text: 'body' }
  await s.refresh(); assert.equal(s.hiddenCount, 3); assert.equal(s.items[0].id, 21)
  s.confirmDeleteId = 21; await s.onCardTap(item); assert.equal(calls.length, 0); assert.equal(s.confirmDeleteId, null)
  s.deletingId = 21; await s.onCardTap(item); assert.equal(calls.length, 0)
  s.deletingId = null; await s.onCardTap(item); await s.insertItem(item); await s.previewImage({ id: 22, type: 'IMAGE' })
  assert.deepEqual(calls, [['copy', { id: 21 }], ['insert', { id: 21 }], ['preview', { id: 22 }]])
})
test('image component rejects a late result after unmount or item change', async () => {
  const gates = [deferred(), deferred()]; let index = 0
  const c = component('clipboard/SafeImage.vue', { perform: () => gates[index++].promise })
  const s = vm(c)
  const first = c.watch.itemId.handler.call(s, 1), second = c.watch.itemId.handler.call(s, 2)
  gates[0].resolve({ dataUrl: 'old' }); await first; assert.equal(s.url, '')
  gates[1].resolve({ dataUrl: 'new' }); await second; assert.equal(s.url, 'new')
  c.beforeUnmount.call(s); assert.equal(s.controller.signal.aborted, true)
})
test('calendar file picker ignores response for prior project and emits selected verified file', async () => {
  const gates = [deferred(), deferred()]; let index = 0
  const c = component('calendar/FilePickerDialog.vue', { perform: () => gates[index++].promise })
  const s = vm(c, { projectId: 7 }), events = []; s.$emit = (...args) => events.push(args)
  const first = s.load(); s.projectId = 8; const second = s.load()
  gates[0].resolve([{ id: 70 }]); await first; assert.deepEqual(s.files, [])
  gates[1].resolve([{ id: 80, name: 'B' }]); await second; assert.equal(s.files[0].id, 80)
  s.choose(s.files[0]); assert.deepEqual(events, [['confirm', { id: 80, name: 'B' }], ['update:visible', false]])
})
test('calendar navigation crosses only through fixed operations and closes dialog on success', async () => {
  const calls = [], c = component('calendar/Panel.vue', { perform: async (...args) => calls.push(args) })
  const s = vm(c); s.dialogVisible = true
  await s.onOpenFile({ task: { projectId: 8 }, fileId: 80 }); assert.equal(s.dialogVisible, false)
  await s.goToProject(8)
  assert.deepEqual(calls, [['openFile', { projectId: 8, fileId: 80 }], ['openProject', { projectId: 8 }]])
  assert.equal(c.computed.scopedProjectId.call({ projectId: 0 }), null)
})
test('one-click unlock passes purchase to host once and remains retryable after completion', async () => {
  const gate = deferred(), calls = []
  const c = component('clipboard/UnlockHint.vue', { t: key => key, perform: (...args) => { calls.push(args); return gate.promise } })
  const s = vm(c), first = s.onPurchase(); await s.onPurchase()
  assert.equal(calls.length, 1); assert.equal(s.purchasing, true)
  gate.resolve({ cancelled: true }); await first; assert.equal(s.purchasing, false)
  assert.deepEqual(calls[0], ['purchase', {}, { timeoutMs: 120000 }])
})
