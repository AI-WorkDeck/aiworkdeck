// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D5: signed out, the model list is empty. The user must get a way forward (Sign in),
// not a pointer to "AI provider settings" / "paste your account key", which no longer exist.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const dropdown = read('../../src/components/ModelSelectorDropdown.vue')

test('the empty model list offers Sign in through the account gate', () => {
  const empty = dropdown.slice(dropdown.indexOf('v-if="!groups.length" class="model-empty"'), dropdown.indexOf('class="model-footnote"'))
  assert.match(empty, /\$t\('chat\.noModels'\)/)
  assert.match(empty, /@tap\.stop="signIn"/)
  assert.match(empty, /\$t\('welcome\.signIn'\)/)
  assert.match(dropdown, /signIn\(\) \{\s*return requireAccount\(\{ reason: 'ai' \}\)/)
})

test('no locale sends the user to provider settings or an API key from the empty model list', () => {
  const dir = new URL('../../src/locales/', import.meta.url)
  for (const locale of fs.readdirSync(dir).filter((d) => /^[a-z]{2}-[A-Z]{2}$/.test(d))) {
    const src = fs.readFileSync(new URL(locale + '/chat.js', dir), 'utf8').replace(/^\s*export\s+default\s*/m, 'return ')
    const text = new Function(src)().noModels
    assert.ok(text && text.includes('AI WorkDeck'), `${locale}: noModels should name the AI WorkDeck account: ${text}`)
    assert.doesNotMatch(text, /provider|供应商|供應商|API Key|Anbieter|fournisseur|proveedor/i, `${locale}: ${text}`)
  }
})

test('backend "not connected" messages point at Sign in, not a removed settings page', () => {
  for (const rel of ['../../../backend/src/main/java/com/checkba/service/ai/PlatformAiChannel.java',
    '../../../backend/src/main/java/com/checkba/service/account/AccountService.java']) {
    const java = read(rel)
    assert.doesNotMatch(java, /paste your account key|Account & Usage|粘贴账户 Key/, rel)
  }
})
