// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileTemplate } from 'vue/compiler-sfc'
import * as Vue from 'vue'
import * as SSR from 'vue/server-renderer'
const source = readFileSync(new URL('../../src/components/admin/AdminPane.vue', import.meta.url), 'utf8')
const section = source.slice(source.indexOf('<!-- 未连接：'), source.indexOf('<!-- 文件缓存区存储位置。'))
const compiled = compileTemplate({ source: section, filename: 'AdminPane.vue', id: 'account-state', ssr: true, ssrCssVars: [] })
assert.deepEqual(compiled.errors, [])
const body = compiled.code.replace(/^import \{([\s\S]*?)\} from "vue"$/m, 'const {$1} = Vue').replace(/^import \{([\s\S]*?)\} from "vue\/server-renderer"$/m, 'const {$1} = SSR').replace(/\bas\b/g, ':').replace('export function ssrRender', 'function ssrRender')
const ssrRender = new Function('Vue', 'SSR', body + ';return ssrRender')(Vue, SSR)
async function html(connected, accountLoadState = 'ready') {
  const app = Vue.createSSRApp({ ssrRender, data: () => ({ isDesktop: true, account: { connected, displayName: 'Signed In' }, accountLoadState, keyPasteOpen: false, accountUsageRows: [], teamLine: {}, accountProfile: {}, wallet: {}, subscription: null, accountAvatar: '', walletBalanceText: '100', walletProgressStyle: {}, walletLevelName: '', walletProgressText: '', walletNextLevelText: '', membershipData: null, tierRulesOpen: false, accountPlanLabel: '', entitlementBusy: false, accountPlatformReachable: false, accountPlatform: null }), methods: { getInitial: () => 'S', formatUsageTime: () => '', onLoginAccount() {}, onLoginForMobile() {}, loadAccount() {}, openMembershipRules() {}, onRefreshEntitlements() {}, onSignOut() {} } })
  app.component('SettingsRow', { render() { return Vue.h('div', this.$slots.default?.()) } })
  app.component('SettingsSection', { props: ['title'], render() { return Vue.h('section', [this.title, this.$slots.default?.()]) } })
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = () => {}
  return SSR.renderToString(app)
}
function loader(getAccountStatus) {
  const start = source.indexOf('async loadAccount() {')
  const method = source.slice(start, source.indexOf('\n    },', start) + 6)
  return new Function('getAccountStatus', `return ({${method}}).loadAccount`)(getAccountStatus)
}
function state() { return { account: { connected: true, displayName: 'Signed In' }, accountLoadState: 'ready', loadAccountUsage: async () => {}, loadTeamLine() {}, loadAccountProfile() {} } }
test('signed-in desktop shows account and balance alongside mobile sync, without login prompt', async () => {
  const output = await html(true)
  assert.match(output, /admin.walletCardTitle/)
  assert.match(output, /Signed In/)
  assert.match(output, /mobileSyncOn/)
  assert.doesNotMatch(output, /loginAccountButton/)
})
test('unknown or failed status never asks a signed-in user to log in again', async () => {
  for (const status of ['loading', 'error']) {
    const output = await html(false, status)
    assert.doesNotMatch(output, /loginAccountButton|mobileSyncNeedsLogin/)
  }
  assert.match(await html(false), /loginAccountButton/)
})
test('transient status error preserves confirmed identity and exposes retry state', async () => {
  const vm = state()
  await loader(async () => { throw new Error('temporary disconnect') }).call(vm)
  assert.equal(vm.account.connected, true)
  assert.equal(vm.accountLoadState, 'error')
})
test('late pre-login response cannot overwrite a newer authenticated response', async () => {
  let resolveOld, calls = 0
  const load = loader(() => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ connected: true, displayName: 'New' }))
  const vm = state()
  const old = load.call(vm)
  await load.call(vm)
  resolveOld({ connected: false })
  await old
  assert.equal(vm.account.connected, true)
  assert.equal(vm.account.displayName, 'New')
})
