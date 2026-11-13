// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 站点名按界面语言显示（英文 QA 2026-11-14 第 4 条）：后端 /site 回的 displayName 是
// application.yml 里的中文配置名（「AI WorkDeck 国内站」），已知站点按 id 换成词条，
// 未知站点（私有部署自配的）原样显示。
const SITE_NAME_KEYS = { cn: 'admin.siteNameCn', intl: 'admin.siteNameIntl' }

export function siteDisplayName(site, translate) {
  if (!site) return ''
  const key = SITE_NAME_KEYS[site.id]
  if (key && typeof translate === 'function') {
    const name = translate(key)
    if (name && name !== key) return name
  }
  return site.displayName || site.id || ''
}

// 整份站点列表换名，调用方其余字段不变
export function localizeSites(sites, translate) {
  return (Array.isArray(sites) ? sites : []).map((s) => (s ? { ...s, displayName: siteDisplayName(s, translate) } : s))
}
