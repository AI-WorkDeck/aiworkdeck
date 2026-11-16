// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { ZH } from './taskpane/locales/zh-CN.js'
import { EN } from './taskpane/locales/en-US.js'

const dictionaries = { zh: ZH, en: EN }
const escapeHtml = (value) => String(value).replace(/[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// Render the dictionary fallback before delivery so the AGPL notice remains
// readable when Office.js or the application fails to load.
export function renderLegalNoticeHtml(html) {
  return html.replace(/\{\{legal\.(zh|en)\.(legalCopyright|legalLicenseTrademark)\}\}/g,
    (_, locale, key) => escapeHtml(dictionaries[locale][key]))
}
