// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEditor, detail, deferred } from '../dd-workflow/editor-harness.mjs'
import { ddCanUpload, ddActionTarget, ddReviewSummary } from '../../src/utils/ddReview.js'

const submitted = () => ({ request: { id: 1, name: '清单', status: 'PUBLISHED' }, items: [{ id: 5, title: '营业执照', status: 'UPLOADED', currentSubmissionId: 13, revision: 3 }], submissionsByItem: { 5: { id: 13, reviewStatus: 'UPLOADED', files: [{ fileId: 91, name: '营业执照.pdf' }] } } })

test('review sends the exact submission and revision shown, and blocks blank rejection', async t => {
  const calls = []
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: async () => submitted() }, services: { reviewDdSubmission: async (...args) => calls.push(args) } }); t.after(dispose)
  await vm.fetchData(); await vm.review('REJECTED'); assert.equal(calls.length, 0)
  vm.reviewReason = ' 缺少完整页码 '; await vm.review('REJECTED')
  assert.deepEqual(calls[0], [5, { status: 'REJECTED', reason: '缺少完整页码', submissionId: 13, revision: 3 }, 7])
  await vm.review('APPROVED'); assert.equal(calls[1][1].status, 'APPROVED'); assert.equal(vm.busy, false)
})

test('409 keeps lawyer notes visible and does not claim success', async t => {
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: async () => submitted() }, services: { reviewDdSubmission: async () => { throw new Error('客户已提交新版本，请刷新后复核') } } }); t.after(dispose)
  await vm.fetchData(); vm.reviewReason = '缺一页'; await vm.review('REJECTED')
  assert.equal(vm.reviewReason, '缺一页'); assert.match(vm.error, /新版本/); assert.equal(vm.busy, false)
})

test('read-only members and archived checklists cannot review or comment', async t => {
  let writes = 0
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: async () => submitted(), addDdItemComment: async () => writes++ }, services: { reviewDdSubmission: async () => writes++ } }); t.after(dispose)
  await vm.fetchData(); vm.canWrite = false; vm.commentText = 'x'; await vm.review('APPROVED'); await vm.sendComment(); assert.equal(writes, 0)
  vm.canWrite = true; vm.request.status = 'ARCHIVED'; await vm.review('APPROVED'); await vm.sendComment(); assert.equal(writes, 0)
})

test('double-click review sends only one decision', async t => {
  let writes = 0; const gate = deferred()
  const { vm, dispose } = createEditor({ api: { getDdRequestDetails: async () => submitted() }, services: { reviewDdSubmission: async () => { writes++; await gate.promise } } }); t.after(dispose)
  await vm.fetchData(); const first = vm.review('APPROVED'); const second = vm.review('APPROVED'); assert.equal(writes, 1); gate.resolve(); await Promise.all([first, second])
})

test('legacy review helpers retain upload and withdrawal semantics', () => {
  assert.equal(ddCanUpload({ status: 'APPROVED' }), false)
  assert.equal(ddCanUpload({ status: 'REJECTED' }), true)
  assert.equal(ddActionTarget('withdraw'), 'UPLOADED')
  assert.deepEqual(ddReviewSummary([{ status: 'UPLOADED' }, { status: 'APPROVED' }, { status: 'REJECTED' }]), { uploaded: 1, approved: 1, rejected: 1 })
})
