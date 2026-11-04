// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inspectExitProject, commitExitProjects, pendingExitProjects, settleExitCommit } from '../../src/utils/projectExitState.js'
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
  const component = new Function('getMyProjects', 'getVersionExitStatus', 'endWorkSession', 'inspectExitProject', 'commitExitProjects', 'pendingExitProjects', 'settleExitCommit', script)(
    () => new Promise(resolve => { resolveProjects = resolve }),
    async id => ({ data: committed.includes(id) ? clean : pending }),
    async id => { committed.push(id); return { data: { receiptState: 'SUCCEEDED', sha: 'receipt', notice: '' } } },
    inspectExitProject, commitExitProjects, pendingExitProjects, settleExitCommit,
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
  assert.equal(choices.length, 2)
  assert.ok(choices.every(input => !input.checked))
  assert.match(root.textContent, /pendingFileCount:4/)
  choices[1].checked = true
  choices[1].dispatchEvent(new window.Event('change', { bubbles: true }))
  await Vue.nextTick()
  const submit = [...root.querySelectorAll('button')].find(b => b.textContent.includes('exitProjectsCommit'))
  assert.equal(submit.disabled, false)
  submit.click()
  await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick()
  assert.deepEqual(committed, [2]); assert.equal(result, true)
  app.unmount(); root.remove(); dom.window.close()
})
