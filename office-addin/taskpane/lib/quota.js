// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { siteCurrency } from './site.js'

/** 低额度警示线：约 1 美元的等值（人民币按 7 取整），随币种本地化 */
const LOW_THRESHOLD = { USD: 1, CNY: 7 }
const SYMBOL = { USD: '$', CNY: '¥' }

/** 额度所用币种：接口返回的 currency 优先，否则按站点域名 */
export function quotaCurrency(quota, serverUrl) {
  const c = quota && typeof quota.currency === 'string' ? quota.currency.toUpperCase() : ''
  return SYMBOL[c] ? c : siteCurrency(serverUrl)
}

export function formatQuotaMoney(value, currency) {
  return (SYMBOL[currency] || '$') + Number(value).toFixed(2)
}

export function isQuotaLow(quota, serverUrl) {
  if (!quota || !quota.hasKey || quota.remainingUsd == null) return false
  return Number(quota.remainingUsd) <= (LOW_THRESHOLD[quotaCurrency(quota, serverUrl)] || 1)
}

/** 额度文案参数：有上限给「剩余 / 共」，只有用量给「已用」，都没有返回 null */
export function quotaParts(quota, serverUrl) {
  if (!quota || !quota.hasKey) return null
  const cur = quotaCurrency(quota, serverUrl)
  const fmt = (v) => formatQuotaMoney(v, cur)
  if (quota.remainingUsd != null && quota.limitUsd != null) {
    return { key: 'quotaRemaining', params: { remaining: fmt(quota.remainingUsd), limit: fmt(quota.limitUsd) } }
  }
  if (quota.usageUsd != null) return { key: 'quotaUsed', params: { used: fmt(quota.usageUsd) } }
  return null
}
