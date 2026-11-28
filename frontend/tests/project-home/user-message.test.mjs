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
  ['uni.request refused (desktop)', { errMsg: 'request:fail' }, { desktop: true }, 'localServiceDown'],
  ['uni.request timeout', { errMsg: 'request:fail timeout' }, {}, 'timeout'],
  ['client timeout', Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }), {}, 'timeout'],
  ['HTTP 504', http(504), {}, 'timeout'],
  ['code 4011', Object.assign(new Error('Sign in to use cloud AI'), { code: 4011, accountRequired: true }), {}, 'signInRequired'],
  ['HTTP 401', http(401), {}, 'signInRequired'],
  ['code 4010', Object.assign(new Error('expired'), { code: 4010 }), {}, 'sessionExpired'],
  ['HTTP 403', http(403), {}, 'forbidden'],
  ['HTTP 402', http(402), {}, 'balanceLow'],
  ['quota marker', new Error('Stream Error: AI_QUOTA_EXHAUSTED'), {}, 'balanceLow'],
  ['credit run out (Q29)', 'AI 额度已用完，这次没有扣费，请充值后重试', {}, 'balanceLow'],
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
    assert.ok(['retry', 'signIn', 'refresh', 'topUp'].includes(m.action), m.action)
    if (key === 'balanceLow') assert.equal(m.action, 'topUp')
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
    for (const a of ['retry', 'details', 'refresh', 'signIn', 'topUp']) assert.ok(ns.actions && ns.actions[a], `${locale}: errors.actions.${a}`)
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

import { errorTextFor } from '../../src/utils/userMessage.js'
const tr = (k) => 'T:' + k

test('toast text: actionable failures use the catalogue, whatever the caller says', () => {
  assert.equal(errorTextFor(new TypeError('Failed to fetch'), 'Install failed', tr, { desktop: true }), 'T:errors.localServiceDown')
  assert.equal(errorTextFor(Object.assign(new Error('x'), { accountRequired: true }), 'Install failed', tr), 'T:errors.signInRequired')
  assert.equal(errorTextFor(Object.assign(new Error('HTTP 429'), { status: 429 }), 'Save failed', tr), 'T:errors.rateLimited')
})

test('toast text: a localized backend business message is kept; raw text never is', () => {
  assert.equal(errorTextFor(Object.assign(new Error('A project with this name already exists'), { code: 1 }), 'Create failed', tr),
    'A project with this name already exists')
  assert.equal(errorTextFor(Object.assign(new Error('java.lang.NullPointerException at com.x.Y.z(Y.java:1)'), { code: 1 }), 'Create failed', tr), 'Create failed')
  assert.equal(errorTextFor(Object.assign(new Error('HTTP 500'), { status: 500 }), 'Create failed', tr), 'Create failed')
  assert.equal(errorTextFor(new Error('Cannot read properties of undefined'), 'Create failed', tr), 'Create failed')
  assert.equal(errorTextFor(new Error(''), '', tr), 'T:errors.unknown')
  assert.equal(errorTextFor(new Error('对比已取消：文件在生成期间又被修改了'), 'Compare failed', tr), '对比已取消：文件在生成期间又被修改了', 'our own translated error is shown as is')
})

test('toast text: a bare uni.request failure is a connection problem, not "that didn\'t work"', () => {
  assert.equal(errorTextFor({ errMsg: 'request:fail' }, 'Load failed', tr, { desktop: true }), 'T:errors.localServiceDown')
})

// Q21 (firstday-1125): an account-class AI failure that signing in again fixes used to show the
// generic 「操作没有完成。请重试」 with the real reason only under Details and no way to fix it.
test('Q21: AI account failures that a fresh sign-in fixes get their own message and a Sign In Again action', async () => {
  const { toUserMessage } = await import('../../src/utils/userMessage.js')
  for (const kind of ['MALFORMED', 'UNAUTHORIZED']) {
    const m = toUserMessage('平台 AI 通道配置与当前站点不符，请刷新账户连接', { accountKind: kind })
    assert.equal(m.key, 'accountReconnect', kind)
    assert.equal(m.action, 'reconnect')
    assert.match(m.detail, /请刷新账户连接/, 'the raw reason stays under Details')
  }
  assert.notEqual(toUserMessage('x', { accountKind: 'NETWORK' }).key, 'accountReconnect', 'a network failure is not a sign-in problem')
  assert.notEqual(toUserMessage('x', { accountKind: 'CONFLICT' }).key, 'accountReconnect', 'no AI quota assigned is not fixed by signing in')
})
