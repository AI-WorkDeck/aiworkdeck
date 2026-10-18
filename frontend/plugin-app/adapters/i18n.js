// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createI18n } from 'vue-i18n'
import messages from 'virtual:business-messages'
// Messages are compiled at build time. The plugin CSP intentionally forbids
// unsafe-eval, including vue-i18n's normal runtime message compiler.
export const i18n = createI18n({ legacy: true, locale: 'zh-CN', fallbackLocale: 'zh-CN', messages })
export const t = (key, params) => i18n.global.t(key, params)
export const applyI18nLocale = language => { i18n.global.locale = language === 'en-US' ? language : 'zh-CN' }
