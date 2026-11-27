// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lane C multi-device findings C2–C4 (readiness/collab/shots/s1/): invite expiry in local time,
// the open team panel refreshes when a colleague accepts elsewhere, and an empty team page
// explains teams instead of leading with the law-firm dashboard and demo data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../../src/components/admin/TeamPanel.vue', import.meta.url), 'utf8')

function method(name) {
  const start = src.indexOf('    ' + name + '(')
  assert.ok(start > 0, name)
  let i = src.indexOf('{', start), depth = 0
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break }
  return src.slice(start, i + 1)
}
const pad = (n) => String(n).padStart(2, '0')
const formatDateTime = (v) => { const d = new Date(v); if (Number.isNaN(d.getTime())) return ''; return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }

test('C2: a UTC expiry without a zone marker is shown in local time', () => {
  const expiryText = new Function('formatDateTime', 'return {' + method('expiryText') + '}')(formatDateTime).expiryText
  const vm = { $t: (k, p) => k + (p ? ':' + p.date : '') }
  const out = expiryText.call(vm, '2026-12-03T01:49:00')
  assert.equal(out, 'team.inviteExpires:' + formatDateTime('2026-12-03T01:49:00Z'), 'parsed as UTC, shown local')
  assert.equal(expiryText.call(vm, '2026-12-03T01:49:00Z'), out, 'explicit Z gives the same')
  assert.equal(expiryText.call(vm, ''), 'team.inviteExpiresUnknown')
  assert.equal(expiryText.call(vm, 'not a date'), 'team.inviteExpires:not a date')
})

test('C3: focus, visibility and a 20 s poll refresh members and invites without touching drafts', async () => {
  assert.match(src, /window\.addEventListener\('focus', this\._teamRefreshOnFocus\)/)
  assert.match(src, /document\.addEventListener\('visibilitychange', this\._teamRefreshOnFocus\)/)
  assert.match(src, /setInterval\(\(\) => \{\s*if \(typeof document !== 'undefined' && document\.hidden\) return\s*this\.refreshMembership\(\)/)
  assert.match(src, /clearInterval\(this\._teamRefreshTimer\)/)
  const refresh = new Function('getTeam', 'return {' + method('async refreshMembership') .replace(/^\s*async /, 'async ') + '}')
  const data = { team: { id: 't', name: '澄川团队' }, members: [{ accountId: 'a' }, { accountId: 'b' }], pendingInvites: [], invites: [], firm: null, myRole: 'OWNER' }
  const { refreshMembership } = refresh(async () => data)
  const vm = { connected: true, team: { id: 't', name: '澄川团队' }, members: [{ accountId: 'a' }], pendingInvites: [{ id: 1 }], renameDraft: '改了一半', loadSummary: async () => {} }
  await refreshMembership.call(vm)
  assert.equal(vm.members.length, 2, 'the colleague who accepted elsewhere shows up')
  assert.deepEqual(vm.pendingInvites, [], 'their invite is no longer pending')
  assert.equal(vm.renameDraft, '改了一半', 'a rename in progress is not overwritten')
  const failing = refresh(async () => { throw new Error('offline') }).refreshMembership
  await failing.call(vm)
  assert.equal(vm.members.length, 2, 'a failed refresh keeps what is shown')
})

test('C4: no team, no firm, empty ledger → no law-firm dashboard; an intro explains teams and inviting', () => {
  assert.match(src, /<SettingsSection\s+v-if="showLawfirmDashboard"\s+:title="\$t\('team\.lawfirmDashboardTitle'\)"/)
  const gate = new Function('return {' + method('showLawfirmDashboard') + '}')().showLawfirmDashboard
  const vm = (o) => ({ team: null, firm: null, demoDataTools: false, lawfirmKpis: { activeMatters: 0, pendingClearances: 0 }, ...o })
  assert.equal(gate.call(vm()), false)
  assert.equal(gate.call(vm({ team: { id: 't' } })), true)
  assert.equal(gate.call(vm({ firm: { id: 'f' } })), true)
  assert.equal(gate.call(vm({ demoDataTools: true })), true)
  assert.equal(gate.call(vm({ lawfirmKpis: { activeMatters: 3 } })), true, 'a local ledger with matters keeps it')
  for (const k of ['emptyIntroTitle', 'emptyIntroBody', 'emptyIntroStep1', 'emptyIntroStep2', 'emptyIntroStep3']) assert.match(src, new RegExp("team\\." + k))
  assert.match(src, /v-if="demoDataTools" class="team-btn small"[^>]*@tap="onSeedLawFirmDemo"/, 'X12: demo data stays opt-in')
})
