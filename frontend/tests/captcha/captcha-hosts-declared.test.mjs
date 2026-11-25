// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D27: the sign-in captcha loads third-party code (Aliyun on the China site, Cloudflare Turnstile on the
// international site). CLAUDE.md: no outbound request that legal/PRIVACY.md doesn't declare. The dist
// guard can't see these hosts (they sit in constants), so pin them here, in both language parts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ALIYUN_SCRIPT_URL, TURNSTILE_HOST } from '../../src/utils/captchaFailure.js'

const privacy = fs.readFileSync(new URL('../../../legal/PRIVACY.md', import.meta.url), 'utf8')
const [zh, en] = privacy.split('## Part 1 — Platform services')

test('every captcha host is declared in the Chinese and the English part of PRIVACY.md', () => {
  for (const host of [new URL(ALIYUN_SCRIPT_URL).host, TURNSTILE_HOST]) {
    assert.ok(zh.includes('`' + host + '`'), 'zh part does not declare ' + host)
    assert.ok(en.includes('`' + host + '`'), 'en part does not declare ' + host)
  }
})

test('the captcha script is only fetched when the sign-in dialog sets it up', () => {
  const src = fs.readFileSync(new URL('../../src/utils/captcha.js', import.meta.url), 'utf8')
  const calls = [...src.matchAll(/loadScript\(SCRIPTS\.aliyun/g)]
  assert.equal(calls.length, 1)
  const setup = src.indexOf('export async function setupCaptcha(')
  assert.ok(calls[0].index > setup, 'the Aliyun script must load inside setupCaptcha, not at import time')
  const dialog = fs.readFileSync(new URL('../../src/utils/requireAccount.js', import.meta.url), 'utf8')
  assert.match(dialog, /createApp\(AccountLoginDialog/, 'the sign-in dialog is created on demand')
})
