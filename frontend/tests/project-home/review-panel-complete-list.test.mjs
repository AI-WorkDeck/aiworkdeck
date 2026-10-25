// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeReviewVm } from '../_lib/review-panel-vm.mjs'

test('a complete native list above 500 does not claim missing revisions or comments', async () => {
  const vm = makeReviewVm({ executeCommand: async action => ({ success: true, truncated: false,
    [action === 'list_revisions' ? 'revisions' : 'comments']: Array.from({ length: 601 }, (_, index) => ({ index })) }) })
  await vm.reload()
  assert.equal(vm.revisions.length, 601)
  assert.equal(vm.listLimitReached, false)
  vm.tab = 'cmt'
  assert.equal(vm.comments.length, 601)
  assert.equal(vm.listLimitReached, false)
})

test('legacy capped replies retain their warning, explicit truncation wins even below the old cap', async () => {
  let result = { success: true, revisions: Array.from({ length: 500 }, (_, index) => ({ index })) }
  const vm = makeReviewVm({ executeCommand: async action => action === 'list_revisions' ? result : { success: true, comments: [] } })
  await vm.reload()
  assert.equal(vm.listLimitReached, true)
  result = { success: true, revisions: [{ index: 0 }], truncated: true }
  await vm.reload()
  assert.equal(vm.listLimitReached, true)
  vm.tab = 'cmt'
  assert.equal(vm.listLimitReached, false)
})

test('a failed refresh preserves the complete-list status along with its rows', async () => {
  let fail = false
  const vm = makeReviewVm({ executeCommand: async action => fail ? { success: false, message: 'Owned failure' } :
    { success: true, truncated: false, [action === 'list_revisions' ? 'revisions' : 'comments']: Array.from({ length: 601 }, (_, index) => ({ index })) } })
  await vm.reload()
  fail = true
  await vm.reload()
  assert.equal(vm.revisions.length, 601)
  assert.equal(vm.listLimitReached, false)
  vm.executor = null
  await vm.reload()
  assert.equal(vm.listLimitReached, false)
})
