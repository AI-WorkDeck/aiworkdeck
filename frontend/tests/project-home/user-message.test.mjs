// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X7 / X-S1: every failure class lands on a catalogued key; raw text only in `detail`.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { toUserMessage, ERROR_KEYS, isRawTechnicalText } from '../../src/utils/userMessage.js'

const http = (status, message = '') => Object.assign(new Error(message || `HTTP ${status}`), { status })
const cases = [
  ['fetch TypeError (desktop)', Object.assign(new TypeError('Failed to fetch')), { desktop: true }, 'localServiceDown'],
  ['fetch TypeError (web)', new TypeError('Failed to fetch'), {}, 'offline'],
  ['net::ERR', new Error('net::ERR_CONNECTION_REFUSED'), {}, 'offline'],
  ['client timeout', Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }), {}, 'timeout'],
  ['HTTP 504', http(504), {}, 'timeout'],
  ['code 4011', Object.assign(new Error('Sign in to use cloud AI'), { code: 4011, accountRequired: true }), {}, 'signInRequired'],
  ['HTTP 401', http(401), {}, 'signInRequired'],
  ['code 4010', Object.assign(new Error('expired'), { code: 4010 }), {}, 'sessionExpired'],
  ['HTTP 403', http(403), {}, 'forbidden'],
  ['HTTP 402', http(402), {}, 'balanceLow'],
  ['quota marker', new Error('Stream Error: AI_QUOTA_EXHAUSTED'), {}, 'balanceLow'],
  ['HTTP 429', http(429), {}, 'rateLimited'],
  ['code 4290', Object.assign(new Error('slow down'), { code: 4290 }), {}, 'rateLimited'],
  ['model missing', new Error('Model deepseek/x not found'), {}, 'modelUnavailable'],
  ['bad key', new Error('Incorrect API key provided'), {}, 'modelKeyInvalid'],
  ['SSE cut mid-answer', new Error('SSE Connection Failed: 502'), { partial: true }, 'streamInterrupted'],
  ['SSE fails before any text', new Error('SSE Connection Failed: 502'), {}, 'serverError'],
  ['chat POST 500', http(500, 'HTTP 500'), {}, 'serverError'],
  ['HTTP 503', http(503), {}, 'serverError'],
  ['HTTP 409', http(409), {}, 'conflict'],
  ['code 4090', Object.assign(new Error('stale'), { code: 4090 }), {}, 'conflict'],
  ['HTTP 413', http(413), { params: { limit: '50 MB' } }, 'fileTooLarge'],
  ['encrypted file', new Error('DOC_ENCRYPTED'), {}, 'fileUnreadable'],
  ['HTTP 404', http(404), {}, 'notFound'],
  ['registry down', new Error('Unable to tunnel through proxy'), { area: 'marketplace' }, 'marketplaceUnavailable'],
  ['plugin install', new Error('signature mismatch'), { area: 'pluginInstall', params: { name: 'Clipboard' } }, 'pluginInstallFailed'],
  ['anything else', new Error('weird'), {}, 'unknown'],
]

for (const [label, err, ctx, key] of cases) {
  test(`maps ${label} → ${key}`, () => {
    const m = toUserMessage(err, ctx)
    assert.equal(m.key, key)
    assert.ok(ERROR_KEYS.includes(m.key))
    assert.ok(['retry', 'signIn', 'refresh'].includes(m.action), m.action)
  })
}

test('every catalogued key has text in every locale, and none of it is raw technical text', () => {
  const dir = new URL('../../src/locales/', import.meta.url)
  for (const locale of fs.readdirSync(dir).filter((d) => /^[a-z]{2}-[A-Z]{2}$/.test(d))) {
    const src = fs.readFileSync(new URL(locale + '/errors.js', dir), 'utf8').replace(/^\s*export\s+default\s*/m, 'return ')
    const ns = new Function(src)()
    for (const key of ERROR_KEYS) {
      assert.ok(ns[key], `${locale}: errors.${key}`)
      assert.equal(isRawTechnicalText(ns[key]), false, `${locale}: errors.${key}`)
    }
    for (const a of ['retry', 'details', 'refresh', 'signIn']) assert.ok(ns.actions && ns.actions[a], `${locale}: errors.actions.${a}`)
  }
})

test('the raw text survives only as detail, capped', () => {
  const m = toUserMessage(new Error('SSE Connection Failed: 502 ' + 'x'.repeat(1000)))
  assert.match(m.detail, /^HTTP 502 · SSE Connection Failed: 502/)
  assert.ok(m.detail.length <= 300)
})

test('the status is not repeated in Details when the text already has it', () => {
  assert.equal(toUserMessage(Object.assign(new Error('HTTP 502'), { status: 502 })).detail, 'HTTP 502')
})

test('a sign-in failure asks to sign in, not to retry', () => {
  assert.equal(toUserMessage(Object.assign(new Error('x'), { accountRequired: true })).action, 'signIn')
  assert.equal(toUserMessage(new Error('Invalid API key')).action, 'signIn')
})
