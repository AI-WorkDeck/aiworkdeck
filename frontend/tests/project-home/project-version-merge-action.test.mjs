// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectVersionMergeApi } from '../../src/utils/projectVersionAction.js'

const done = (stepId, result = { success: true }) => ({ status: result.success ? 'succeeded' : 'failed',
  lastStep: { stepId, status: result.success ? 'succeeded' : 'failed', result } })
function harness(extra = {}) {
  const calls = [], steps = []
  const deps = { operationId: 'op', current: () => true, wait: async () => {}, onStep: id => steps.push(id),
    state: async id => { calls.push(['state', id]); return done(id) },
    post: async body => { calls.push(['post', body]); return done(body.stepId) },
    postFile: async body => { calls.push(['file', body]); return done(body.stepId) }, ...extra }
  return { api: createProjectVersionMergeApi(deps), calls, steps }
}

test('续步丢失HTTP回执只查指定step，不重复写入', async () => {
  let posts = 0
  const h = harness({ post: async () => { posts++; throw Error('connection lost') } })
  assert.deepEqual(await h.api.postMergeResolveStructured(7, { path: 'book.xlsx' }), { data: { success: true } })
  assert.equal(posts, 1)
  assert.deepEqual(h.calls, [['state', 'op:merge:1']])
  assert.deepEqual(h.steps, ['op:merge:1', null])
})

test('文件字节和收尾各有独立step，续步不传模型指定的refs或裁决', async () => {
  const h = harness()
  const bytes = new Uint8Array([1, 2])
  await h.api.postMergeResolveFile(7, { path: 'draft.docx', name: 'draft.docx', bytes })
  await h.api.resolveSessionEnd(7, 'untrusted-session', { 'draft.docx': 'THEIRS' })
  assert.equal(h.calls[0][0], 'file')
  assert.equal(h.calls[0][1].bytes, bytes)
  assert.equal(h.calls[0][1].stepId, 'op:merge:1')
  assert.deepEqual(h.calls[1], ['post', { kind: 'finalize', path: undefined, stepId: 'op:merge:2' }])
})

test('原操作已结束但匹配step缺失仍是未知，不能释放保存保护', async () => {
  let reads = 0, posts = 0
  const h = harness({ post: async () => { posts++; return { status: 'succeeded' } },
    state: async () => { reads++; return done('another-step') } })
  await assert.rejects(h.api.resolveCloudMerge(7, {}), error => error.message === 'aiActionUnknown' && !error.writeSettled)
  assert.equal(posts, 1); assert.equal(reads, 60)
  assert.deepEqual(h.steps, ['op:merge:1'])
})

test('服务确认终态的部分失败不冒报成功，但允许真实重载后恢复编辑', async () => {
  const h = harness({ post: async body => done(body.stepId, { success: false, outcomeUnknown: true, error: 'partial failure' }) })
  await assert.rejects(h.api.resolveCloudMerge(7, {}), error => error.message === 'partial failure' && error.writeSettled === true)
  assert.deepEqual(h.steps, ['op:merge:1', null])
})

test('续步执行中等到真正结果；最后一次查询成功也必须采纳', async () => {
  let reads = 0
  const h = harness({ post: async body => ({ lastStep: { stepId: body.stepId, status: 'executing' } }),
    state: async id => ++reads === 60 ? done(id) : { lastStep: { stepId: id, status: 'executing' } } })
  assert.deepEqual(await h.api.resolveCloudMerge(7, {}), { data: { success: true } })
  assert.equal(reads, 60)
})

test('已切换项目的旧续步不POST', async () => {
  const h = harness({ current: () => false })
  await assert.rejects(h.api.resolveCloudMerge(7, {}), error => error.writeSettled === true)
  assert.deepEqual(h.calls, []); assert.deepEqual(h.steps, [])
})
