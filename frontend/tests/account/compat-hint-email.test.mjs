// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import en from '../../src/locales/en-US/onboarding.js'

// 国际站只用邮箱：兼容验证的提示不能再提短信
test('the international (email-only) compatibility hint does not mention SMS', () => {
  const src = readFileSync(new URL('../../src/components/account/AccountLoginDialog.vue', import.meta.url), 'utf8')
  assert.match(src, /\$t\(isPhoneSite \? 'onboarding\.unlock\.compatHint' : 'onboarding\.unlock\.compatHintEmail'\)/)
  const unlock = (en.unlock || en.default?.unlock)
  assert.match(unlock.compatHintEmail, /email code/)
  assert.doesNotMatch(unlock.compatHintEmail, /SMS/)
  assert.match(unlock.compatHint, /SMS/)
})
