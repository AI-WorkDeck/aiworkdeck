// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createI18n } from 'vue-i18n'
import {
  getAppLanguage,
  syncDocumentLang,
  SUPPORTED_LOCALES,
  normalizeLocaleCode,
  APP_LANGUAGE_EVENT,
  registerReactiveLocaleTracker,
} from '../utils/appLanguage.js'

/**
 * 国际化入口（vue-i18n v9，legacy 模式以兼容 Options API 的 `this.$t` 与模板 `$t`，dev-board#1477）：
 * - 语言包按业务域拆在 `src/locales/<locale>/<namespace>.js`，由单条 `import.meta.glob` 自动发现
 * - 容忍缺失的语言目录或命名空间文件（Phase A 仅 zh-CN / en-US 全量，其余语种按回退链兜底）
 * - 回退链：zh-TW -> zh-CN；其余语种 -> en-US -> zh-CN
 * - 热切换：调 `applyI18nLocale(lang)` 或 `setAppLanguage(lang)` 即刻切换 `i18n.global.locale` 与 `<html lang/dir>`，无需刷新页面
 */

let localeModules = {}
try {
  localeModules = import.meta.glob('../locales/*/*.js', { eager: true })
} catch (e) {
  localeModules = globalThis.__AWD_LOCALE_GLOB__ || {}
}

export const LOCALE_FALLBACK_MAP = {
  'zh-TW': ['zh-CN'],
  'en-US': ['zh-CN'],
  default: ['en-US', 'zh-CN'],
}

export function buildMessages(modules) {
  const out = {}
  for (const code of SUPPORTED_LOCALES) {
    out[code] = {}
  }
  for (const [path, mod] of Object.entries(modules || {})) {
    // path 形如 '../locales/zh-CN/common.js' -> locale = 'zh-CN', ns = 'common'
    const m = path.match(/\/locales\/([^/]+)\/([^/]+)\.js$/)
    if (!m) continue
    const [, locale, ns] = m
    if (!out[locale]) out[locale] = {}
    out[locale][ns] = mod.default || mod
  }
  return out
}

const initialLocale = getAppLanguage()
syncDocumentLang(initialLocale)

export const i18n = createI18n({
  legacy: true,
  locale: SUPPORTED_LOCALES.includes(initialLocale) ? initialLocale : 'en-US',
  fallbackLocale: LOCALE_FALLBACK_MAP,
  silentFallbackWarn: true,
  silentTranslationWarn: true,
  messages: buildMessages(localeModules),
})

registerReactiveLocaleTracker(() => (
  i18n.global.locale && typeof i18n.global.locale === 'object' && 'value' in i18n.global.locale
    ? i18n.global.locale.value
    : i18n.global.locale
))

/**
 * 供纯 JS 模块（services/api.js、utils/*、config/*）在组件树外取词。
 */
export function t(key, params) {
  return i18n.global.t(key, params)
}

/**
 * 热切换 vue-i18n 当前语言，同步更新 `<html lang>` 与 `<html dir>`。
 * 无需整页 reload。
 */
export function applyI18nLocale(lang) {
  const resolved = normalizeLocaleCode(lang) || getAppLanguage()
  const target = SUPPORTED_LOCALES.includes(resolved) ? resolved : 'en-US'
  if (i18n.global.locale && typeof i18n.global.locale === 'object' && 'value' in i18n.global.locale) {
    i18n.global.locale.value = target
  } else {
    i18n.global.locale = target
  }
  syncDocumentLang(target)
  return target
}

try {
  if (typeof uni !== 'undefined' && typeof uni.$on === 'function') {
    uni.$on(APP_LANGUAGE_EVENT, (lang) => {
      applyI18nLocale(lang)
    })
  }
} catch (e) { /* ignore */ }

export default i18n
