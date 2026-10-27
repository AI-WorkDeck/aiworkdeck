// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEditor, detail, deferred } from '../dd-workflow/editor-harness.mjs'

test('late checklist response cannot replace the newly selected request', async t => {
  const a = deferred(), b = deferred(); let calls = 0
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: () => ++calls === 1 ? a.promise : b.promise } }); t.after(dispose)
  const first = vm.fetchData(); vm.requestId = 2; const second = vm.fetchData()
  b.resolve(detail('B', 2)); await second; a.resolve(detail('A', 1)); await first
  assert.equal(vm.request.id, 2); assert.equal(vm.requestName, 'B'); assert.equal(vm.itemTitle, 'B')
})

test('deleting a loaded draft clears rows and invalidates an in-flight refresh', async t => {
  const gate = deferred(); let calls = 0
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: () => ++calls === 1 ? Promise.resolve(detail()) : gate.promise, deleteDdRequest: async () => {} } }); t.after(dispose)
  await vm.fetchData(); const pending = vm.fetchData(); await vm.deleteRequest(); gate.resolve(detail()); await pending
  assert.equal(vm.request, null); assert.deepEqual(vm.items, []); assert.equal(vm.deleted, true)
  assert.ok(vm.emitted.some(([event, id]) => event === 'deleted' && id === 1))
})

test('cannot rename a deleted draft or edit a published checklist', async t => {
  const calls = []
  const { vm, dispose } = createEditor({ api: { updateDdRequest: (...args) => calls.push(args) } }); t.after(dispose)
  vm.requestName = 'new'; await vm.saveName(); assert.deepEqual(calls, [])
  vm.request = detail().request; vm.request.status = 'PUBLISHED'; await vm.saveName()
  assert.equal(vm.editable, false); assert.equal(vm.canReview, true); assert.deepEqual(calls, [])
  vm.request.status = 'ARCHIVED'; assert.equal(vm.canReview, false)
})

test('failed requirement save keeps the current selection and unsaved text', async t => {
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: async () => detail(), updateDdItemInfo: async () => { throw new Error('网络中断') } } }); t.after(dispose)
  await vm.fetchData(); vm.itemDescription = '新增要求'; await vm.selectItem({ id: 99, title: 'other' })
  assert.equal(vm.selectedId, 5); assert.equal(vm.itemDescription, '新增要求'); assert.equal(vm.error, '网络中断'); assert.equal(vm.busy, false)
})

test('unmount invalidates pending fetches and stops job observation', async () => {
  const gate = deferred(); const { vm, dispose } = createEditor({ api: { getDdRequestDetails: () => gate.promise } })
  vm._abort = new AbortController(); const pending = vm.fetchData(); dispose(); gate.resolve(detail()); await pending
  assert.equal(vm.request, null); assert.equal(vm._abort.signal.aborted, true)
})
