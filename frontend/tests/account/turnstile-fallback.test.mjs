// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { acquireOrFallback, DESKTOP_TURNSTILE_BUDGET_MS } from '../../src/utils/captchaFallback.js'

const never = () => new Promise(() => {})
const now = () => Promise.resolve()

test('desktop Turnstile that never renders falls back to compatibility verification within 3 s', async () => {
  assert.equal(DESKTOP_TURNSTILE_BUDGET_MS, 3000)
  const waited = []
  const r = await acquireOrFallback(never, { desktop: true, provider: 'turnstile', wait: (ms) => { waited.push(ms); return now() } })
  assert.deepEqual(r, { fallback: true })
  assert.deepEqual(waited, [3000])
})

test('desktop Turnstile that fails, is rejected or returns nothing also falls back', async () => {
  const opts = { desktop: true, provider: 'turnstile', wait: never }
  assert.deepEqual(await acquireOrFallback(async () => ({ failure: { provider: 'turnstile' } }), opts), { fallback: true })
  assert.deepEqual(await acquireOrFallback(async () => ({ rejected: true }), opts), { fallback: true })
  assert.deepEqual(await acquireOrFallback(async () => ({ token: '' }), opts), { fallback: true })
  assert.deepEqual(await acquireOrFallback(async () => { throw new Error('x') }, opts), { fallback: true })
})

test('a passed token is used; web pages and the cn Aliyun captcha keep their own behaviour', async () => {
  assert.deepEqual(await acquireOrFallback(async () => ({ token: 't' }), { desktop: true, provider: 'turnstile', wait: never }), { token: 't' })
  assert.deepEqual(await acquireOrFallback(async () => ({ rejected: true }), { desktop: false, provider: 'turnstile' }), { rejected: true })
  assert.deepEqual(await acquireOrFallback(async () => ({ rejected: true }), { desktop: true, provider: 'aliyun' }), { rejected: true })
})

test('the sign-in sheet switches to compatibility verification and tells the user why', () => {
  const src = readFileSync(new URL('../../src/components/account/AccountLoginDialog.vue', import.meta.url), 'utf8')
  assert.match(src, /acquireOrFallback\(\(\) => this\.acquireCaptchaToken\(\)/)
  assert.match(src, /if \(got\.fallback\) \{[\s\S]*?await this\.loadCompatChallenge\(\)[\s\S]*?onboarding\.unlock\.compatAuto/)
})
