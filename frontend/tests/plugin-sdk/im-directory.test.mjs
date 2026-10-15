// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 项目沟通通讯录：只用真实数据、朋友按账户隔离、团队 / 律所切换能力与 TeamPanel 同口径。
import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) } }
const { loadImDirectory, addImFriend, readImFriends } = await import('../../src/utils/imDirectory.js')

const teamPayload = (over = {}) => ({
  team: { id: 't1', name: '合成争议团队' },
  myRole: 'MEMBER',
  myAccountId: 'acc-me',
  members: [
    { accountId: 'acc-me', displayName: '我自己', role: 'MEMBER' },
    { accountId: 'acc-2', displayName: '合成同事', role: 'OWNER' },
  ],
  firm: { id: 'f1', name: '合成律所', isHead: false, teams: [{ id: 't0', name: '总部', isHead: true, memberCount: 9 }, { id: 't1', name: '合成争议团队', isHead: false, memberCount: 2 }] },
  ...over,
})

test('no team and no firm yields empty groups, never fabricated contacts', async () => {
  store.clear()
  const dir = await loadImDirectory({ projectId: 1, deps: { getTeam: async () => ({ team: null, invites: [] }), getProjectMembers: async () => [], getCurrentUser: async () => ({ id: 7, username: 'u7' }) } })
  assert.equal(dir.organization, null)
  assert.equal(dir.firm, null)
  assert.deepEqual(dir.friends, [])
  assert.deepEqual(dir.projectColleagues, [])
  assert.equal(dir.capabilities.hasTeam, false)
  assert.equal(dir.capabilities.canSwitchTeam, false)
  assert.equal(dir.accountKey, '7')
})

test('team member can switch team; only sub-team owner can switch firm; head team cannot', async () => {
  store.clear()
  const member = await loadImDirectory({ deps: { getTeam: async () => teamPayload() } })
  assert.equal(member.organization.name, '合成争议团队')
  assert.equal(member.organization.members.find((m) => m.isMe).name, '我自己')
  assert.equal(member.firm.teams.find((t) => t.isMine).id, 't1')
  assert.equal(member.capabilities.canSwitchTeam, true)
  assert.equal(member.capabilities.canSwitchFirm, false)

  const owner = await loadImDirectory({ deps: { getTeam: async () => teamPayload({ myRole: 'OWNER' }) } })
  assert.equal(owner.capabilities.canSwitchTeam, false)
  assert.equal(owner.capabilities.canSwitchFirm, true)

  const head = await loadImDirectory({ deps: { getTeam: async () => teamPayload({ myRole: 'OWNER', firm: { id: 'f1', name: '合成律所', isHead: true, teams: [] } }) } })
  assert.equal(head.capabilities.canSwitchFirm, false)

  const noFirmOwner = await loadImDirectory({ deps: { getTeam: async () => teamPayload({ myRole: 'OWNER', firm: null }) } })
  assert.equal(noFirmOwner.capabilities.canJoinFirm, true)
})

test('friends are isolated per account and survive a team switch', async () => {
  store.clear()
  addImFriend('acc-me', { name: '外部律师甲', org: '合成所', roleLabel: '外部合作律师' })
  assert.equal(readImFriends('acc-other').length, 0)
  const before = await loadImDirectory({ deps: { getTeam: async () => teamPayload() } })
  assert.deepEqual(before.friends.map((f) => f.name), ['外部律师甲'])
  // 切换到另一个团队：账户不变，朋友仍在；团队成员换成新团队的
  const after = await loadImDirectory({ deps: { getTeam: async () => teamPayload({ team: { id: 't9', name: '新团队' }, members: [{ accountId: 'acc-me', displayName: '我自己', role: 'MEMBER' }], firm: null }) } })
  assert.equal(after.organization.name, '新团队')
  assert.equal(after.firm, null)
  assert.deepEqual(after.friends.map((f) => f.name), ['外部律师甲'])
})

test('project clients join friends with source; team fetch failure is reported, not papered over', async () => {
  store.clear()
  const dir = await loadImDirectory({ projectId: 3, deps: {
    getTeam: async () => { throw new Error('offline') },
    getProjectMembers: async () => ({ data: [{ userId: 1, displayName: '合成客户', role: 'CLIENT' }, { userId: 2, displayName: '项目律师', role: 'MEMBER' }] }),
  } })
  assert.deepEqual(dir.errors, ['team'])
  assert.equal(dir.organization, null)
  assert.deepEqual(dir.friends.map((f) => [f.name, f.source]), [['合成客户', 'project']])
  assert.deepEqual(dir.projectColleagues.map((m) => m.name), ['项目律师'])
})

test('addImFriend rejects empty names', () => {
  assert.throws(() => addImFriend('acc', { name: '  ' }), /姓名/)
})
