// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C17 (lane C S4): the client saw raw 「Failed to fetch」, US-English times in a zh-CN portal, two names
// for the same code, and an account prompt in desktop client mode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { errorTextFor } from '../../src/utils/userMessage.js'
import zhErrors from '../../src/locales/zh-CN/errors.js'

const read = (p) => readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')

test('C17: a network failure in the client chat reads as the catalogue message, not 「Failed to fetch」', () => {
  const t = (k) => k.split('.').slice(1).reduce((o, x) => o && o[x], zhErrors) || k
  const text = errorTextFor(Object.assign(new TypeError('Failed to fetch')), '项目沟通暂时不可用', t)
  assert.doesNotMatch(text, /Failed to fetch/)
  const chat = read('components/dd/ClientPortalChat.vue')
  assert.match(chat, /if \(msg && !isRawTechnicalText\(msg\)/)
  assert.match(chat, /return errorTextFor\(e, this\.\$t\('ddWorkflow\.client\.chat\.unavailable'\), \(k, p\) => this\.\$t\(k, p\)\)/)
})

test('C17: message times follow the interface language, 24-hour', () => {
  const chat = read('components/dd/ClientPortalChat.vue')
  assert.match(chat, /toLocaleString\(getAppLanguage\(\), \{ month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false \}\)/)
  const zh = new Date('2026-11-25T19:04:00').toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  assert.doesNotMatch(zh, /PM|AM/)
})

test('C17: one name for the client code — 访问码 / 存取碼 / access code', async () => {
  const zhCN = (await import('../../src/locales/zh-CN/ddWorkflow.js')).default
  const zhTW = (await import('../../src/locales/zh-TW/ddWorkflow.js')).default
  const en = (await import('../../src/locales/en-US/ddWorkflow.js')).default
  assert.match(zhCN.client.invitationLabel, /访问码/)
  assert.match(zhTW.client.invitationLabel, /存取碼/)
  assert.match(en.client.invitationLabel, /access code/i)
  for (const f of ['version.js', 'ddWorkflow.js', 'welcome.js']) assert.doesNotMatch(read('locales/zh-TW/' + f), /訪問碼/, 'zh-TW ' + f)
})

test('C17: no 「连接账号」 prompt for clients in the message centre', () => {
  const pane = read('components/messages/MessageCenterPane.vue')
  assert.match(pane, /const clientOnly = isClientUser\(\) \|\| this\.conversations\.some\(row => row\.sourceId === 'dd-client'\)/)
  assert.match(pane, /if \(result\.cloudStatus === 'unavailable' && !clientOnly\)/)
})
