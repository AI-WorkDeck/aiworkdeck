// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X7 / spec X-S1: turn any failure into one catalogued, user-facing message.
//
// A lawyer must never see "HTTP 502", "Failed to fetch", "SSE Connection Failed: 500" or a
// Java exception. Every failure maps to an `errors.<key>` locale entry that says what happened
// and what to do; the raw text survives only as `detail` (the Details toggle, feedback reports
// and logs). Catalogue and wording: readiness/qa/X7-error-catalog/CATALOG.md.
//
// Pure module (no uni / vue imports) so node --test can run it.

export const ERROR_KEYS = Object.freeze([
  'offline', 'timeout', 'localServiceDown', 'signInRequired', 'sessionExpired', 'forbidden',
  'balanceLow', 'rateLimited', 'modelUnavailable', 'modelKeyInvalid', 'streamInterrupted',
  'serverError', 'conflict', 'fileTooLarge', 'fileUnreadable', 'notFound',
  'marketplaceUnavailable', 'pluginInstallFailed', 'unknown',
])

// What the primary button does for each message. The component renders it; callers wire it.
const ACTION = {
  offline: 'retry', timeout: 'retry', localServiceDown: 'retry', signInRequired: 'signIn',
  sessionExpired: 'signIn', modelKeyInvalid: 'signIn', rateLimited: 'retry', modelUnavailable: 'retry',
  streamInterrupted: 'retry', serverError: 'retry', conflict: 'refresh', notFound: 'refresh',
  marketplaceUnavailable: 'refresh', pluginInstallFailed: 'retry', unknown: 'retry',
}

const DETAIL_MAX = 300

function textOf(err) {
  if (err == null) return ''
  if (typeof err === 'string') return err
  const parts = []
  if (err.message) parts.push(String(err.message))
  // uni.request rejects with a bare { errMsg: 'request:fail …' } when the connection itself fails
  if (!err.message && typeof err.errMsg === 'string') parts.push(err.errMsg)
  if (err.data && typeof err.data === 'object' && err.data.message && err.data.message !== err.message) parts.push(String(err.data.message))
  return parts.join(' — ')
}

function statusOf(err, text) {
  const direct = Number(err && (err.status || err.statusCode || (err.response && err.response.status)))
  if (Number.isInteger(direct) && direct >= 100) return direct
  const m = /\b(?:HTTP|status|SSE Connection Failed:?|failed:?)\s*(\d{3})\b/i.exec(text)
  return m ? Number(m[1]) : 0
}

function codeOf(err) {
  const c = err && (err.code ?? (err.data && err.data.code))
  const n = Number(c)
  return Number.isFinite(n) ? n : String(c || '')
}

const NETWORK = /failed to fetch|networkerror|network request failed|net::err_|econnrefused|econnreset|load failed|网络错误|network error|request:fail(?! timeout)/i
const TIMEOUT = /time(?:d)?[ -]?out|timeout|超时/i
const MODEL_UNAVAILABLE = /model[^.]{0,40}(not found|unavailable|does not exist|no such)|模型[^。]{0,12}(不可用|不存在)|AI_MODEL_UNAVAILABLE/i
const KEY_INVALID = /(invalid|incorrect|bad)[ _-]?api[ _-]?key|api key[^.]{0,20}(invalid|rejected)|AI_KEY_INVALID/i
const UNREADABLE = /encrypted|password[- ]protected|corrupt|cannot (open|parse)|unreadable|DOC_REJECTED|DOC_ENCRYPTED|损坏|无法解析/i
const MARKETPLACE = /registry|marketplace|插件市场|unable to tunnel/i

/**
 * @param {unknown} err  Error / fetch failure / backend envelope / string
 * @param {object} [ctx]
 * @param {string} [ctx.fallbackKey='unknown']  key when nothing matches (must be in ERROR_KEYS)
 * @param {boolean} [ctx.partial]   a streamed answer was already partly shown
 * @param {boolean} [ctx.desktop]   running in the desktop app (fetch failures mean the local service)
 * @param {'marketplace'|'pluginInstall'} [ctx.area]  narrows generic failures to an area message
 * @param {object} [ctx.params]     interpolation params (e.g. {name}, {limit})
 * @returns {{ key: string, params: object, action: string, detail: string }}
 */
export function toUserMessage(err, ctx = {}) {
  const text = textOf(err)
  const status = statusOf(err, text)
  const code = codeOf(err)
  const name = String((err && err.name) || '')
  const statusLabel = status && !text.includes('HTTP ' + status) ? 'HTTP ' + status : ''
  const detail = [statusLabel, text].filter(Boolean).join(' · ').slice(0, DETAIL_MAX)
  const done = (key) => ({ key, params: { ...(ctx.params || {}) }, action: ACTION[key] || 'retry', detail })
  const fallback = ERROR_KEYS.includes(ctx.fallbackKey) ? ctx.fallbackKey : 'unknown'

  // Account and billing first: they carry their own codes regardless of HTTP status.
  if ((err && err.accountRequired === true) || code === 4011) return done('signInRequired')
  if (code === 4010) return done('sessionExpired')
  if (status === 402 || code === 4020 || /AI_QUOTA_EXHAUSTED|insufficient (balance|credit)|余额不足|额度不足/i.test(text)) return done('balanceLow')
  if (status === 429 || code === 4290 || /rate.?limit|too many requests|限流/i.test(text)) return done('rateLimited')
  if (KEY_INVALID.test(text)) return done('modelKeyInvalid')
  if (MODEL_UNAVAILABLE.test(text)) return done('modelUnavailable')

  // A stream that broke after part of the answer arrived: keep the part, offer Retry.
  if (ctx.partial && (NETWORK.test(text) || /SSE|stream|terminated|aborted by peer/i.test(text) || status >= 500)) return done('streamInterrupted')

  if (status === 401) return done('signInRequired')
  if (status === 403) return done('forbidden')
  if (status === 404) return done(ctx.area === 'marketplace' ? 'marketplaceUnavailable' : 'notFound')
  if (status === 409 || code === 4090) return done('conflict')
  if (status === 413) return done('fileTooLarge')
  if (status === 504 || name === 'TimeoutError' || (name !== 'AbortError' && TIMEOUT.test(text))) return done('timeout')

  if (ctx.area === 'marketplace' && (NETWORK.test(text) || MARKETPLACE.test(text) || status >= 500)) return done('marketplaceUnavailable')
  if (ctx.area === 'pluginInstall') return done('pluginInstallFailed')
  if (UNREADABLE.test(text)) return done('fileUnreadable')

  if (name === 'TypeError' && NETWORK.test(text) || NETWORK.test(text)) {
    const offline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false
    return done(ctx.desktop && !offline ? 'localServiceDown' : 'offline')
  }
  if (status >= 500) return done('serverError')
  return done(fallback)
}

/** Text guaranteed to be safe to show: no raw status lines or exception names. */
export function isRawTechnicalText(s) {
  return /\bHTTP \d{3}\b|Failed to fetch|SSE Connection|Exception|\bError:/.test(String(s || ''))
}

// Failure kinds worth stating in catalogue words even where the caller has its own wording:
// the user needs to act on these (sign in, reconnect, wait, top up), not just "X failed".
const ACTIONABLE = new Set(['offline', 'timeout', 'localServiceDown', 'signInRequired', 'sessionExpired',
  'forbidden', 'balanceLow', 'rateLimited', 'conflict', 'fileTooLarge', 'modelKeyInvalid'])

// Text that must never reach a lawyer: transport/JS/Java internals, raw payloads.
const TECHNICAL = /Failed to fetch|NetworkError|net::|ECONN|ETIMEDOUT|Cannot read propert|is not (?:a function|defined)|\bundefined\b|\bnull\b|\[object |status code|\bSSE\b|Stream Error|Broken pipe|Connection reset|\bat [\w.$]+ \(|^[A-Z][A-Za-z]+(?:Error|Exception)\b|^\s*[{[]|<\/?[a-z]/

function isTechnical(msg) {
  return !msg || msg.length > 200 || isRawTechnicalText(msg) || TECHNICAL.test(msg)
}

/**
 * X-S1 part 3: the text for a failure toast. Never raw transport/JS text.
 *  1. a structurally classified failure (HTTP status, account/rate/conflict code, fetch/timeout error)
 *     or one whose text is technical, and of an actionable kind → the catalogue message;
 *  2. otherwise a readable message — a localized backend business error, or our own translated
 *     error thrown by the component — is shown as is;
 *  3. otherwise the caller's context-specific fallback ("Install failed"), else the catalogue.
 * @param {unknown} err
 * @param {string} fallbackText already-translated, context-specific text (may be '')
 * @param {(key: string, params?: object) => string} translate
 * @param {object} [ctx] toUserMessage context
 */
export function errorTextFor(err, fallbackText, translate, ctx = {}) {
  const m = toUserMessage(err, ctx)
  const msg = typeof err === 'string' ? err.trim() : (err && typeof err.message === 'string' ? err.message.trim() : '')
  const o = err && typeof err === 'object' ? err : {}
  const structured = o.accountRequired === true || Number(o.status) >= 400
    || [4010, 4011, 4020, 4090, 4290].includes(Number(o.code))
    || ['TypeError', 'TimeoutError'].includes(o.name)
  if ((structured || isTechnical(msg)) && ACTIONABLE.has(m.key)) return translate('errors.' + m.key, m.params)
  if (!isTechnical(msg)) return msg
  return fallbackText || translate('errors.' + m.key, m.params)
}
