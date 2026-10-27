// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 极简 i18n（Office Add-in，20 语种 + 跟随系统 system，dev-board#150 / #1477）：
 *   语言优先级：localStorage('checkba.lang') > Office.context.displayLanguage > navigator.language > 'en-US'。
 *   支持 20 个规范 BCP-47 代码、'system'（跟随系统），并向下兼容旧版 'zh' / 'en'。
 *
 * setLang() 可在运行时切换——字典查询走可变的 activeTag，界面由 App.vue 的
 * langKey 响应式 ref 触发重绘。
 */

import { ZH } from '../locales/zh-CN.js'
import { EN } from '../locales/en-US.js'
import {
  SYSTEM_LANGUAGE_MODE,
  LOCALE_REGISTRY,
  SUPPORTED_LOCALE_CODES,
  LOCALE_MAP,
  normalizeLocaleCode,
  normalizeLanguageSetting,
  matchSystemLocale,
  getLocaleEntry,
  getLocaleFallbackChain,
} from '../locales/registry.js'

export {
  ZH,
  EN,
  SYSTEM_LANGUAGE_MODE,
  LOCALE_REGISTRY,
  SUPPORTED_LOCALE_CODES,
  LOCALE_MAP,
  normalizeLocaleCode,
  normalizeLanguageSetting,
  matchSystemLocale,
  getLocaleEntry,
  getLocaleFallbackChain,
}

export const LANG_STORAGE_KEY = 'checkba.lang'

export const LOCALE_DICTIONARIES = {
  'zh-CN': ZH,
  'en-US': EN,
}

try {
  const extraModules = import.meta.glob('../locales/*.js', { eager: true })
  for (const [p, mod] of Object.entries(extraModules || {})) {
    const m = p.match(/\/locales\/([^/]+)\.js$/)
    if (!m || m[1] === 'registry') continue
    const code = normalizeLocaleCode(m[1])
    if (code && mod && (mod.default || mod[code])) {
      LOCALE_DICTIONARIES[code] = mod.default || mod[code]
    }
  }
} catch {
  // node --test 环境无 Vite import.meta.glob，按已静态导入的字典运行
}

export function registerLocaleDictionary(code, dict) {
  const canonical = normalizeLocaleCode(code)
  if (canonical && dict && typeof dict === 'object') {
    LOCALE_DICTIONARIES[canonical] = dict
  }
}

function detectHostOrBrowserLocale() {
  let raw = ''
  try {
    if (typeof Office !== 'undefined' && Office?.context?.displayLanguage) {
      raw = Office.context.displayLanguage
    }
  } catch { /* Office 未就绪时读 context 可能抛 */ }
  if (!raw && typeof navigator !== 'undefined' && navigator?.language) {
    raw = navigator.language
  }
  return matchSystemLocale(String(raw || ''))
}

function detectInitialLangState() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LANG_STORAGE_KEY)
      const normalized = normalizeLanguageSetting(saved)
      if (normalized === SYSTEM_LANGUAGE_MODE) {
        return { pref: SYSTEM_LANGUAGE_MODE, tag: detectHostOrBrowserLocale() }
      }
      if (normalized) {
        return { pref: normalized, tag: normalized }
      }
    }
  } catch { /* WebView 禁 storage 时降级自动探测 */ }
  return { pref: SYSTEM_LANGUAGE_MODE, tag: detectHostOrBrowserLocale() }
}

const initialState = detectInitialLangState()
let activePref = initialState.pref
let activeTag = initialState.tag

export const currentLangTag = activeTag
export const currentLang = activeTag.startsWith('zh') ? 'zh' : 'en'

/**
 * 返回简写语言桶（'zh' | 'en'）：供既有二元逻辑（分号、项目名回退等）判断中文 vs 非中文。
 */
export function getLang() {
  return activeTag.startsWith('zh') ? 'zh' : 'en'
}

/**
 * 返回当前生效的规范 BCP-47 语言标签（20 个规范代码之一，如 'zh-CN' / 'en-US' / 'ja-JP'）。
 * 供请求头 X-App-Language 与 chat 请求体 appLanguage 使用。
 */
export function getLangTag() {
  return activeTag
}

/**
 * 返回用户当前选择的语言偏好：'system' 或 20 个规范 BCP-47 代码之一。
 */
export function getLangPreference() {
  return activePref
}

export function getLocaleMeta(code = activeTag) {
  return getLocaleEntry(code)
}

/**
 * 把当前语言同步到 `<html lang>` 与 `<html dir>`。
 * index.html / wps.html 的开源告示页脚挂在 `#app` 之外，靠 CSS 选择器切换中英文，
 * 同时 `ar-SA` 靠 `dir="rtl"` 驱动右起排版。
 */
function syncDocumentLang() {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      const entry = getLocaleEntry(activeTag)
      document.documentElement.lang = entry.bcp47 || activeTag
      document.documentElement.dir = entry.dir || 'ltr'
    }
  } catch { /* node --test 里没有 document */ }
}
syncDocumentLang()

export function setLang(lang) {
  const normalized = normalizeLanguageSetting(lang)
  if (!normalized) return activeTag
  activePref = normalized
  activeTag = normalized === SYSTEM_LANGUAGE_MODE ? detectHostOrBrowserLocale() : normalized
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_STORAGE_KEY, normalized)
  } catch { /* ignore */ }
  syncDocumentLang()
  return activeTag
}

function resolveTemplate(key) {
  const chain = getLocaleFallbackChain(activeTag)
  for (const code of chain) {
    const dict = LOCALE_DICTIONARIES[code]
    if (dict && dict[key] !== undefined) {
      return dict[key]
    }
  }
  return undefined
}

export function t(key, params) {
  const tpl = resolveTemplate(key)
  if (tpl === undefined) return key
  if (!params) return tpl
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
}
