// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 包晴天积分通道（billingLine=bqt）：余额与扣点以官网为准，这类账户只能在包晴天 App 充值/续费。
// 后端把 billingLine / bqtMember 原样透传（旧官网缺省为 standard / null），
// 网关与账户端点的拒绝带 reason=bqt_*，这里统一换成多语种提示。

export const BQT_ERROR_CODES = Object.freeze([
  'bqt_member_invalid', 'bqt_ai_closed', 'bqt_insufficient_points',
  'bqt_outstanding_debt', 'bqt_unavailable', 'bqt_model_not_allowed', 'bqt_recharge_via_bqt',
])

// 词条名 = 错误码转驼峰（bqt_ai_closed → agentStream.bqtAiClosed）；services/api.js 内联了同一规则
const messageKey = code => 'agentStream.' + code.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

const CODE_IN_TEXT = /\b(bqt_(?:member_invalid|ai_closed|insufficient_points|outstanding_debt|unavailable|model_not_allowed|recharge_via_bqt))\b/

/** 从错误对象 / 载荷的 reason，或一段错误文本里认出 bqt 错误码；认不出返回 ''。 */
export function bqtErrorCode(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const m = CODE_IN_TEXT.exec(value)
    return m ? m[1] : ''
  }
  return BQT_ERROR_CODES.includes(value.reason) ? value.reason : ''
}

/** bqt 错误码对应的提示；不是 bqt 码返回 ''，调用方回落原有文案。 */
export function bqtErrorMessage(code, t) {
  return BQT_ERROR_CODES.includes(code) ? t(messageKey(code)) : ''
}

/** 余额/用量回包是否属于包晴天积分通道：只认后端透传的 billingLine，缺省按普通账户。 */
export function isBqtBillingLine(data) {
  return !!data && data.billingLine === 'bqt'
}

/** 设置页会员卡要展示的派生字段；bqtMember 缺失返回 null。 */
export function bqtMemberView(member) {
  if (!member || typeof member !== 'object') return null
  const levelKey = member.levelCode === 'LIGHT' ? 'admin.bqtLevelLight'
    : member.levelCode === 'GROWTH' ? 'admin.bqtLevelGrowth' : 'admin.bqtLevelNone'
  const cents = Number(member.cents)
  const outstanding = Number(member.outstandingCents)
  const failed = Number(member.failedCount)
  return {
    levelKey,
    active: member.status === 'ACTIVE',
    aiWorkbench: member.aiWorkbench !== false,
    expireAt: member.expireAt || null,
    points: member.points == null ? '—' : String(member.points),
    credits: Number.isFinite(cents) ? (cents / 100).toFixed(2) : '—',
    outstandingCredits: Number.isFinite(outstanding) ? (outstanding / 100).toFixed(2) : '0.00',
    failedCount: Number.isFinite(failed) ? failed : 0,
    hasDebt: (Number.isFinite(outstanding) && outstanding > 0) || (Number.isFinite(failed) && failed > 0),
  }
}
