// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 「把这份案卷放进团队案件库」的连接选取规则——**唯一来源**。
 *
 * 原先只长在 CollabDialog.onShare 里；加同事的弹窗也需要同一个按钮（案卷没进库时
 * 加谁都没有意义），复制一份的话两处必然慢慢分叉，而分叉的后果不是界面难看：
 * 拿错 connectionId 会把客户材料推去用户没选的服务器。
 *
 * 有意不 import '@/services/api.js'：调用方注入 share 函数，这个模块才跑得进
 * node --test（tests/member-invite/cloud-share.test.mjs），也才好在测试里断言
 * 「多于一条时一次都不许调 share」。
 */

/**
 * 后端云端写权限门禁（权限代次）对不上时回的 kind（VersionException.CLOUD_RECONNECT_REQUIRED）。
 * 弹窗据此就地写明原因并给「重新连接云端」按钮；不做自动重连。
 */
export const CLOUD_RECONNECT_REQUIRED = 'CLOUD_RECONNECT_REQUIRED'

/** 这个错误是不是要律师明确重新连接云端（只认 kind，不匹配文案）。 */
export function needsCloudReconnect(e) {
  return !!e && e.kind === CLOUD_RECONNECT_REQUIRED
}

/**
 * 门禁拒绝时显示哪句话。律师已经在这个弹窗里明确重新连接过（新令牌）还被拒，就不能再原样
 * 说一遍「请重新连接」——那会让人以为按钮没反应（教程第 11 集）。t 由调用方注入（this.$t）。
 */
export function reconnectRequiredMessage(e, reconnected, t) {
  if (reconnected) return t('version.reconnectDidNotHelp')
  return (e && e.message) || t('version.shareToLibraryFailed')
}

/** 多于一条连接时的拒绝理由（调用方据此选文案：version.tooManyLibraries）。 */
export const TOO_MANY_LIBRARIES = 'TOO_MANY_LIBRARIES'

/**
 * 选出这次该用哪条连接。
 *
 * 本机只认一个案件库：官方那个，或 cloud.collab.base-url 指过来的自建库。
 * 恰好只有一条连接时指名用它（省掉一次重新桥接）；没有连接时回 null，
 * 调用方据此**不传** connectionId，让后端连官方案件库再共享。
 * 多于一条（运维经 API 连出来的、或换过站点/案件库地址留下的历史状态）时直接拒绝
 * ——绝不「拿列表第一条」也绝不静默改推官方：前者会拿着失效令牌去推一个早已不在的
 * 服务器，后者会把案卷推去用户没选的地方。被拒后两个弹窗就地列出这几条连接
 * （LibraryConnectionList.vue），由律师自己断开不用的（问题 126，dev-board#1713）。
 */
export function pickShareConnectionId(connections) {
  const list = Array.isArray(connections) ? connections : []
  if (list.length > 1) return { ok: false, reason: TOO_MANY_LIBRARIES }
  return { ok: true, connectionId: list.length === 1 ? list[0].id : null }
}

/**
 * 放进案件库。share 由调用方注入（真实调用方传 api.js 的 shareProjectToCloud）。
 *
 * 回 `{ ok: true, connectionId }`，或 `{ ok: false, reason }`。
 * share 自己抛出的错（网络/后端 code=1）原样往外抛，由调用方就地显示。
 */
export async function shareProjectToLibrary({ projectId, connections, share }) {
  const picked = pickShareConnectionId(connections)
  if (!picked.ok) return picked
  await share(projectId, picked.connectionId)
  return { ok: true, connectionId: picked.connectionId }
}

/**
 * 多于一条连接被拒时，列给律师看的每一行：服务器（主机名）、是不是本站官方案件库、
 * 我在那边的身份、连上的时间。只用 GET /api/cloud/connections 现有字段，不带令牌。
 * officialServerUrl 来自 GET /api/cloud/official 的 serverUrl。
 */
export function describeLibraryConnections(connections, officialServerUrl) {
  const list = Array.isArray(connections) ? connections : []
  return list.map((c) => {
    let server = c.serverUrl || ''
    try { server = new URL(server).host || server } catch (e) { /* 原样显示 */ }
    return {
      id: c.id,
      server,
      official: !!officialServerUrl && c.serverUrl === officialServerUrl,
      who: c.displayName || c.username || '',
      connectedAt: c.connectedAt ? String(c.connectedAt).slice(0, 16).replace('T', ' ') : '',
    }
  })
}

/**
 * 断开一条连接：先 confirm（律师点了确定才回 true），再调注入的 disconnect
 * （真实调用方传 api.js 的 disconnectCloudConnection）。没确认一次都不调；
 * disconnect 抛的错原样往外抛。
 */
export async function disconnectLibraryConnection({ connectionId, confirm, disconnect }) {
  if (!(await confirm())) return { ok: false }
  await disconnect(connectionId)
  return { ok: true }
}

/**
 * 「重新绑定这份案卷」：已入库的案卷重新连接后仍被门禁拒（云端那份已不在/没权限）时，
 * 先 confirm，再拆掉本机绑定（unbind = api.js 的 unbindCloudProject，本机文件不动），
 * 再按 shareProjectToLibrary 同一套连接规则放进去一次（share = shareProjectToCloud，后端带幂等键）。
 * 连接选不出来（多于一条）时**先拒、一个字不拆**——拆完放不进去，案卷就白白掉出了案件库。
 * unbind/share 抛的错原样往外抛。
 */
export async function rebindProjectToLibrary({ projectId, connections, confirm, unbind, share }) {
  if (!(await confirm())) return { ok: false }
  const picked = pickShareConnectionId(connections)
  if (!picked.ok) return picked
  await unbind(projectId)
  await share(projectId, picked.connectionId)
  return { ok: true, connectionId: picked.connectionId }
}
