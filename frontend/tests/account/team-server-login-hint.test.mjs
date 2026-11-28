// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// POLISH Q2: /pages/login is the team server's own sign-in (browser only; desktop uses the account
// sheet). It now says which account it wants, so a user doesn't try their AI WorkDeck website account.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('team-server login page explains which account it takes', async () => {
  const src = readFileSync(new URL('../../src/pages/login/login.vue', import.meta.url), 'utf8')
  const form = src.slice(src.indexOf(`v-if="activeTab === 'login' && !smsStep"`))
  assert.ok(form.indexOf("account.teamServerLoginHint") < form.indexOf("account.usernameLabel"))
  const en = (await import('../../src/locales/en-US/account.js')).default
  assert.match(en.teamServerLoginHint, /team server/)
})
