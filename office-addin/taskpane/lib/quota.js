// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 额度展示口径。后端 /api/platform-ai/key/status 的 limitUsd/usageUsd/remainingUsd 永远是美元；
 * 用户钱包是站点币种（大陆站人民币 = 美元 × 官网汇率 × 毛利乘数）。折算由后端按官网汇率完成，
 * 返回 currency 与 limitAmount/usageAmount/remainingAmount。这里只做显示：
 *   - 有 *Amount：按 currency 原样显示，不在前端做任何换算；
 *   - 没有（旧后端，或官网没给汇率）：显示美元原值并明确标 US$，绝不套 ¥ 符号冒充本币。
 */

/** 低额度警示线（本币口径）：约 1 美元的等值 */
const LOW_THRESHOLD = { USD: 1, CNY: 7 }

/** 币种 + 三个数（本币或美元原值）；没有任何可显示的数返回 null */
function amounts(quota) {
  if (!quota || !quota.hasKey) return null
  const hasConverted = quota.limitAmount !== undefined || quota.usageAmount !== undefined || quota.remainingAmount !== undefined
  const currency = hasConverted && typeof quota.currency === 'string' && quota.currency ? quota.currency.toUpperCase() : 'USD'
  const useAmount = hasConverted
  return {
    currency,
    // 无折算字段时明确是美元，显示 US$ 而不是 $，避免与本币混淆
    prefix: currency === 'CNY' ? '¥' : useAmount ? '$' : 'US$',
    limit: useAmount ? quota.limitAmount : quota.limitUsd,
    usage: useAmount ? quota.usageAmount : quota.usageUsd,
    remaining: useAmount ? quota.remainingAmount : quota.remainingUsd
  }
}

export function formatQuotaMoney(value, prefix) {
  return prefix + Number(value).toFixed(2)
}

export function isQuotaLow(quota) {
  const a = amounts(quota)
  if (!a || a.remaining == null) return false
  return Number(a.remaining) <= (LOW_THRESHOLD[a.currency] || 1)
}

/** 额度文案参数：有上限给「剩余 / 共」，只有用量给「已用」，都没有返回 null */
export function quotaParts(quota) {
  const a = amounts(quota)
  if (!a) return null
  const fmt = (v) => formatQuotaMoney(v, a.prefix)
  if (a.remaining != null && a.limit != null) {
    return { key: 'quotaRemaining', params: { remaining: fmt(a.remaining), limit: fmt(a.limit) } }
  }
  if (a.usage != null) return { key: 'quotaUsed', params: { used: fmt(a.usage) } }
  return null
}
