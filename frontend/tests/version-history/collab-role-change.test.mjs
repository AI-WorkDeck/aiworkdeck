// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C9 (lane C S2): a case member's role changes in place in 协作 → 案件参与人, instead of 移出 + re-add.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const dialog = readFileSync(new URL('../../src/components/collab/CollabDialog.vue', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
function body(src, name) {
  const start = src.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
  assert.ok(start >= 0, name)
  const end = src.indexOf('\n    },', start)
  return src.slice(start, end + 7).trim().replace(/,$/, '')
}
const fn = (src, name, deps = {}) => vm.runInNewContext(`({${body(src, name)}}).${name}`, deps)
const isClientRole = (r) => typeof r === 'string' && r.startsWith('CLIENT')

test('the picker follows the case library matrix: owner changes any lawyer, admin only collaborator/read-only, never to admin', () => {
  const options = fn(dialog, 'roleOptionsFor', { isClientRole })
  // results come from a vm context: copy into this realm for deepStrictEqual
  const as = (viewerRole) => (m) => [...options.call({ viewerRole }, { userId: 9, ...m })]
  assert.deepEqual(as('OWNER')({ role: 'PARTICIPANT' }), ['PARTICIPANT', 'READ_ONLY', 'ADMIN'])
  assert.deepEqual(as('OWNER')({ role: 'ADMIN' }), ['PARTICIPANT', 'READ_ONLY', 'ADMIN'])
  assert.deepEqual(as('ADMIN')({ role: 'READ_ONLY' }), ['PARTICIPANT', 'READ_ONLY'])
  assert.deepEqual(as('ADMIN')({ role: 'ADMIN' }), [], 'an admin cannot change another admin (or themselves)')
  for (const viewer of ['PARTICIPANT', 'READ_ONLY', null]) assert.deepEqual(as(viewer)({ role: 'READ_ONLY' }), [], String(viewer))
  assert.deepEqual(as('OWNER')({ role: 'OWNER' }), [], 'nobody changes the owner')
  assert.deepEqual(as('OWNER')({ role: 'CLIENT_NAMED' }), [], 'clients are governed by their access code')
  assert.deepEqual([...options.call({ viewerRole: 'OWNER' }, { role: 'PARTICIPANT', userId: null })], [], 'no id, no change')
})

function changer({ confirm = true, fail = null } = {}) {
  const calls = [], toasts = [], modals = []
  const deps = {
    uni: { showModal: (o) => { modals.push(o.content); o.success({ confirm }) }, showToast: (o) => toasts.push(o.title) },
    changeCloudMemberRole: async (...args) => { calls.push(args); if (fail) throw fail },
    roleLabel: (r) => ({ READ_ONLY: '只读成员', PARTICIPANT: '协作人' })[r] || r,
    errorText: (e, fb) => e?.message || fb,
  }
  const run = fn(dialog, 'onChangeRole', deps)
  const vm = { projectId: 7, memberBusy: false, candidate: { x: 1 }, events: [], loaded: 0,
    $t: (k, p) => k + (p ? JSON.stringify(p) : ''), $emit(e) { this.events.push(e) }, loadMembers() { this.loaded++ } }
  return { run: (m, role) => run.call(vm, m, role), vm, calls, toasts, modals }
}

test('demoting to read-only asks first; declining changes nothing', async () => {
  const c = changer({ confirm: false })
  await c.run({ userId: 31, role: 'PARTICIPANT', displayName: '陆知微' }, 'READ_ONLY')
  assert.equal(c.modals.length, 1)
  assert.match(c.modals[0], /changeRoleReadOnlyConfirm.*陆知微/)
  assert.deepEqual(c.calls, [])
})

test('a confirmed change calls the case library, says so, reloads members and tells the page', async () => {
  const c = changer()
  await c.run({ userId: 31, role: 'PARTICIPANT', displayName: '陆知微' }, 'READ_ONLY')
  assert.deepEqual(c.calls.map((a) => [...a]), [[7, 31, 'READ_ONLY']])
  assert.match(c.toasts[0], /roleChanged.*陆知微.*只读成员/)
  assert.equal(c.vm.loaded, 1)
  assert.deepEqual(c.vm.events, ['changed'])
  assert.equal(c.vm.candidate, null)
})

test('promoting needs no confirmation; same role is a no-op; a refusal is shown', async () => {
  const up = changer()
  await up.run({ userId: 31, role: 'READ_ONLY', displayName: '陆知微' }, 'PARTICIPANT')
  assert.equal(up.modals.length, 0)
  assert.deepEqual(up.calls.map((a) => [...a]), [[7, 31, 'PARTICIPANT']])
  const same = changer()
  await same.run({ userId: 31, role: 'READ_ONLY' }, 'READ_ONLY')
  assert.deepEqual(same.calls, [])
  const refused = changer({ fail: new Error('没能修改角色：权限不足') })
  await refused.run({ userId: 31, role: 'READ_ONLY' }, 'PARTICIPANT')
  assert.match(refused.toasts[0], /权限不足/)
  assert.equal(refused.vm.memberBusy, false)
})

test('the lookup card offers 改为协作人 for a read-only member, and the API is a PUT', () => {
  assert.match(dialog, /v-if="candidate\.currentRole === 'READ_ONLY' && candidate\.memberUserId != null && canPromoteReadOnly"/)
  assert.match(dialog, /onChangeRole\(\{ userId: candidate\.memberUserId, role: 'READ_ONLY', displayName: candidate\.displayName \}, 'PARTICIPANT'\)/)
  assert.match(api, /url: `\/api\/cloud\/projects\/\$\{projectId\}\/members\/\$\{remoteUserId\}\/role`, method: 'PUT', data: \{ role \}/)
})

test('after sharing from the dialog, the online check hands the viewer role to the page (lane C nit)', () => {
  const share = dialog.slice(dialog.indexOf('async onShare()'), dialog.indexOf('\n    },', dialog.indexOf('async onShare()')))
  assert.match(share, /const res = await checkCloud\(this\.projectId\)\s*\n\s*this\.\$emit\('changed', \{ cloud: \(res && res\.data\) \|\| null \}\)/)
})
