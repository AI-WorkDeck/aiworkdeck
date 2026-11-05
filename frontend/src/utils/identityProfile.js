// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 展示名与头像该写去哪儿、以及「填写你的姓名」那条引导弹不弹的纯判定
 * （设计见 docs/superpowers/specs/2026-09-10-identity-display-source-design.md §6）。
 *
 * 单独成文件是为了能被 node --test 直接跑（tests/identity/）：这两条判定错了都是静默的——
 * 源判错会把昵称写进本机 User 行而官网纹丝不动（用户改完名，同事看到的还是打码手机号），
 * 弹窗判错则要么一次都不弹、要么每次开机都弹。
 *
 * 与 utils/memberLookup.js 同一条纪律：**这里不许 import 任何东西**（含 uni），
 * 一引别名 node 就解析不了，这套测试只能退化成源码字符串断言。
 */

/** 展示名/头像的写入目标。 */
export const PROFILE_SOURCE = {
  /** 官网账户（唯一权威源）：走本机后端的 /api/account/* 四个端点转发。 */
  ACCOUNT: 'ACCOUNT',
  /** 自建服务器：本机用户表就是权威源，头像走既有 POST /api/users/avatar，昵称本期不可改。 */
  LOCAL: 'LOCAL',
}

/**
 * 只有「桌面端单机 local-mode」且「已连接官网账户」两条同时成立，才写官网。
 *
 * 少一条就必须回落 LOCAL：自建服务器根本没有官网 Key，local-mode 但没连账户时
 * 后端那四个端点会回「未连接账户」——把界面按官网态画出来等于给用户一个必然失败的输入框。
 */
export function resolveProfileSource({ localMode, connected } = {}) {
  return localMode && connected ? PROFILE_SOURCE.ACCOUNT : PROFILE_SOURCE.LOCAL
}

/** 「填写你的姓名」弹窗的已读记录（按 accountId 记）落盘用的 storage key。 */
export const NAME_NUDGE_STORAGE_KEY = 'awd_name_nudge_dismissed'

/** 点「稍后」后隔多久再提醒；最多再提醒 2 次（含首次共 3 次）。 */
export const NAME_NUDGE_REMIND_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000
export const NAME_NUDGE_MAX_SHOWS = 3

/**
 * 这一次该不该弹「填写你的姓名」。
 *
 * records 是 {accountId: {n: 已弹次数, at: 上次弹出的毫秒时间, done: 是否已不再提醒}}；
 * 老版本落的是 accountId 数组，按「弹过 1 次、时间未知」算（升级后到期可再提醒）。
 * 要成立：确实还是默认名、认得出是哪个账户，并且从没弹过，或（没被标 done、没弹满 3 次、
 * 距上次已满 3 天）。accountId 缺失时**不弹**——记不下「已读」的弹窗会变成每次都弹。
 */
export function shouldPromptNameNudge({ displayNameIsDefault, accountId, records, dismissedIds, now } = {}) {
  if (!displayNameIsDefault) return false
  const id = String(accountId == null ? '' : accountId)
  if (!id) return false
  const rec = normalizeNudgeRecords(records !== undefined ? records : dismissedIds)[id]
  if (!rec) return true
  if (rec.done || rec.n >= NAME_NUDGE_MAX_SHOWS) return false
  const t = typeof now === 'number' ? now : Date.now()
  return t - rec.at >= NAME_NUDGE_REMIND_INTERVAL_MS
}

/**
 * 记下「这个账户刚弹过一次」。done=true 表示用户点了「去填写」，之后不再提醒。
 * 回新对象，调用方直接落盘。上限 50 个账户：无上限会把 storage 撑成垃圾场。
 */
export function withNudgeShown(records, accountId, now, done = false) {
  const id = String(accountId == null ? '' : accountId)
  const map = normalizeNudgeRecords(records)
  if (!id) return map
  const prev = map[id]
  const next = { n: (prev ? prev.n : 0) + (done && prev ? 0 : 1), at: typeof now === 'number' ? now : Date.now(), done: !!done || (prev ? prev.done : false) }
  delete map[id]
  map[id] = next
  const keys = Object.keys(map)
  for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete map[k]
  return map
}

/**
 * 输入框 confirm/blur 那一刻用户真正提交的文字。
 *
 * uni-h5 的 v-model 有 100ms 节流：打完最后一个字立刻回车，绑定的 data 还是上一拍的值，
 * 只有事件自己带的 detail.value 是最新的。事件不带字符串值时回落绑定值。
 */
export function submittedInputValue(event, fallback) {
  const value = event && event.detail ? event.detail.value : undefined
  return typeof value === 'string' ? value : fallback
}

/** storage 里读回来的东西可能是任何形状：新版是对象，老版是 accountId 数组，其余一律当空。 */
export function normalizeNudgeRecords(value) {
  const out = {}
  if (Array.isArray(value)) {
    for (const v of value) {
      const id = String(v == null ? '' : v)
      if (id) out[id] = { n: 1, at: 0, done: false }
    }
  } else if (value && typeof value === 'object') {
    for (const [id, r] of Object.entries(value)) {
      if (!id || !r || typeof r !== 'object') continue
      out[id] = { n: Number(r.n) > 0 ? Number(r.n) : 1, at: Number(r.at) || 0, done: !!r.done }
    }
  }
  return out
}
