// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createI18n } from 'vue-i18n'
import messages from 'virtual:business-messages'
import { SUPPORTED_LOCALE_CODES, normalizeLocaleCode } from '../../src/locales/registry.js'
// Messages are compiled at build time. The plugin CSP intentionally forbids
// unsafe-eval, including vue-i18n's normal runtime message compiler.
export const i18n = createI18n({
  legacy: true,
  locale: 'zh-CN',
  fallbackLocale: {
    'zh-TW': ['zh-CN'],
    'en-US': ['zh-CN'],
    default: ['en-US', 'zh-CN'],
  },
  silentFallbackWarn: true,
  silentTranslationWarn: true,
  messages,
})
export const t = (key, params) => i18n.global.t(key, params)
export const applyI18nLocale = (language) => {
  const normalized = normalizeLocaleCode(language)
  i18n.global.locale = SUPPORTED_LOCALE_CODES.includes(normalized) ? normalized : 'en-US'
}
