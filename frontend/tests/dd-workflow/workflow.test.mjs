// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { ddWorkflowStatus, ddWorkflowCounts, ddMatchesFilter, ddPublishIssues, ddOrderedItems, ddIsCategory, waitForDdJob } from '../../src/utils/ddWorkflow.js'

test('AI result is separate from lawyer confirmation; technical failure goes to review', () => {
  assert.equal(ddWorkflowStatus({ status: 'UPLOADED' }, { aiStatus: 'PASSED' }), 'AI_PASSED')
  assert.equal(ddWorkflowStatus({ status: 'APPROVED' }, { aiStatus: 'FAILED' }), 'APPROVED')
  assert.equal(ddWorkflowStatus({ status: 'UPLOADED' }, { aiStatus: 'MANUAL_REQUIRED' }), 'MANUAL_REQUIRED')
  assert.equal(ddMatchesFilter({}, { aiStatus: 'MANUAL_REQUIRED' }, 'REVIEW'), true)
  assert.equal(ddMatchesFilter({}, { aiStatus: 'FAILED' }, 'CHANGES'), true)
})

test('resolved appeals no longer appear in the appeal queue', () => {
  assert.equal(ddWorkflowStatus({ status: 'UPLOADED' }, { appealedAt: 'now', reviewStatus: 'UPLOADED' }), 'APPEALED')
  assert.equal(ddWorkflowStatus({ status: 'REJECTED' }, { appealedAt: 'before', reviewStatus: 'REJECTED' }), 'REJECTED')
  assert.equal(ddWorkflowStatus({ status: 'APPROVED' }, { appealedAt: 'before', reviewStatus: 'APPROVED' }), 'APPROVED')
  assert.equal(ddWorkflowStatus({ status: 'UPLOADED' }, { appealedAt: '2026-10-20T10:00:00', reviewedAt: '2026-10-20T11:00:00', reviewStatus: 'UPLOADED' }), 'REVIEW')
})

test('counts include current versions only and distinguish review from changes', () => {
  const items = [{ id: 1 }, { id: 2, status: 'APPROVED' }, { id: 3, currentSubmissionId: 10 }]
  const counts = ddWorkflowCounts(items, { 3: [{ id: 9, aiStatus: 'PASSED' }, { id: 10, aiStatus: 'FAILED' }] })
  assert.deepEqual(counts, { ALL: 3, PENDING: 1, REVIEW: 0, APPROVED: 1, CHANGES: 1, APPEALED: 0 })
})

test('imported group nodes do not require descriptions; all rows still require names', () => {
  assert.deepEqual(ddPublishIssues('清单', [{ title: '工商资料' }, { title: '章程', parentId: 1, description: '完整版本' }]), [])
  assert.deepEqual(ddPublishIssues('', []), ['name', 'items'])
  assert.deepEqual(ddPublishIssues('清单', [{ title: ' ' }]), ['titles'])
  const rows = ddOrderedItems([{ id: 2, parentId: 1, sortOrder: 1 }, { id: 1, sortOrder: 2 }, { id: 3, parentId: 999 }])
  assert.deepEqual(rows.map(x => [x.id, x.depth]), [[3, 0], [1, 0], [2, 1]])
})

test('job completes only after success with parsed result; observed progress is server state', async () => {
  const observed = [], loads = []
  const result = await waitForDdJob({ id: 1, status: 'QUEUED' }, async id => { loads.push(id); return { id, status: 'SUCCEEDED', resultJson: '{"requestId":9}' } }, { interval: 0, onUpdate: job => observed.push(job.status) })
  assert.deepEqual(result, { requestId: 9 }); assert.deepEqual(observed, ['QUEUED', 'SUCCEEDED']); assert.deepEqual(loads, [1])
})

test('poll failure never restarts a job, and explicit backend failures remain errors', async () => {
  let calls = 0
  await assert.rejects(waitForDdJob({ id: 5, status: 'RUNNING' }, async () => { calls++; throw new Error('offline') }, { interval: 0 }), /offline/)
  assert.equal(calls, 1)
  await assert.rejects(waitForDdJob({ id: 5, status: 'FAILED', error: '额度不足' }, async () => {}, { interval: 0 }), /额度不足/)
})

test('closing the component stops observation without claiming server cancellation', async () => {
  const controller = new AbortController(); let calls = 0
  const pending = waitForDdJob({ id: 8, status: 'RUNNING' }, async () => { calls++ }, { interval: 10000, signal: controller.signal })
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 0)
})

test('empty parent categories are excluded from collection totals, but historic parent submissions remain reviewable', () => {
  const items = [{ id: 1, title: '公司资料' }, { id: 2, parentId: 1 }, { id: 3, parentId: 1, status: 'APPROVED' }]
  assert.equal(ddIsCategory(items[0], items), true)
  assert.deepEqual(ddWorkflowCounts(items, {}), { ALL: 2, PENDING: 1, REVIEW: 0, APPROVED: 1, CHANGES: 0, APPEALED: 0 })
  assert.equal(ddIsCategory({ ...items[0], uploadedFileId: 9 }, items), false)
  assert.equal(ddIsCategory({ ...items[0], currentSubmissionId: 7 }, items), false)
  assert.equal(ddIsCategory(items[0], items, { 1: { id: 7 } }), false)
  assert.equal(ddWorkflowCounts(items, { 1: { id: 7 } }).ALL, 3)
})
