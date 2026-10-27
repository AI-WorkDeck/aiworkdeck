// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeReviewVm } from '../_lib/review-panel-vm.mjs'

test('sending before the textarea model catches up preserves the whole visible draft', async () => {
  const calls = []
  const vm = makeReviewVm({ executeCommand: async (action, params) => {
    calls.push({ action, params }); return { success: true, revisions: [], comments: [] }
  } })
  vm.replyText = '正'
  vm.$el = { querySelector: () => ({ value: '正式侧栏回复已核验' }) }
  await vm.submitReply({ id: 'owned-parent', index: 0 })
  assert.equal(calls[0].action, 'reply_comment')
  assert.equal(calls[0].params.text, '正式侧栏回复已核验')
  assert.equal(calls[0].params.id, 'owned-parent')
  assert.equal(vm.replyText, '')
})

test('a freshly cleared visible draft cannot send stale model text', async () => {
  let calls = 0
  const vm = makeReviewVm({ executeCommand: async () => { calls++; return { success: true } } })
  vm.replyText = '已经清空的草稿'
  vm.$el = { querySelector: () => ({ value: '' }) }
  await vm.submitReply({ id: 'owned-parent', index: 0 })
  assert.equal(calls, 0)
})
