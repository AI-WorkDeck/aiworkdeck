// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 前端读品牌配置的唯一出口（rfcs/2026-11-21-brand-profile.md §4）。
// brand.json 由 scripts/brand/apply-brand.mjs 写出，入库内容为默认品牌 aiworkdeck。
import profile from './brand.json'

export const DEFAULT_BRAND_ID = 'aiworkdeck'
export const UPSTREAM_NAME = 'AI WorkDeck'

export const brand = Object.freeze(profile)

export function isWhiteLabel(p = brand) {
  return p.id !== DEFAULT_BRAND_ID
}

// AGPL 告示、版权、商标说明里的「AI WorkDeck」指出处，贴牌版不替换。
// 键路径为 '<namespace>.<key>'，按前缀匹配（'admin.legal' 覆盖 legalCopyright、legalTrademark 等全部告示）。
export const PROTECTED_KEYS = ['admin.legal', 'account.portalSourceNotice']

export function isProtectedKey(path) {
  return PROTECTED_KEYS.some((k) => path.startsWith(k))
}

function rename(value, path, name) {
  if (typeof value === 'string') return isProtectedKey(path) ? value : value.split(UPSTREAM_NAME).join(name)
  if (Array.isArray(value)) return value.map((v, i) => rename(v, `${path}.${i}`, name))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = rename(v, path ? `${path}.${k}` : k, name)
    return out
  }
  return value
}

/** 贴牌版把词条里的产品名换成品牌名；默认品牌原样返回同一对象。messages 形如 { locale: { ns: {...} } }。 */
export function applyBrandToMessages(messages, p = brand) {
  if (!isWhiteLabel(p)) return messages
  const out = {}
  for (const [locale, namespaces] of Object.entries(messages)) out[locale] = rename(namespaces, '', p.name)
  return out
}

/**
 * 贴牌版窗口标题：页面标题来自 pages.json 的 navigationBarTitleText 与 index.html，
 * 这里在标题变化时把产品名换成品牌名（桌面窗口标题、任务栏取的就是 document.title）。默认品牌不安装。
 */
export function installBrandTitle(doc = typeof document !== 'undefined' ? document : null, p = brand) {
  if (!doc || !isWhiteLabel(p) || typeof MutationObserver === 'undefined') return null
  const fix = () => {
    if (doc.title.includes(UPSTREAM_NAME)) doc.title = doc.title.split(UPSTREAM_NAME).join(p.name)
  }
  fix()
  const observer = new MutationObserver(fix)
  observer.observe(doc.head, { subtree: true, childList: true, characterData: true })
  return observer
}
