// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 项目沟通 · 通讯录的唯一数据源（宿主左栏 PluginWorkspaceSummary 与插件桥 PluginPane 共用）。
//
// 红线：只展示真实数据，绝不编造联系人 / 部门 / 律所。拿不到就返回 null / 空数组，
// 由界面给出「去创建或加入」的空态入口。
//
// 组织模型（官网现行契约，见 services/api.js 团队段）：
//   - 一个账户同一时间至多属于一个团队（organization）；
//   - 一个团队至多并入一家律所（firm），律所下有若干团队（firm.teams，只有名称与人数，没有成员明细）；
//   - 「我的朋友」是个人通讯录，按账户隔离存本机，切换团队 / 律所不影响；
//   - 项目里授权的客户（项目成员表 role=CLIENT）并入「我的朋友」并标注来源。
// 切换团队 / 律所在「设置 › 团队」完成（TeamPanel），完成后广播 awd:org-changed，本模块调用方重拉。

const FRIENDS_KEY_PREFIX = 'awd_im_friends_v2:'
const MAX_FRIENDS = 300

const ROLE_LABELS = { OWNER: '负责人', ADMIN: '管理员', MEMBER: '成员' }
const ROLE_LABELS_EN = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' }

function isEnLang() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('checkba_app_language') === 'en-US') return true
    if (typeof document !== 'undefined' && document.documentElement?.lang === 'en-US') return true
  } catch (_) { /* ignore */ }
  return false
}

function str(value, max = 120) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function storage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch (e) {
    return null
  }
}

export function friendsStorageKey(accountKey) {
  return FRIENDS_KEY_PREFIX + (str(accountKey, 80) || 'local')
}

export function readImFriends(accountKey) {
  const s = storage()
  if (!s) return []
  try {
    const parsed = JSON.parse(s.getItem(friendsStorageKey(accountKey)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((f) => f && str(f.name)) : []
  } catch (e) {
    return []
  }
}

export function writeImFriends(accountKey, list) {
  const s = storage()
  const next = (Array.isArray(list) ? list : []).slice(0, MAX_FRIENDS)
  if (s) {
    try { s.setItem(friendsStorageKey(accountKey), JSON.stringify(next)) } catch (e) { /* quota */ }
  }
  return next
}

export function addImFriend(accountKey, input = {}) {
  const name = str(input.name, 64)
  if (!name) throw Object.assign(new Error(isEnLang() ? 'Please enter a contact name' : '请输入联系人姓名'), { code: 'invalid_params' })
  const entry = {
    id: 'fr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name,
    org: str(input.org, 80),
    roleLabel: str(input.roleLabel || input.role, 32),
    note: str(input.note, 120),
  }
  const next = [entry, ...readImFriends(accountKey).filter((f) => f.name !== name)]
  return { friends: writeImFriends(accountKey, next), added: entry }
}

export function removeImFriend(accountKey, id) {
  const next = readImFriends(accountKey).filter((f) => String(f.id) !== String(id))
  return writeImFriends(accountKey, next)
}

function unwrapList(res) {
  if (Array.isArray(res)) return res
  if (res && Array.isArray(res.data)) return res.data
  if (res && Array.isArray(res.members)) return res.members
  if (res && res.data && Array.isArray(res.data.members)) return res.data.members
  return []
}

function unwrapUser(res) {
  if (!res || typeof res !== 'object') return null
  if (res.data && typeof res.data === 'object' && (res.data.id != null || res.data.username)) return res.data
  return res
}

/**
 * 拉通讯录。deps 注入 API（便于测试且避免循环依赖）：{ getTeam, getProjectMembers, getCurrentUser }。
 * 任何一步失败只影响对应分组，并在 errors 里如实标出，不用假数据补位。
 */
export async function loadImDirectory({ projectId, deps = {} } = {}) {
  const errors = []
  let teamData = null
  let me = null
  let projectMembers = []
  try {
    if (typeof deps.getCurrentUser === 'function') me = unwrapUser(await deps.getCurrentUser())
  } catch (e) { errors.push('me') }
  try {
    if (typeof deps.getTeam === 'function') teamData = await deps.getTeam()
  } catch (e) { errors.push('team') }
  try {
    if (projectId && typeof deps.getProjectMembers === 'function') projectMembers = unwrapList(await deps.getProjectMembers(projectId))
  } catch (e) { errors.push('projectMembers') }

  const team = teamData && teamData.team ? teamData.team : null
  const myRole = str(teamData && teamData.myRole, 16).toUpperCase()
  const myAccountId = str(teamData && teamData.myAccountId, 80)
  const accountKey = myAccountId || str(me && (me.id != null ? me.id : me.username), 80) || 'local'

  const en = isEnLang()
  const roleMap = en ? ROLE_LABELS_EN : ROLE_LABELS
  const organization = team ? {
    id: team.id == null ? '' : String(team.id),
    name: str(team.name, 80),
    myRole,
    myRoleLabel: roleMap[myRole] || '',
    members: (Array.isArray(teamData.members) ? teamData.members : [])
      .map((m) => ({
        id: str(m.accountId || m.userId || m.id, 80),
        name: str(m.displayName || m.username || m.accountId, 64),
        role: str(m.role, 16).toUpperCase(),
        roleLabel: roleMap[str(m.role, 16).toUpperCase()] || (en ? 'Member' : '成员'),
        isMe: !!myAccountId && str(m.accountId, 80) === myAccountId,
      }))
      .filter((m) => m.name),
  } : null

  const firmRaw = teamData && teamData.firm ? teamData.firm : null
  const firm = firmRaw ? {
    id: firmRaw.id == null ? '' : String(firmRaw.id),
    name: str(firmRaw.name, 80),
    // isHead：本团队是否总部团队（服务端下发，不自行推断）
    isHead: !!firmRaw.isHead,
    teams: (Array.isArray(firmRaw.teams) ? firmRaw.teams : [])
      .map((t) => ({
        id: t.id == null ? '' : String(t.id),
        name: str(t.name, 80),
        isHead: !!t.isHead,
        memberCount: typeof t.memberCount === 'number' ? t.memberCount : null,
        isMine: !!(team && t.id != null && String(t.id) === String(team.id)),
      }))
      .filter((t) => t.name),
  } : null

  // 项目组（非客户）成员：作为「当前项目」补充，单列，不冒充团队成员
  const projectColleagues = []
  const clients = []
  for (const m of projectMembers) {
    const role = str(m.role, 16).toUpperCase()
    const name = str(m.displayName || m.nickname || m.username, 64)
    if (!name) continue
    const entry = { id: str(m.userId || m.id || name, 80), name, role }
    if (role === 'CLIENT') clients.push(entry)
    else projectColleagues.push(Object.assign(entry, { roleLabel: role === 'OWNER' ? (en ? 'Project Lead' : '项目负责人') : (en ? 'Project Member' : '项目成员') }))
  }

  const friends = readImFriends(accountKey).map((f) => Object.assign({ source: 'personal' }, f))
  for (const c of clients) {
    if (friends.some((f) => f.name === c.name)) continue
    friends.push({ id: 'client-' + c.id, name: c.name, org: en ? 'Current Project Client' : '当前项目客户', roleLabel: en ? 'Client' : '客户', source: 'project' })
  }

  const isTeamOwner = myRole === 'OWNER'
  const capabilities = {
    hasTeam: !!organization,
    hasFirm: !!firm,
    isTeamOwner,
    // 与 TeamPanel.canLeave / canLeaveFirm 同口径；只决定提示文案，真正的闸门在官网
    canSwitchTeam: !!organization && !isTeamOwner && !!myAccountId,
    canSwitchFirm: !!firm && !firm.isHead && isTeamOwner,
    canJoinFirm: !!organization && !firm && isTeamOwner,
  }

  return {
    accountKey,
    me: me ? { id: me.id == null ? '' : String(me.id), name: str(me.displayName || me.nickname || me.username, 64) } : null,
    organization,
    firm,
    projectColleagues,
    friends,
    capabilities,
    errors,
  }
}
