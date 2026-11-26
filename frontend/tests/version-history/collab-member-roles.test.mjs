// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lane C S2: C8 read-only member, C10 removed member, C11 offline submit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const dialog = readFileSync(new URL('../../src/components/collab/CollabDialog.vue', import.meta.url), 'utf8')
const guide = readFileSync(new URL('../../src/components/collab/SubmitDraftGuide.vue', import.meta.url), 'utf8')
function body(src, name) {
  const start = src.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
  assert.ok(start >= 0, name)
  const end = src.indexOf('\n    },', start)
  return src.slice(start, end + 7).trim().replace(/,$/, '')
}
const fn = (src, name, deps = {}) => vm.runInNewContext(`({${body(src, name)}}).${name}`, deps)

test('C8: a read-only (or removed) member opens read-only; the cloud role only ever restricts', () => {
  const blocked = fn(page, 'collabMemberBlocked')
  assert.equal(blocked.call({ collabCloud: { linked: true, myRole: 'READ_ONLY' } }), true)
  assert.equal(blocked.call({ collabCloud: { linked: true, removed: true } }), true)
  assert.equal(blocked.call({ collabCloud: { linked: true, myRole: 'PARTICIPANT' } }), false)
  assert.equal(blocked.call({ collabCloud: null }), false)
  assert.match(page, /if \(this\.collabMemberBlocked\) return false\s*\n\s*if \(this\.project\.userId != null/, 'checked before the owner shortcut')
})

test('C8: no 交稿 for blocked members — guide refuses with the reason, dialog hides the button', () => {
  let toast = null
  const open = fn(page, 'openSubmitGuide', { uni: { showToast: (o) => { toast = o.title } } })
  const v = { collabMemberBlocked: true, collabMemberBarText: '你在这份案卷里是只读成员…', submitGuideVisible: false }
  open.call(v)
  assert.equal(v.submitGuideVisible, false)
  assert.match(toast, /只读/)
  assert.match(dialog, /v-if="!cloud \|\| \(!cloud\.removed && cloud\.myRole !== 'READ_ONLY'\)"[\s\S]{0,120}@tap="onUpload"/)
})

test('C10: removed reads as removed (with owner), not as a network blip; 刷新状态 hands its online result to the page', () => {
  assert.match(page, /if \(c\.removed\) return this\.\$t\('workbench\.collabRemoved'\)\s*\n\s*if \(c\.offline\)/)
  const state = fn(dialog, 'stateText', { remoteAheadText: () => 'ahead' })
  const t = (k, p) => k + (p ? JSON.stringify(p) : '')
  assert.equal(state.call({ conflictPending: false, cloud: { removed: true, ownerName: '沈律师' }, $t: t }), 'version.removedFromCaseFileBy{"owner":"沈律师"}')
  assert.equal(state.call({ conflictPending: false, cloud: { removed: true }, $t: t }), 'version.removedFromCaseFileSelf')
  assert.match(dialog, /const res = await checkCloud\(this\.projectId\)\s*\n\s*this\.\$emit\('changed', \{ cloud: \(res && res\.data\) \|\| null \}\)/)
  assert.match(page, /if \(payload && payload\.cloud\) \{\s*\n\s*this\.collabCloud = payload\.cloud/)
})

test('C11: offline submit is queued, retried once when back online, never twice', async () => {
  const store = {}
  const uni = { setStorageSync: (k, v) => { store[k] = v }, getStorageSync: (k) => store[k], removeStorageSync: (k) => { delete store[k] }, showToast() {} }
  let uploads = 0, fetched = 0
  const deps = { uni, uploadToCloud: async () => { uploads++; return { data: { status: 'UPLOADED' } } }, errorText: () => '' }
  const v = { projectId: 9, collabCloud: { linked: true, pendingUpload: true, offline: true }, collabMemberBlocked: false, $t: (k) => k,
    fetchCollabState() { fetched++ }, onCollabConflict() {} }
  for (const n of ['onSubmitQueuedOffline', 'loadQueuedSubmit', 'clearQueuedSubmit', 'retryQueuedSubmit']) v[n] = fn(page, n, deps).bind(v)
  v.onSubmitQueuedOffline()
  assert.equal(store.awd_collab_retry_9, '1', 'persisted across restarts')
  await v.retryQueuedSubmit()
  assert.equal(uploads, 0, 'still offline: wait')
  v.collabCloud = { linked: true, pendingUpload: true }
  await Promise.all([v.retryQueuedSubmit(), v.retryQueuedSubmit()])
  assert.equal(uploads, 1, 'exactly one automatic submit')
  assert.equal(store.awd_collab_retry_9, undefined)
  await v.retryQueuedSubmit()
  assert.equal(uploads, 1)
  assert.match(page, /if \(online && typeof this\.retryQueuedSubmit === 'function'\) this\.retryQueuedSubmit\(\)/)
  assert.match(page, /window\.addEventListener\('online', this\._collabOnFocus\)/)
})

test('C11: offline guide says it cannot know about new drafts; a failed offline submit queues instead of a vanishing toast', () => {
  assert.match(guide, /if \(this\.localCloud && this\.localCloud\.offline\) return this\.\$t\('version\.submitGuidePullOffline'\)/)
  assert.match(guide, /this\.\$emit\('queued'\)/)
  assert.match(page, /@queued="onSubmitQueuedOffline"/)
})
