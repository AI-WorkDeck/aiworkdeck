// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

const fs = require('fs')
const path = require('path')
const { app } = require('electron')

/**
 * 桌面主进程的应用语言状态（20 语种 + 跟随系统 system，dev-board#1477）。
 * 渲染层（uni storage `app_language`）是权威源，启动与切换时通过 IPC 同步过来；
 * 这里同时落盘一份到 userData/app-language.json，保证窗口还没打开或首次构建原生菜单时
 * 主进程自己也能拿到上次的语言，不等渲染层上报。
 *
 * 与下列两处保持同源（由 frontend/tests/i18n/multilang-infra.test.mjs 守护）：
 *   - frontend/src/locales/registry.js
 *   - office-addin/taskpane/locales/registry.js
 */

const SYSTEM_LANGUAGE_MODE = 'system'

const LOCALE_REGISTRY = Object.freeze([
  {
    code: 'zh-CN',
    slug: 'zh',
    mobileCode: 'zh-Hans',
    nativeName: '简体中文',
    englishName: 'Simplified Chinese',
    shortBadge: '简',
    prefix: 'zh',
    dir: 'ltr',
    lowaUiLang: 'zh-CN',
    bcp47: 'zh-CN',
    allowHan: true,
  },
  {
    code: 'zh-TW',
    slug: 'zh-hant',
    mobileCode: 'zh-Hant',
    nativeName: '繁體中文',
    englishName: 'Traditional Chinese',
    shortBadge: '繁',
    prefix: 'zh-hant',
    dir: 'ltr',
    lowaUiLang: 'zh-CN',
    bcp47: 'zh-TW',
    allowHan: true,
  },
  {
    code: 'en-US',
    slug: 'en',
    mobileCode: 'en',
    nativeName: 'English',
    englishName: 'English',
    shortBadge: 'EN',
    prefix: 'en',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'en-US',
    allowHan: false,
  },
  {
    code: 'ja-JP',
    slug: 'ja',
    mobileCode: 'ja',
    nativeName: '日本語',
    englishName: 'Japanese',
    shortBadge: 'JA',
    prefix: 'ja',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'ja-JP',
    allowHan: true,
  },
  {
    code: 'ko-KR',
    slug: 'ko',
    mobileCode: 'ko',
    nativeName: '한국어',
    englishName: 'Korean',
    shortBadge: 'KO',
    prefix: 'ko',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'ko-KR',
    allowHan: false,
  },
  {
    code: 'th-TH',
    slug: 'th',
    mobileCode: 'th',
    nativeName: 'ไทย',
    englishName: 'Thai',
    shortBadge: 'TH',
    prefix: 'th',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'th-TH',
    allowHan: false,
  },
  {
    code: 'ms-MY',
    slug: 'ms',
    mobileCode: 'ms',
    nativeName: 'Bahasa Melayu',
    englishName: 'Malay',
    shortBadge: 'MS',
    prefix: 'ms',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'ms-MY',
    allowHan: false,
  },
  {
    code: 'id-ID',
    slug: 'id',
    mobileCode: 'id',
    nativeName: 'Bahasa Indonesia',
    englishName: 'Indonesian',
    shortBadge: 'ID',
    prefix: 'id',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'id-ID',
    allowHan: false,
  },
  {
    code: 'vi-VN',
    slug: 'vi',
    mobileCode: 'vi',
    nativeName: 'Tiếng Việt',
    englishName: 'Vietnamese',
    shortBadge: 'VI',
    prefix: 'vi',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'vi-VN',
    allowHan: false,
  },
  {
    code: 'fr-FR',
    slug: 'fr',
    mobileCode: 'fr',
    nativeName: 'Français',
    englishName: 'French',
    shortBadge: 'FR',
    prefix: 'fr',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'fr-FR',
    allowHan: false,
  },
  {
    code: 'de-DE',
    slug: 'de',
    mobileCode: 'de',
    nativeName: 'Deutsch',
    englishName: 'German',
    shortBadge: 'DE',
    prefix: 'de',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'de-DE',
    allowHan: false,
  },
  {
    code: 'es-ES',
    slug: 'es',
    mobileCode: 'es',
    nativeName: 'Español',
    englishName: 'Spanish',
    shortBadge: 'ES',
    prefix: 'es',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'es-ES',
    allowHan: false,
  },
  {
    code: 'pt-BR',
    slug: 'pt',
    mobileCode: 'pt-BR',
    nativeName: 'Português (Brasil)',
    englishName: 'Portuguese (Brazil)',
    shortBadge: 'PT',
    prefix: 'pt',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'pt-BR',
    allowHan: false,
  },
  {
    code: 'it-IT',
    slug: 'it',
    mobileCode: 'it',
    nativeName: 'Italiano',
    englishName: 'Italian',
    shortBadge: 'IT',
    prefix: 'it',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'it-IT',
    allowHan: false,
  },
  {
    code: 'ru-RU',
    slug: 'ru',
    mobileCode: 'ru',
    nativeName: 'Русский',
    englishName: 'Russian',
    shortBadge: 'RU',
    prefix: 'ru',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'ru-RU',
    allowHan: false,
  },
  {
    code: 'el-GR',
    slug: 'el',
    mobileCode: 'el',
    nativeName: 'Ελληνικά',
    englishName: 'Greek',
    shortBadge: 'EL',
    prefix: 'el',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'el-GR',
    allowHan: false,
  },
  {
    code: 'tr-TR',
    slug: 'tr',
    mobileCode: 'tr',
    nativeName: 'Türkçe',
    englishName: 'Turkish',
    shortBadge: 'TR',
    prefix: 'tr',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'tr-TR',
    allowHan: false,
  },
  {
    code: 'nl-NL',
    slug: 'nl',
    mobileCode: 'nl',
    nativeName: 'Nederlands',
    englishName: 'Dutch',
    shortBadge: 'NL',
    prefix: 'nl',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'nl-NL',
    allowHan: false,
  },
  {
    code: 'hi-IN',
    slug: 'hi',
    mobileCode: 'hi',
    nativeName: 'हिन्दी',
    englishName: 'Hindi',
    shortBadge: 'HI',
    prefix: 'hi',
    dir: 'ltr',
    lowaUiLang: 'en-US',
    bcp47: 'hi-IN',
    allowHan: false,
  },
  {
    code: 'ar-SA',
    slug: 'ar',
    mobileCode: 'ar',
    nativeName: 'العربية',
    englishName: 'Arabic',
    shortBadge: 'AR',
    prefix: 'ar',
    dir: 'rtl',
    lowaUiLang: 'en-US',
    bcp47: 'ar-SA',
    allowHan: false,
  },
])

const SUPPORTED_LOCALE_CODES = Object.freeze(LOCALE_REGISTRY.map((entry) => entry.code))
const SUPPORTED = SUPPORTED_LOCALE_CODES
const SUPPORTED_LANGUAGES = Object.freeze([...SUPPORTED_LOCALE_CODES, SYSTEM_LANGUAGE_MODE])
const LOCALE_MAP = Object.freeze(
  Object.fromEntries(LOCALE_REGISTRY.map((entry) => [entry.code, entry]))
)

const LOWER_CODE_MAP = new Map(
  LOCALE_REGISTRY.map((entry) => [entry.code.toLowerCase(), entry.code])
)

const PREFIX_CODE_MAP = new Map(
  LOCALE_REGISTRY.filter((entry) => entry.code !== 'zh-TW').map((entry) => [
    entry.prefix.toLowerCase(),
    entry.code,
  ])
)

function normalizeLocaleCode(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const cleaned = raw.trim().replace(/_/g, '-').toLowerCase()
  if (!cleaned) return ''

  if (LOWER_CODE_MAP.has(cleaned)) {
    return LOWER_CODE_MAP.get(cleaned)
  }

  if (
    cleaned === 'zh-tw'
    || cleaned === 'zh-hk'
    || cleaned === 'zh-mo'
    || cleaned === 'zh-hant'
    || cleaned.startsWith('zh-hant-')
  ) {
    return 'zh-TW'
  }
  if (cleaned === 'zh' || cleaned.startsWith('zh-')) {
    return 'zh-CN'
  }

  if (cleaned === 'in' || cleaned.startsWith('in-')) {
    return 'id-ID'
  }

  const primary = cleaned.split('-')[0]
  if (PREFIX_CODE_MAP.has(primary)) {
    return PREFIX_CODE_MAP.get(primary)
  }

  return ''
}

function normalizeLanguageSetting(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const cleaned = raw.trim().toLowerCase()
  if (cleaned === SYSTEM_LANGUAGE_MODE || cleaned === 'auto') {
    return SYSTEM_LANGUAGE_MODE
  }
  return normalizeLocaleCode(raw)
}

function matchSystemLocale(raw) {
  return normalizeLocaleCode(raw) || 'en-US'
}

function getLocaleEntry(code) {
  const canonical = normalizeLocaleCode(code)
  return LOCALE_MAP[canonical] || LOCALE_MAP['en-US']
}

function getLocaleFallbackChain(code) {
  const canonical = normalizeLocaleCode(code) || 'en-US'
  if (canonical === 'zh-CN') return ['zh-CN']
  if (canonical === 'zh-TW') return ['zh-TW', 'zh-CN']
  if (canonical === 'en-US') return ['en-US', 'zh-CN']
  return [canonical, 'en-US', 'zh-CN']
}

const COUNTRY_TO_LOCALE = Object.freeze({
  CN: 'zh-CN',
  SG: 'zh-CN',
  TW: 'zh-TW',
  HK: 'zh-TW',
  MO: 'zh-TW',
  JP: 'ja-JP',
  KR: 'ko-KR',
  TH: 'th-TH',
  MY: 'ms-MY',
  BN: 'ms-MY',
  ID: 'id-ID',
  VN: 'vi-VN',
  FR: 'fr-FR',
  MC: 'fr-FR',
  DE: 'de-DE',
  AT: 'de-DE',
  LI: 'de-DE',
  ES: 'es-ES',
  MX: 'es-ES',
  AR: 'es-ES',
  CO: 'es-ES',
  CL: 'es-ES',
  PE: 'es-ES',
  BR: 'pt-BR',
  PT: 'pt-BR',
  IT: 'it-IT',
  RU: 'ru-RU',
  BY: 'ru-RU',
  KZ: 'ru-RU',
  GR: 'el-GR',
  CY: 'el-GR',
  TR: 'tr-TR',
  NL: 'nl-NL',
  IN: 'hi-IN',
  SA: 'ar-SA',
  AE: 'ar-SA',
  EG: 'ar-SA',
  QA: 'ar-SA',
  KW: 'ar-SA',
  BH: 'ar-SA',
  OM: 'ar-SA',
  JO: 'ar-SA',
  MA: 'ar-SA',
  US: 'en-US',
  GB: 'en-US',
  AU: 'en-US',
  CA: 'en-US',
  NZ: 'en-US',
  IE: 'en-US',
})

function matchCountryToLocale(countryCode) {
  if (!countryCode || typeof countryCode !== 'string') return ''
  const code = countryCode.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return ''
  return COUNTRY_TO_LOCALE[code] || ''
}

let currentResolved = null
let currentPref = null
const listeners = new Set()

function storePath() {
  try { return path.join(app.getPath('userData'), 'app-language.json') } catch (e) { return null }
}

function readSaved() {
  const p = storePath()
  if (!p) return null
  try {
    if (!fs.existsSync(p)) return null
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    const raw = j && typeof j.language === 'string' ? j.language.trim() : ''
    if (!raw) return null
    if (raw.toLowerCase() === SYSTEM_LANGUAGE_MODE || raw.toLowerCase() === 'auto') {
      return SYSTEM_LANGUAGE_MODE
    }
    const canonical = LOWER_CODE_MAP.get(raw.replace(/_/g, '-').toLowerCase())
    if (canonical) return canonical
  } catch (e) { /* ignore */ }
  return null
}

function guessFromSystem() {
  try {
    const loc = String((app && typeof app.getLocale === 'function' && app.getLocale()) || '')
    return matchSystemLocale(loc)
  } catch (e) {
    return 'en-US'
  }
}

/**
 * 只读落盘的语言选择，不猜系统语言、也不写 current 缓存。
 * 专供 app.whenReady() 之前追加 `--lang` 开关（main.js 顶层）：ready 之前
 * app.getLocale() 返回空串，走 getAppLanguage() 会把「猜不出 → en-US」写进 current
 * 缓存，导致新装机的中文系统首次启动整套菜单/原生对话框全变成英文。
 * 没有落盘文件或文件里为 'system' 时返回 null，Chromium 自然按操作系统语言挑 .pak。
 */
function getPersistedAppLanguage() {
  const saved = readSaved()
  if (!saved || saved === SYSTEM_LANGUAGE_MODE) return null
  return saved
}

function getAppLanguage() {
  if (!currentResolved) {
    const saved = readSaved()
    currentPref = saved || SYSTEM_LANGUAGE_MODE
    currentResolved = (!saved || saved === SYSTEM_LANGUAGE_MODE) ? guessFromSystem() : saved
  }
  return currentResolved
}

function getAppLanguagePreference() {
  if (!currentPref) {
    getAppLanguage()
  }
  return currentPref || SYSTEM_LANGUAGE_MODE
}

function getLowaUiLang() {
  return getLocaleEntry(getAppLanguage()).lowaUiLang
}

function setAppLanguage(lang) {
  const normalized = normalizeLanguageSetting(lang)
  if (!normalized) return getAppLanguage()
  const nextResolved = normalized === SYSTEM_LANGUAGE_MODE ? guessFromSystem() : normalized
  const prevResolved = getAppLanguage()
  const prevPref = currentPref
  currentPref = normalized
  currentResolved = nextResolved
  const p = storePath()
  if (p) {
    try { fs.writeFileSync(p, JSON.stringify({ language: normalized }), 'utf8') } catch (e) { /* ignore */ }
  }
  if (prevResolved !== nextResolved || prevPref !== normalized) {
    for (const fn of listeners) {
      try { fn(nextResolved) } catch (e) { /* ignore */ }
    }
  }
  return nextResolved
}

function onAppLanguageChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * 传入 `{ zh: '...', en: '...' }` 返回当前语言对应文案。
 * 对非 zh* 语言优先取 en，缺失时再回退到 zh。
 */
function t(pair) {
  if (!pair || typeof pair !== 'object') return String(pair || '')
  const lang = getAppLanguage()
  if (pair[lang]) return pair[lang]
  if (lang.startsWith('zh')) {
    return pair['zh-CN'] || pair.zh || pair['en-US'] || pair.en || ''
  }
  return pair['en-US'] || pair.en || pair['zh-CN'] || pair.zh || ''
}

module.exports = {
  SYSTEM_LANGUAGE_MODE,
  LOCALE_REGISTRY,
  SUPPORTED_LOCALE_CODES,
  SUPPORTED,
  SUPPORTED_LANGUAGES,
  LOCALE_MAP,
  normalizeLocaleCode,
  normalizeLanguageSetting,
  matchSystemLocale,
  COUNTRY_TO_LOCALE,
  matchCountryToLocale,
  getLocaleEntry,
  getLocaleFallbackChain,
  getAppLanguage,
  getAppLanguagePreference,
  getPersistedAppLanguage,
  getLowaUiLang,
  setAppLanguage,
  onAppLanguageChange,
  t,
}
