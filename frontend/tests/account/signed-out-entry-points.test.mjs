// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D18 / Q9 / D17: signed-out surfaces say what signing in adds and offer it in place; no "Lazy Mode" jargon.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => fs.readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')
const CAT = read('components/project-list/AccountProjectCatalog.vue')

// Run the real component methods with stubs (imports stripped, dependencies injected).
const script = CAT.slice(CAT.indexOf('<script>') + 8, CAT.indexOf('</script>')).replace(/^import .*$/gm, '').replace('export default', 'return')
const make = (getAccountStatus, requireAccount) => new Function('getAccountStatus', 'requireAccount', 'ACCOUNT_CHANGED_EVENT', 'uni', script)(
  getAccountStatus, requireAccount, 'awd:account-changed', { $on() {}, $off() {} })

test('D18: the catalog knows when nobody is signed in, and keeps its state when the check fails', async () => {
  const c = make(async () => ({ connected: false }), null)
  const vm = { ...c.data(), ...c.methods }
  await vm.refreshAccountState.call(vm)
  assert.equal(vm.signedOut, true)
  const c2 = make(async () => { throw new Error('offline') }, null)
  const vm2 = { ...c2.data(), ...c2.methods }
  await vm2.refreshAccountState.call(vm2)
  assert.equal(vm2.signedOut, false, 'an unknown state must not tell a signed-in user to sign in')
})

test('D18: the in-place link opens the shared sign-in dialog', () => {
  const calls = []
  const c = make(async () => ({}), (o) => { calls.push(o); return Promise.resolve(true) })
  c.methods.signIn.call({})
  assert.deepEqual(calls, [{ reason: 'account' }])
  assert.match(CAT, /<view v-if="signedOut" class="catalog-note catalog-signed-out">/)
  assert.match(CAT, /signedOut \? \$t\('projects\.otherDevicesTitle'\) : \$t\('projects\.accountCatalog'\)/)
})

test('Q9: Profile & sign-in starts with a sign-in card while signed out', () => {
  const admin = read('components/admin/AdminPane.vue')
  const page = admin.slice(admin.indexOf("activeNav === 'personal_settings'"))
  const card = page.indexOf("$t('admin.signInCardTitle')")
  assert.ok(card > 0 && card < page.indexOf('<PersonalSettingsPanel />'), 'the card comes before the settings panel')
  assert.match(page.slice(0, page.indexOf('<PersonalSettingsPanel />')), /!account\.connected[\s\S]*@tap="onLoginAccount"/)
  // the account state is loaded when this page is shown, not only on "Account & balance"
  assert.match(admin, /activeNav: \{\s*immediate: true,\s*handler\(key\) \{\s*if \(key === 'personal_settings'[^\n]*this\.loadAccount\(\)/)
})

test('every locale has the new copy, and none still says "Lazy Mode"', () => {
  const dir = new URL('../../src/locales/', import.meta.url)
  const ns = (l, n) => new Function(fs.readFileSync(new URL(`${l}/${n}.js`, dir), 'utf8').replace(/^\s*export\s+default\s*/m, 'return '))()
  for (const l of fs.readdirSync(dir).filter((d) => /^[a-z]{2}-[A-Z]{2}$/.test(d))) {
    for (const k of ['otherDevicesTitle', 'otherDevicesSignedOut', 'otherDevicesSignIn']) assert.ok(ns(l, 'projects')[k], `${l} projects.${k}`)
    for (const k of ['signInCardTitle', 'signInCardText']) assert.ok(ns(l, 'admin')[k], `${l} admin.${k}`)
    const market = ns(l, 'market')
    assert.ok(market.installedNoExecuteHint.length < 100, `${l}: market.installedNoExecuteHint holds the wrong (long) text`)
    if (l !== 'en-US') assert.doesNotMatch(market.builtinWorkflowsMarketNotice, /Contract Review|Evidence Organization/, `${l}: workflow names left in English`)
    assert.doesNotMatch(market.builtinWorkflowsMarketNotice, /lazy|懒人|懶人|怠惰|게으른|Faulenzer|paresseux|perezoso|pigro|preguiçoso|ленив/i, l)
  }
})
