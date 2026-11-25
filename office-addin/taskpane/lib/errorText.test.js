// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X21 / X-S1 §7: task-pane banners and status lines never show raw technical text.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { errorText, isTechnicalText } from './errorText.js'

test('readable business messages are kept; technical text falls back', () => {
  assert.equal(errorText(new Error('Wrong verification code'), 'Sign-in failed'), 'Wrong verification code')
  assert.equal(errorText(new Error('验证码错误'), '登录失败'), '验证码错误')
  for (const raw of ['Failed to fetch', 'TypeError: x is not a function', 'HTTP 500', 'GeneralException: Access denied',
    'RichApi.Error: The operation failed', 'java.lang.NullPointerException', '{"code":500}', 'Cannot read properties of undefined', '']) {
    assert.equal(errorText(new Error(raw), 'Rename failed'), 'Rename failed', raw)
    if (raw) assert.equal(isTechnicalText(raw), true, raw)
  }
  assert.equal(errorText({ errMsg: 'request:fail' }, 'Connection failed'), 'Connection failed')
  assert.equal(errorText(null, 'Failed'), 'Failed')
})

test('no task-pane component or banner path shows e.message directly', () => {
  const files = ['../App.vue', '../components/ChatView.vue', '../components/GitLinkPanel.vue', '../components/SettingsView.vue', '../components/TransferPanel.vue']
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /\b(?:e|err|error)\.message\b/, f)
  }
  const chat = fs.readFileSync(new URL('./chatSession.js', import.meta.url), 'utf8')
  assert.match(chat, /entry\.error = errorText\(e, t\('uploadFailed'\)\)/)
  assert.match(chat, /return errorText\(e, t\('sendFailed'\)\)/)
})
