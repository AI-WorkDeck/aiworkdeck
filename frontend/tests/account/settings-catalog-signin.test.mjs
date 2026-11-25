// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Q3: signed out, Settings › AI must offer Sign in right where it says the model list needs an
// account (there is no "top right" on the Settings page), and reload the list once signed in.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../../src/components/admin/AdminPane.vue', import.meta.url), 'utf8')
const method = (name) => {
  const at = src.indexOf('\n    async ' + name + '(')
  assert.ok(at > 0, name)
  return src.slice(at, src.indexOf('\n    },', at))
}

test('the account-required catalog note carries an in-place Sign in', () => {
  assert.match(src, /<view v-if="modelCatalogNeedsSignIn"[^>]*>\s*<text>\{\{ \$t\('admin\.catalogNeedsSignIn'\) \}\}<\/text>\s*<text class="platform-link" @tap="onLoginAccount">/)
  assert.match(src, /v-else-if="modelCatalogError"/)
})

test('only an account-required failure switches to the Sign in note; success clears it', () => {
  const load = method('loadModelCatalog')
  assert.match(load, /this\.modelCatalogNeedsSignIn = !!\(e && e\.accountRequired\)/)
  assert.match(load, /this\.modelCatalogNeedsSignIn = false/)
})

test('signing in anywhere reloads a catalog that failed', () => {
  assert.match(method('onAccountChanged'), /if \(this\.modelCatalogError \|\| this\.modelCatalogNeedsSignIn\) this\.loadModelCatalog\(\)/)
})

test('every locale has the note, without "top right"', () => {
  const dir = new URL('../../src/locales/', import.meta.url)
  for (const l of fs.readdirSync(dir).filter((d) => /^[a-z]{2}-[A-Z]{2}$/.test(d))) {
    const ns = new Function(fs.readFileSync(new URL(l + '/admin.js', dir), 'utf8').replace(/^\s*export\s+default\s*/m, 'return '))()
    assert.ok(ns.catalogNeedsSignIn, l)
    assert.doesNotMatch(ns.catalogNeedsSignIn, /top right|右上角/i, l)
  }
})
