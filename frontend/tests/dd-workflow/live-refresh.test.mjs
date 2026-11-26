// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C21: a client's portal submission must reach the lawyer's open checklist without pressing 刷新.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ddRequestSignals } from '../../src/utils/ddWorkflow.js'
import { createEditor, detail } from './editor-harness.mjs'

test('ddRequestSignals keeps the newest notice id per checklist and is stable when nothing is new', () => {
  const first = ddRequestSignals({}, [{ id: 3, requestId: 1 }, { id: 9, requestId: 1 }, { id: 4, requestId: 2 }])
  assert.deepEqual(first, { 1: '9', 2: '4' })
  assert.equal(ddRequestSignals(first, [{ id: 9, requestId: 1 }]), first, 'unchanged input returns the same object')
  assert.equal(ddRequestSignals(first, []), first, 'reading notices never moves a signal back')
  assert.deepEqual(ddRequestSignals(first, [{ id: 12, requestId: 2 }]), { 1: '9', 2: '12' })
  assert.equal(ddRequestSignals(first, [{ id: 5, requestId: null }, null]), first, 'notices without a checklist are ignored')
})

test('an open lawyer checklist reloads when a new notice arrives for it', async () => {
  let loads = 0
  const { vm, options } = createEditor({ api: { getDdRequestDetails: async () => { loads++; return detail() } } })
  await vm.fetchData()
  assert.equal(loads, 1)
  await options.watch.remoteSignal.call(vm, '12', '9')
  assert.equal(loads, 2)
})

test('the reload waits while the lawyer is busy or has unsaved requirement edits', async () => {
  let loads = 0
  const { vm, options } = createEditor({ api: { getDdRequestDetails: async () => { loads++; return detail() } } })
  await vm.fetchData()
  vm.itemTitle = '改了一半'
  await options.watch.remoteSignal.call(vm, '12', '9')
  vm.itemTitle = vm.selected.title
  vm.busy = true
  await options.watch.remoteSignal.call(vm, '13', '12')
  assert.equal(loads, 1, 'no reload over unsaved edits or a running action (those end with their own reload)')
})

test('the client view ignores lawyer signals', async () => {
  let loads = 0
  const { vm, options } = createEditor({ props: { clientView: true }, api: { getDdRequestDetails: async () => { loads++; return detail() } } })
  await options.watch.remoteSignal.call(vm, '12', null)
  assert.equal(loads, 0)
})

test('project overview passes the signal to both editor panes and refreshes the list on new notices', () => {
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  assert.match(page, /:remote-signal="ddRequestSignals\[String\(activeFileLeft\.requestId\)\]"/)
  assert.match(page, /:remote-signal="ddRequestSignals\[String\(activeFileRight\.requestId\)\]"/)
  const poll = page.slice(page.indexOf('async pollDdClientInbox()'), page.indexOf('async readDdLawyerNotification('))
  assert.match(poll, /ddRequestSignals\(this\.ddRequestSignals, unread\)/)
  assert.match(poll, /this\.\$refs\.ddFilesPanel\?\.fetchRequests\(\)/)
})
