// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inspectExitProject, commitExitProjects, pendingExitProjects, settleExitCommit, selectExitProjectRows } from '../../src/utils/projectExitState.js'
import { shouldScanProjectsOnExit, setScanProjectsOnExit } from '../../src/utils/projectExitPreferences.js'
const pending = { receiptEpoch: 'test-epoch', enabled: true, canCommit: true, working: true, changedCount: 4 }
const clean = { receiptEpoch: 'test-epoch', enabled: true, canCommit: false, working: false, changedCount: 0 }
const row = id => ({ id, receiptEpoch: 'test-epoch', name: `Project ${id}`, state: 'ready', count: 4, selected: true })
test('scan preserves failures, conflicts and working snapshots; filters clean/read-only projects', async () => {
  const r = row(1)
  await inspectExitProject(r, async () => pending)
  assert.equal(r.count, 4); assert.equal(r.state, 'ready')
  await inspectExitProject(r, async () => { throw Error('timeout') })
  assert.equal(r.state, 'failed')
  await inspectExitProject(r, async () => ({ ...pending, canCommit: false, conflict: true }))
  assert.equal(r.state, 'conflict')
  await inspectExitProject(r, async () => ({ ...pending, canCommit: false }))
  assert.equal(r.state, 'empty')
  await inspectExitProject(r, async () => clean)
  assert.equal(r.state, 'empty')
  await inspectExitProject(r, async () => ({ ...pending, changedCount: 0 }))
  assert.equal(r.state, 'empty', 'an empty work session is not a file change')
  await inspectExitProject(r, async () => ({ ...pending, changedCount: 0, conflict: true }))
  assert.equal(r.state, 'conflict', 'conflicts remain visible even with no counted files')
})
test('partial failures do not repeat successful projects; retry requires an explicit new selection', async () => {
  const rows = [row(1), row(2), { ...row(3), selected: false }], calls = []
  assert.equal(await commitExitProjects(rows, async id => { calls.push(id); if (id === 2) return { receiptState: 'FAILED' }; return { receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' } }, async id => id === 1 ? clean : pending), false)
  assert.deepEqual(calls, [1, 2]); assert.equal(rows[0].state, 'committed')
  assert.equal(rows[1].selected, false); assert.equal(rows[1].state, 'ready')
  rows[1].selected = true
  assert.equal(await commitExitProjects(rows, async id => { calls.push(id); return { receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' } }, async () => clean), true)
  assert.deepEqual(calls, [1, 2, 2])
})
test('unknown receipt survives reopening and only the same request terminal receipt clears it', async () => {
  const r = row(41), ids = []
  assert.equal(await commitExitProjects([r], async (id, requestId) => { ids.push(requestId); throw Error('network') }, async () => clean), false)
  assert.equal(r.state, 'uncertain'); assert.equal(r.selected, false)
  const reopened = pendingExitProjects().find(row => row.id === 41)
  assert.equal(reopened.name, undefined, 'pending receipts do not retain previous account names')
  assert.equal(reopened.count, undefined, 'pending receipts do not retain previous account counts')
  await inspectExitProject(reopened, () => assert.fail('status snapshot is not a terminal receipt'))
  assert.equal(reopened.state, 'uncertain')
  assert.equal(await settleExitCommit(reopened, async (id, requestId) => { ids.push(requestId); return { receiptState: 'RUNNING' } }, async () => clean), false)
  assert.equal(reopened.state, 'uncertain')
  assert.equal(await settleExitCommit(reopened, async (id, requestId) => { ids.push(requestId); return { receiptState: 'UNKNOWN' } }, () => assert.fail('old backend epoch is not proof of completion')), false)
  assert.equal(reopened.state, 'uncertain')
  assert.equal(await settleExitCommit(reopened, async (id, requestId) => { ids.push(requestId); return { receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' } }, async () => clean), true)
  assert.equal(new Set(ids).size, 1)
  assert.equal(pendingExitProjects().length, 0)
})
test('verification failures and new edits keep the dialog open, not falsely claiming success', async () => {
  const r = row(1)
  assert.equal(await commitExitProjects([r], async () => ({ receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' }), async () => { throw Error('offline') }), false)
  assert.equal(r.state, 'failed'); assert.equal(r.selected, false)
  const changed = row(2)
  assert.equal(await commitExitProjects([changed], async () => ({ receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' }), async () => pending), false)
  assert.equal(changed.state, 'ready')
})
test('cancelled quit does not start another commit', async () => {
  assert.equal(await commitExitProjects([row(1)], () => assert.fail('commit after cancellation'), () => clean, () => false), false)
})
test('global quit uses one project chooser; project switching retains save barrier without commit prompt', () => {
  const app = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /confirm: confirmProjectExit/)
  const overview = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  const leave = overview.split('async leaveWorkbench(url, options) {')[1].split('\n    },')[0]
  assert.match(leave, /await flushDirtyEditors/)
  assert.doesNotMatch(leave, /confirmVersionBeforeLeaving/)
  assert.match(overview.split('async handleLogout() {')[1].split('\n    },')[0], /confirmVersionBeforeLeaving/)
})

test('malformed commit and status replies cannot authorize exit', async () => {
  const r = row(1)
  assert.equal(await commitExitProjects([r], async () => undefined, async () => pending), false)
  assert.equal(r.state, 'uncertain')
  await settleExitCommit(r, async () => ({ receiptState: 'FAILED' }), async () => pending)
  r.selected = true
  assert.equal(await commitExitProjects([r], async () => ({ receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' }), async () => ({})), false)
  assert.equal(r.state, 'failed')
})

test('real Vue chooser loads asynchronously, starts unchecked and commits only checked project', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<body></body>')
  for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key]
  const Vue = await import('vue')
  const { parse } = await import('@vue/compiler-sfc')
  const { compile } = await import('@vue/compiler-dom')
  const { descriptor } = parse(readFileSync(new URL('../../src/components/version/ProjectExitDialog.vue', import.meta.url), 'utf8'))
  const script = descriptor.script.content.replace(/import[^\n]+\n/g, '').replace('export default', 'return')
  let resolveProjects
  const committed = []
  const component = new Function('getMyProjects', 'getVersionExitProjects', 'getVersionExitStatus', 'endWorkSession', 'inspectExitProject', 'commitExitProjects', 'pendingExitProjects', 'settleExitCommit', 'selectExitProjectRows', script)(
    () => new Promise(resolve => { resolveProjects = resolve }),
    async () => ({ projectIds: [2] }),
    async id => ({ data: committed.includes(id) ? clean : pending }),
    async id => { committed.push(id); return { data: { receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' } } },
    inspectExitProject, commitExitProjects, pendingExitProjects, settleExitCommit, selectExitProjectRows,
  )
  component.render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)(Vue)
  const root = document.createElement('div'); document.body.append(root)
  let result
  const app = Vue.createApp(component, { isCurrent: () => true, onClose: accepted => { result = accepted } })
  app.config.globalProperties.$t = (key, args) => args ? `${key}:${args.count}` : key
  app.config.warnHandler = () => {}
  const vm = app.mount(root)
  assert.match(root.textContent, /exitProjectsChecking/)
  resolveProjects({ data: [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }] })
  await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick()
  const choices = [...root.querySelectorAll('input')]
  assert.equal(choices.length, 1, 'untouched projects never enter the scan')
  assert.ok(choices.every(input => !input.checked))
  assert.match(root.textContent, /pendingFileCount:4/)
  choices[0].checked = true
  choices[0].dispatchEvent(new window.Event('change', { bubbles: true }))
  await Vue.nextTick()
  const submit = [...root.querySelectorAll('button')].find(b => b.textContent.includes('exitProjectsCommit'))
  assert.equal(submit.disabled, false)
  submit.click()
  await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick()
  assert.deepEqual(committed, [2]); assert.equal(result, true)
  app.unmount(); root.remove(); dom.window.close()
})

test('logging out cannot bypass an unsettled receipt from a cancelled exit', async () => {
  const source = readFileSync(new URL('../../src/utils/projectExitDialog.js', import.meta.url), 'utf8')
  let pending = false, mounted = 0
  const factory = new Function('isDesktopHost', 'getSessionId', 'pendingExitProjects', 'document', 'setGlobalOverlay', 'createApp', 'ProjectExitDialog', 't',
    'return ' + source.slice(source.indexOf('export function')).replace('export ', ''))
  const confirm = factory(() => false, () => null, () => pending ? [{ id: 41 }] : [], {
    createElement: () => ({ remove() {} }), body: { appendChild() {} }, activeElement: null,
  }, () => {}, (component, props) => ({ config: { globalProperties: {} }, mount() { mounted++; queueMicrotask(() => props.onClose(false)) }, unmount() {} }), {}, key => key)
  assert.equal(await confirm(), true)
  assert.equal(mounted, 0)
  pending = true
  assert.equal(await confirm(), false)
  assert.equal(mounted, 1)
})

test('an empty work session after a terminal receipt does not prevent exit', async () => {
  const r = row(91)
  assert.equal(await commitExitProjects([r], async () => ({ receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' }),
    async () => ({ ...pending, changedCount: 0 })), true)
  assert.equal(r.state, 'committed')
})


test('anonymous desktop quit opens the chooser; only unauthenticated web can skip it', async () => {
  const source = readFileSync(new URL('../../src/utils/projectExitDialog.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace('export function', 'function')
  for (const state of [
    { desktop: true, session: '', receipts: [], expectedMounts: 1 },
    { desktop: false, session: '', receipts: [], expectedMounts: 0 },
    { desktop: false, session: 'signed-in', receipts: [], expectedMounts: 1 },
    { desktop: false, session: '', receipts: [{ id: 1 }], expectedMounts: 1 },
  ]) {
    let mounts = 0, unmounts = 0, finish
    const overlays = []
    const container = { remove() {} }
    const document = { createElement: () => container, body: { appendChild() {} }, activeElement: null }
    const createApp = (_component, props) => {
      finish = props.onClose
      return { config: { globalProperties: {} }, mount() { mounts++ }, unmount() { unmounts++ } }
    }
    const confirm = new Function('createApp', 'ProjectExitDialog', 't', 'pendingExitProjects', 'getSessionId',
      'isDesktopHost', 'setGlobalOverlay', 'shouldScanProjectsOnExit', 'document', source + '; return confirmProjectExit')(
        createApp, {}, key => key, () => state.receipts, () => state.session,
        () => state.desktop, open => overlays.push(open), () => true, document)
    const result = confirm()
    assert.equal(mounts, state.expectedMounts, JSON.stringify(state))
    if (mounts) finish(false)
    assert.equal(await result, !state.expectedMounts)
    assert.equal(unmounts, mounts)
    assert.deepEqual(overlays, mounts ? [true, false] : [])
  }
})

test('only projects changed in this session plus unresolved receipts enter the scan', () => {
  const projects = [
    { id: 1, name: 'Untouched' },
    { id: 2, name: 'Changed' },
    { id: 3, name: 'Scratch', projectType: 'SCRATCH' },
  ]
  const rows = selectExitProjectRows(projects, [2], [{ id: 41, state: 'uncertain' }])
  assert.deepEqual(rows.map(row => row.id), [2, 41])
  assert.equal(rows[0].state, 'checking')
  assert.equal(rows[0].selected, false)
})

test('terminal commit failure retains its actionable reason until a successful retry', async () => {
  const r = row(51)
  assert.equal(await settleExitCommit(r,
    async () => ({ receiptState: 'FAILED', message: '版本正忙，请稍后重试' }), async () => pending), false)
  assert.equal(r.error, '版本正忙，请稍后重试')
  assert.equal(r.state, 'ready')
  assert.equal(await settleExitCommit(r,
    async () => ({ receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' }), async () => clean), true)
  assert.equal(r.error, '')
})

test('exit auto scan preference defaults on and persists an explicit off choice', () => {
  const values = new Map()
  const storage = {
    getStorageSync: key => values.get(key),
    setStorageSync: (key, value) => values.set(key, value),
  }
  assert.equal(shouldScanProjectsOnExit(storage), true)
  setScanProjectsOnExit(false, storage)
  assert.equal(shouldScanProjectsOnExit(storage), false)
  setScanProjectsOnExit(true, storage)
  assert.equal(shouldScanProjectsOnExit(storage), true)
})
