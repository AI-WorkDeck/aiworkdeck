// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { i18n, t } from '../i18n'

/** 当前界面语言（vue-i18n legacy 模式下可能是字符串也可能是 ref）。 */
function currentLocale() {
  const l = i18n.global.locale
  return l && typeof l === 'object' && 'value' in l ? l.value : l
}

/**
 * 人民币金额（元）的简写：简体中文沿用「x 万」词条 zhKey；其他语言从真实金额按当地习惯缩写
 * （Intl.NumberFormat compact，如 CN¥10.3M、1030万元），不在译文里拼「0k」之类单位——
 * 曾把 ¥1,030 万显示成「¥1,030.000k」（小了 10 倍）。
 */
export function formatCnyCompact(yuan, zhKey) {
  const amount = Number(yuan) || 0
  const locale = currentLocale()
  if (!locale || locale === 'zh-CN') return t(zhKey, { amount: (amount / 10000).toFixed(2) })
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY', notation: 'compact', maximumSignificantDigits: 3 }).format(amount)
  } catch (e) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'CNY', notation: 'compact', maximumSignificantDigits: 3 }).format(amount)
  }
}
