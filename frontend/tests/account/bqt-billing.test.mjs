// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 包晴天积分通道（billingLine=bqt）：会员卡展示、所有充值/购 Pro 入口隐藏、网关拒绝码的提示。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileTemplate } from 'vue/compiler-sfc'
import * as Vue from 'vue'
import * as SSR from 'vue/server-renderer'
import { BQT_ERROR_CODES, bqtErrorCode, bqtErrorMessage, isBqtBillingLine, bqtMemberView } from '../../src/utils/bqtBilling.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

function ssrRenderer(template, id) {
  const compiled = compileTemplate({ source: template, filename: id + '.vue', id, ssr: true, ssrCssVars: [] })
  assert.deepEqual(compiled.errors, [])
  const body = compiled.code.replace(/^import \{([\s\S]*?)\} from "vue"$/m, 'const {$1} = Vue').replace(/^import \{([\s\S]*?)\} from "vue\/server-renderer"$/m, 'const {$1} = SSR').replace(/\bas\b/g, ':').replace('export function ssrRender', 'function ssrRender')
  return new Function('Vue', 'SSR', body + ';return ssrRender')(Vue, SSR)
}

const member = { points: '1234.5', cents: 12345, outstandingCents: 300, failedCount: 1, centsPerPoint: 10, levelCode: 'GROWTH', status: 'ACTIVE', aiWorkbench: true, expireAt: '2027-01-01T00:00:00Z', fetchedAt: '2026-11-05T00:00:00Z', rechargeAllowed: false }

test('error codes come from reason or raw text, never from look-alikes', () => {
  for (const code of BQT_ERROR_CODES) {
    assert.equal(bqtErrorCode({ reason: code }), code)
    assert.equal(bqtErrorCode(`Stream Error: {"error":"${code}"}`), code)
  }
  assert.equal(bqtErrorCode({ reason: 'no_credits' }), '')
  assert.equal(bqtErrorCode('AI_QUOTA_EXHAUSTED: insufficient credits'), '')
  assert.equal(bqtErrorCode('xbqt_ai_closedy'), '')
  assert.equal(bqtErrorMessage('bqt_ai_closed', k => k), 'agentStream.bqtAiClosed')
  assert.equal(bqtErrorCode('{"error":{"code":"bqt_model_not_allowed"}}'), 'bqt_model_not_allowed')
  assert.equal(bqtErrorMessage('bqt_model_not_allowed', k => k), 'agentStream.bqtModelNotAllowed')
  assert.equal(bqtErrorMessage('no_credits', k => k), '')
})

test('every bqt error and wallet key exists in all locales', async () => {
  const { SUPPORTED_LOCALE_CODES } = await import('../../src/locales/registry.js')
  for (const locale of SUPPORTED_LOCALE_CODES) {
    const agent = (await import(`../../src/locales/${locale}/agentStream.js`)).default
    const admin = (await import(`../../src/locales/${locale}/admin.js`)).default
    for (const code of BQT_ERROR_CODES) {
      const key = bqtErrorMessage(code, k => k).split('.')[1]
      assert.ok(agent[key], `${locale} agentStream.${key}`)
    }
    for (const key of ['bqtPayInApp', 'bqtRechargeNote', 'bqtLevelLight', 'bqtLevelGrowth', 'bqtDebtWarning']) assert.ok(admin[key], `${locale} admin.${key}`)
  }
})

test('member view converts cents to credits and flags failed deductions', () => {
  assert.equal(isBqtBillingLine({ billingLine: 'bqt' }), true)
  assert.equal(isBqtBillingLine({ billingLine: 'standard' }), false)
  assert.equal(isBqtBillingLine({}), false, '旧后端没有 billingLine，按普通账户')
  const view = bqtMemberView(member)
  assert.equal(view.levelKey, 'admin.bqtLevelGrowth')
  assert.equal(view.credits, '123.45')
  assert.equal(view.outstandingCredits, '3.00')
  assert.equal(view.hasDebt, true)
  assert.equal(bqtMemberView({ ...member, levelCode: 'LIGHT', outstandingCents: 0, failedCount: 0 }).hasDebt, false)
  assert.equal(bqtMemberView({ ...member, levelCode: null }).levelKey, 'admin.bqtLevelNone')
  assert.equal(bqtMemberView(null), null)
})

const admin = read('../../src/components/admin/AdminPane.vue')
const accountSection = admin.slice(admin.indexOf('<!-- 未连接：'), admin.indexOf('<!-- 文件缓存区存储位置。'))
const renderAdmin = ssrRenderer(accountSection, 'admin-bqt')
async function adminHtml(bqt) {
  const subscription = { active: true, monthlyUsedCents: 0, monthlyLimitCents: 74500, weeklyUsedCents: 0, weeklyLimitCents: 20000 }
  const app = Vue.createSSRApp({ ssrRender: renderAdmin, data: () => ({ isDesktop: true, redeemBusy: false, redeemCodeInput: '', walletCircleFirm: null, walletBqtQingtian: null, isBqtBilling: bqt, walletBqtMember: bqt ? bqtMemberView(member) : null, account: { connected: true, displayName: 'Signed In' }, accountLoadState: 'ready', keyPasteOpen: false, accountUsageRows: [], teamLine: {}, accountProfile: {}, subscription, walletBalanceText: '¥123.45', membershipData: null, tierRulesOpen: false, membershipTiers: [], accountPlanLabel: '', entitlementBusy: false, accountPlatformReachable: false, accountPlatform: null }), methods: { getInitial: () => 'S', formatUsageTime: v => String(v || ''), subscriptionCredits: () => '0', onRedeemCode() {}, onLoginAccount() {}, onLoginForMobile() {}, loadAccount() {}, openMembershipRules() {}, openSubscriptionAccount() {}, onRefreshEntitlements() {}, onSignOut() {} } })
  app.component('SettingsRow', { render() { return Vue.h('div', this.$slots.default?.()) } })
  app.component('SettingsSection', { props: ['title'], render() { return Vue.h('section', [this.title, this.$slots.default?.()]) } })
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = () => {}
  return SSR.renderToString(app)
}

test('bqt member card replaces every recharge, redeem and Pro purchase entry', async () => {
  const html = await adminHtml(true)
  assert.match(html, /admin.bqtMemberTitle/)
  assert.match(html, /admin.bqtLevelGrowth/)
  assert.match(html, /admin.bqtStatusActive/)
  assert.match(html, /admin.bqtExpireAt/)
  assert.match(html, /admin.bqtPointsLine/)
  assert.match(html, /admin.bqtDebtWarning/)
  assert.match(html, /admin.bqtPayInApp/)
  assert.doesNotMatch(html, /admin.rechargeButton|admin.walletRedeemTitle|admin.subscriptionManage|admin.subscriptionSubscribeBtn/)
})

test('standard accounts keep recharge, redeem and subscription entries', async () => {
  const html = await adminHtml(false)
  assert.match(html, /admin.rechargeButton/)
  assert.match(html, /admin.walletRedeemTitle/)
  assert.match(html, /admin.subscriptionManage/)
  assert.doesNotMatch(html, /admin.bqt/)
})

const dialog = read('../../src/components/RechargeDialog.vue')
const renderDialog = ssrRenderer(dialog.slice(dialog.indexOf('<template>') + 10, dialog.lastIndexOf('</template>')), 'recharge-bqt')
async function dialogHtml(bqtOnly) {
  const app = Vue.createSSRApp({ ssrRender: renderDialog, data: () => ({ visible: true, bqtOnly, step: 'pick', presetCents: [5000], selectedCents: 5000, customInput: '', currencySymbol: '¥', submitting: false, submitLabel: 'admin.rechargeSubmit', inputError: '' }), methods: { close() {}, submit() {}, pickPreset() {} } })
  app.config.globalProperties.$t = key => key
  app.config.warnHandler = () => {}
  return SSR.renderToString(app)
}

test('recharge dialog opened for a bqt account offers no payment, only the in-app note', async () => {
  const bqt = await dialogHtml(true)
  assert.match(bqt, /admin.bqtRechargeNote/)
  assert.doesNotMatch(bqt, /admin.rechargeSubmit|admin.rechargeAmountLabel/)
  const standard = await dialogHtml(false)
  assert.match(standard, /admin.rechargeSubmit/)
  assert.doesNotMatch(standard, /admin.bqtRechargeNote/)
})

test('recharge dialog submit refuses bqt accounts and checks billing line on open', async () => {
  const start = dialog.indexOf('    async submit() {')
  const method = dialog.slice(start, dialog.indexOf('\n    startPolling()', start))
  const submit = new Function('createAccountRecharge', `return ({${method}}).submit`)(() => assert.fail('payment order created'))
  await submit.call({ submitting: false, bqtOnly: true, selectedCents: 5000, customInput: '' })
  const checkStart = dialog.indexOf('    async checkBillingLine() {')
  const check = dialog.slice(checkStart, dialog.indexOf('\n    pickPreset(', checkStart))
  const run = new Function('getAccountBalance', 'isBqtBillingLine', `return ({${check}}).checkBillingLine`)(async () => ({ connected: true, billingLine: 'bqt' }), isBqtBillingLine)
  const vm = { visible: true, bqtOnly: false }
  await run.call(vm)
  assert.equal(vm.bqtOnly, true)
})

test('chat errors with a bqt code show the bqt notice before the generic recharge path', () => {
  const stream = read('../../src/composables/useAgentStream.js')
  const bqt = stream.indexOf('const bqtCode = bqtErrorCode(accountPayload) || bqtErrorCode(errMsg)')
  assert.ok(bqt > 0)
  assert.ok(bqt < stream.indexOf('} else if (isCreditsRequired(accountPayload)) {', bqt), 'bqt 分支必须先于充值弹层分支')
})

test('API business errors with a bqt reason use the localized notice and never open the wallet', async () => {
  const { needsCloudEpoch } = await import('../../../shared/cloud-epoch.mjs')
  const { accountRequiredError, isCreditsRequired, isAccountRequired } = await import('../../src/utils/requireAccountCore.js')
  const api = read('../../src/services/api.js')
  const source = api.slice(api.indexOf('async function request(options)'), api.indexOf('// 查询公司基础信息'))
    .replaceAll("import('@/utils/requireAccount.js')", 'loadAccountUi()')
  const run = async backend => {
    const prompts = []
    const request = new Function('needsCloudEpoch', 'uni', 'getApiBaseUrl', 'getAuthHeaders', 't', 'accountRequiredError', 'isCreditsRequired', 'isAccountRequired', 'loadAccountUi', 'getCloudAccountGeneration', 'isDesktopHost', 'console',
      source + '\nreturn request')(needsCloudEpoch,
      { request: options => { options.success({ statusCode: 200, data: backend }); return {} } },
      () => 'https://synthetic.invalid', () => ({}), key => key, accountRequiredError, isCreditsRequired, isAccountRequired,
      async () => ({ requireAccountFor4011: async () => { prompts.push('login') }, requireRecharge: async () => { prompts.push('recharge') } }),
      () => 0, () => true, { log() {}, warn() {}, error() {} })
    const error = await request({ url: '/api/x', method: 'POST' }).then(() => assert.fail('resolved'), e => e)
    await new Promise(resolve => setTimeout(resolve, 0))
    return { error, prompts }
  }
  for (const code of BQT_ERROR_CODES) {
    const { error, prompts } = await run({ code: 1, kind: 'REJECTED', reason: code, gatewayKind: 'SERVICE_DISABLED', message: 'server text' })
    assert.equal(error.message, bqtErrorMessage(code, k => k))
    assert.equal(error.reason, code)
    assert.deepEqual(prompts, [])
  }
  const other = await run({ code: 1, reason: 'bqt_something_else', message: 'server text' })
  assert.equal(other.error.message, 'server text')
})
