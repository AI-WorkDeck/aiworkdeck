// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X21 / X-S1 §7: the task pane never shows raw transport, JS or Java text in a banner or status line.
// Same rule as the app (frontend/src/utils/userMessage.js errorTextFor): a readable message (a localized
// backend business error such as "Wrong verification code", or our own translated error) is shown as is;
// anything technical falls back to the caller's localized, context-specific text.
// Errors returned to the AI as tool results are NOT routed through here; the model needs the raw text.

const TECHNICAL = /Failed to fetch|NetworkError|net::|ECONN|ETIMEDOUT|Cannot read propert|is not (?:a function|defined)|\bundefined\b|\bnull\b|\[object |status code|\bHTTP \d{3}\b|\bSSE\b|Stream Error|Broken pipe|Connection reset|\bat [\w.$]+ \(|^[A-Z][A-Za-z]+(?:Error|Exception)\b|Exception|^\s*[{[]|<\/?[a-z]|request:fail|OfficeExtension|RichApi\.|GeneralException|InvalidArgument|AccessDenied/

export function isTechnicalText(msg) {
  const s = String(msg || '').trim()
  return !s || s.length > 200 || TECHNICAL.test(s)
}

function messageOf(err) {
  if (err == null) return ''
  if (typeof err === 'string') return err
  if (typeof err.message === 'string' && err.message) return err.message
  if (typeof err.errMsg === 'string') return err.errMsg
  return ''
}

/**
 * @param {unknown} err
 * @param {string} fallbackText already-translated, context-specific text ("Rename failed")
 */
export function errorText(err, fallbackText = '') {
  if (err) console.warn('[error]', err)
  const msg = messageOf(err).trim()
  return isTechnicalText(msg) ? fallbackText : msg
}
