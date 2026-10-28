// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  SYSTEM_LANGUAGE_MODE,
  LOCALE_REGISTRY,
  SUPPORTED_LOCALE_CODES,
  LOCALE_MAP,
  COUNTRY_TO_LOCALE,
  normalizeLocaleCode,
  normalizeLanguageSetting,
  matchSystemLocale,
  matchCountryToLocale,
  getLocaleEntry,
  getLocaleFallbackChain,
} from '../locales/registry.js'

/**
 * 应用语言（20 语种 + 跟随系统 system，dev-board#1477）：
 * - 存储键：`app_language`（uni.getStorageSync / localStorage），值为 20 个规范 BCP-47 代码之一或 `'system'`
 * - 默认值：首次未设置时按系统/浏览器语言自动匹配（exact -> prefix -> 'en-US'）
 * - 广播事件：切换时通过 `uni.$emit('app-language-changed', resolvedLang)` 通知根组件与 i18n
 */

export const APP_LANGUAGE_KEY = 'app_language'
// 用户是否主动点过语言切换器（登录页 / 设置面板 / 菜单）。一旦置 '1'，站点切换不再自动改语言。
export const APP_LANGUAGE_MANUAL_KEY = 'app_language_manual'
export const APP_LANGUAGE_EVENT = 'app-language-changed'

export {
  SYSTEM_LANGUAGE_MODE,
  LOCALE_REGISTRY,
  SUPPORTED_LOCALE_CODES,
  LOCALE_MAP,
  COUNTRY_TO_LOCALE,
  normalizeLocaleCode,
  normalizeLanguageSetting,
  matchSystemLocale,
  matchCountryToLocale,
  getLocaleEntry,
  getLocaleFallbackChain,
}

export const SUPPORTED_LOCALES = SUPPORTED_LOCALE_CODES
export const SUPPORTED_LANGUAGES = Object.freeze([
  ...SUPPORTED_LOCALE_CODES,
  SYSTEM_LANGUAGE_MODE,
])

function detectSystemLocale() {
  try {
    if (typeof navigator !== 'undefined') {
      const candidates = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language || navigator.userLanguage || '']
      for (const c of candidates) {
        const matched = normalizeLocaleCode(String(c || ''))
        if (matched) return matched
      }
    }
    if (typeof uni !== 'undefined' && typeof uni.getSystemInfoSync === 'function') {
      const sys = uni.getSystemInfoSync()
      const raw = String((sys && (sys.appLanguage || sys.language)) || '')
      const matched = normalizeLocaleCode(raw)
      if (matched) return matched
    }
  } catch (e) {
    // ignore
  }
  return 'en-US'
}

function readStorage(key = APP_LANGUAGE_KEY) {
  try {
    if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
      const v = uni.getStorageSync(key)
      if (v) return String(v)
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(key)
      if (v) return String(v)
    }
  } catch (e) { /* ignore */ }
  return ''
}

function writeStorage(key, val) {
  if (val === undefined) {
    val = key
    key = APP_LANGUAGE_KEY
  }
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync(key, val)
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val)
    }
  } catch (e) { /* ignore */ }
}

export function isLanguageManuallyChosen() {
  return readStorage(APP_LANGUAGE_MANUAL_KEY) === '1'
}

/**
 * 返回用户保存的语言偏好：`'system'`（跟随系统）或 20 个规范语言代码之一。
 */
export function getAppLanguagePreference() {
  const stored = readStorage(APP_LANGUAGE_KEY)
  const normalized = normalizeLanguageSetting(stored)
  if (normalized) {
    if (stored !== normalized) writeStorage(APP_LANGUAGE_KEY, normalized)
    return normalized
  }
  return isLanguageManuallyChosen() ? getAppLanguage() : SYSTEM_LANGUAGE_MODE
}

let _reactiveLocaleTracker = null

export function registerReactiveLocaleTracker(fn) {
  _reactiveLocaleTracker = typeof fn === 'function' ? fn : null
}

/**
 * 返回当前生效的规范语言代码（恒为 20 个 BCP-47 代码之一，不会返回 `'system'`）。
 */
export function getAppLanguage() {
  if (_reactiveLocaleTracker) {
    try { _reactiveLocaleTracker() } catch (e) { /* ignore */ }
  }
  const stored = readStorage(APP_LANGUAGE_KEY)
  const normalized = normalizeLanguageSetting(stored)
  if (normalized === SYSTEM_LANGUAGE_MODE) {
    return detectSystemLocale()
  }
  if (normalized) {
    if (stored !== normalized) writeStorage(APP_LANGUAGE_KEY, normalized)
    return normalized
  }
  const detected = detectSystemLocale()
  writeStorage(APP_LANGUAGE_KEY, detected)
  return detected
}

export function getLocaleMeta(lang = getAppLanguage()) {
  return getLocaleEntry(lang)
}

export function syncDocumentLang(lang = getAppLanguage()) {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      const entry = getLocaleEntry(lang)
      document.documentElement.lang = entry.bcp47 || lang
      document.documentElement.dir = entry.dir || 'ltr'
    }
  } catch (e) { /* SSR / non-DOM */ }
}

/**
 * @param {string} lang  20 个规范语言代码之一、旧版简写（'zh'/'en'）或 `'system'`
 * @param {{ auto?: boolean }} [opts]  auto=true 表示站点联动或远端拉取自动改语言，不记为「用户手动选过」
 */
export function setAppLanguage(lang, opts = {}) {
  const normalized = normalizeLanguageSetting(lang)
  if (!normalized) return getAppLanguage()
  writeStorage(APP_LANGUAGE_KEY, normalized)
  if (!opts.auto) writeStorage(APP_LANGUAGE_MANUAL_KEY, '1')
  const resolved = normalized === SYSTEM_LANGUAGE_MODE ? detectSystemLocale() : normalized
  syncDocumentLang(resolved)
  try {
    if (typeof uni !== 'undefined' && typeof uni.$emit === 'function') {
      uni.$emit(APP_LANGUAGE_EVENT, resolved)
    }
  } catch (e) { /* ignore */ }
  return resolved
}

export function isChineseUi(lang = getAppLanguage()) {
  const code = normalizeLocaleCode(lang) || getAppLanguage()
  return code === 'zh-CN' || code === 'zh-TW'
}

/**
 * 二元 `{ zh, en }` 调用点的非中文判定：
 * 所有非中文语种在只有 `{ zh, en }` 的地方一律走英文兜底（!isChineseUi()）。
 */
export function isEnglish() {
  return !isChineseUi()
}

/**
 * 轻量内联多语种字典取值：
 * 支持 `{ zh: '...', en: '...' }` 或包含任意规范语言键 `{ 'zh-CN', 'zh-TW', 'en-US', 'ja-JP', ... }`。
 * 回退链：当前语言 -> (zh-TW 回退 zh-CN/zh；其他语言回退 en-US/en -> zh-CN/zh)。
 */
export function tr(map) {
  if (!map) return ''
  if (typeof map === 'string') return map
  const lang = getAppLanguage()
  if (map[lang] != null && map[lang] !== '') return map[lang]
  const entry = getLocaleEntry(lang)
  if (entry && map[entry.slug] != null && map[entry.slug] !== '') return map[entry.slug]
  if (entry && map[entry.prefix] != null && map[entry.prefix] !== '') return map[entry.prefix]
  if (lang === 'zh-TW' || lang === 'zh-CN') {
    return map['zh-CN'] ?? map.zh ?? map['en-US'] ?? map.en ?? ''
  }
  return map['en-US'] ?? map.en ?? map['zh-CN'] ?? map.zh ?? ''
}
