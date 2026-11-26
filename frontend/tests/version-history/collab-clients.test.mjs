// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C16 (lane C S4): after the access-code dialog closed, a lawyer could not see or revoke a client.
// The server always listed clients; the dialog read the member list once and never again, and showed
// clients and lawyers in one undifferentiated list without a revoke action.
// The server side of "a revoked client is refused on the next request" is covered end to end by
// backend ClientPortalRoundTripTest (removeMember → the old client session's next read fails).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const dialog = readFileSync(new URL('../../src/components/collab/CollabDialog.vue', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const home = readFileSync(new URL('../../src/components/project-home/ProjectHomePane.vue', import.meta.url), 'utf8')
function body(src, name) {
  const start = src.search(new RegExp('^    (?:async )?' + name + '\\(', 'm'))
  assert.ok(start >= 0, name)
  const end = src.indexOf('\n    },', start)
  return src.slice(start, end + 7).trim().replace(/,$/, '')
}
const fn = (src, name, deps = {}) => vm.runInNewContext(`({${body(src, name)}}).${name}`, deps)
const members = [
  { userId: 1, role: 'ADMIN', displayName: '沈砚' }, { userId: 2, role: 'PARTICIPANT', displayName: '陆知微' },
  { userId: 8, role: 'CLIENT', displayName: '星禾科技 苏禾', joinedAt: '2026-11-26T03:23:11', clientShareHistory: false },
  { userId: 9, role: 'CLIENT', displayName: '星禾科技 王经理', joinedAt: '2026-11-26T03:41:42', clientShareHistory: true },
]
const isClientRole = (role) => typeof role === 'string' && role.startsWith('CLIENT')

test('C16: clients are listed separately with join date and history scope', () => {
  const v = { members }
  assert.deepEqual(fn(dialog, 'lawyerMembers', { isClientRole }).call(v).map(m => m.userId), [1, 2])
  assert.deepEqual(fn(dialog, 'clientMembers', { isClientRole }).call(v).map(m => m.userId), [8, 9])
  const meta = fn(dialog, 'clientMetaText').bind({ $t: (k, p) => k + (p ? JSON.stringify(p) : '') })
  assert.equal(meta(members[2]), 'version.clientJoinedAt{"date":"2026-11-26"} · version.clientSeesFromJoin')
  assert.equal(meta(members[3]), 'version.clientJoinedAt{"date":"2026-11-26"} · version.clientSeesEarlier')
  assert.equal(meta({ role: 'CLIENT' }), 'version.clientRole')
})

test('C16: the list is re-read every time the tab opens, and revoke removes the client server-side', async () => {
  assert.match(dialog, /if \(key === 'people' && this\.linked\) this\.loadMembers\(\)/)
  let removed = null, reloaded = 0, modal = null
  const revoke = fn(dialog, 'onRevokeClient', {
    uni: { showModal: (o) => { modal = o }, showToast() {} },
    removeCloudMember: async (pid, uid) => { removed = [pid, uid] }, errorText: () => '',
  })
  revoke.call({ projectId: 5, $t: (k) => k, loadMembers() { reloaded++ } }, members[2])
  await modal.success({ confirm: true })
  assert.deepEqual(removed, [5, 8])
  assert.equal(reloaded, 1)
  assert.match(dialog, /@tap="onRevokeClient\(m\)"/)
})

test('C16: the overview counts the shared list (lawyers + clients); the client pane links to this case\'s clients', () => {
  assert.match(page, /:shared-member-count="collabLinked && projectMembers && projectMembers\.length \? projectMembers\.length : null"/)
  assert.match(home, /statsShown\(\) \{\s*return this\.sharedMemberCount == null \? this\.stats : \{ \.\.\.this\.stats, memberCount: this\.sharedMemberCount \}/)
  assert.match(page, /@click\.stop="openCollab\('people'\)"/)
  const count = fn(page, 'projectClientCount')
  assert.equal(count.call({ projectMembers: members }), 2)
})
