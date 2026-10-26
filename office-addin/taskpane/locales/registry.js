// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 20-locale central registry for Office Add-in (dev-board#1477).
 *
 * Keep in sync with:
 *   - frontend/src/locales/registry.js
 *   - desktop/main/app-language.js
 * (Guarded by frontend/tests/i18n/multilang-infra.test.mjs)
 */

export const SYSTEM_LANGUAGE_MODE = 'system'

export const LOCALE_REGISTRY = Object.freeze([
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

export const SUPPORTED_LOCALE_CODES = Object.freeze(
  LOCALE_REGISTRY.map((entry) => entry.code)
)

export const LOCALE_MAP = Object.freeze(
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

export function normalizeLocaleCode(raw) {
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

export function normalizeLanguageSetting(raw) {
  if (!raw || typeof raw !== 'string') return ''
  const cleaned = raw.trim().toLowerCase()
  if (cleaned === SYSTEM_LANGUAGE_MODE || cleaned === 'auto') {
    return SYSTEM_LANGUAGE_MODE
  }
  return normalizeLocaleCode(raw)
}

export function matchSystemLocale(raw) {
  return normalizeLocaleCode(raw) || 'en-US'
}

export function getLocaleEntry(code) {
  const canonical = normalizeLocaleCode(code)
  return LOCALE_MAP[canonical] || LOCALE_MAP['en-US']
}

export function getLocaleFallbackChain(code) {
  const canonical = normalizeLocaleCode(code) || 'en-US'
  if (canonical === 'zh-CN') return ['zh-CN']
  if (canonical === 'zh-TW') return ['zh-TW', 'zh-CN']
  if (canonical === 'en-US') return ['en-US', 'zh-CN']
  return [canonical, 'en-US', 'zh-CN']
}

export const COUNTRY_TO_LOCALE = Object.freeze({
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

export function matchCountryToLocale(countryCode) {
  if (!countryCode || typeof countryCode !== 'string') return ''
  const code = countryCode.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return ''
  return COUNTRY_TO_LOCALE[code] || ''
}

