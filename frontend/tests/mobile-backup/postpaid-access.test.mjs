// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-ssr'
import * as Vue from 'vue'
import * as SSR from 'vue/server-renderer'
const source = readFileSync(new URL('../../src/components/MobileBackupConsent.vue', import.meta.url), 'utf8')
const script = source.slice(source.indexOf('<script>') + 8, source.indexOf('</script>')).replace(/^import .*$/gm, '').replace('export default', 'return')
const component = new Function(script)()
const template = source.slice(source.indexOf('<template>') + 10, source.indexOf('\n</template>'))
const compiled = compile(template, { mode: 'function' }).code
const ssrRender = new Function('require', compiled)(id => id === 'vue' ? Vue : SSR)
async function render(state) {
  const app = Vue.createSSRApp({ ...component, ssrRender, data: () => ({ ...component.data(), open: true, state: { available: true, decided: true, enabled: false, ...state } }) })
  app.config.globalProperties.$t = (key, params) => key + (params ? JSON.stringify(params) : '')
  app.config.globalProperties.$i18n = { locale: 'en-US' }
  app.config.warnHandler = () => {}
  const context = {}
  const html = await SSR.renderToString(app, context)
  return html + (context.teleports?.body || '')
}
test('non-subscriber with write capability sees enable action', async () => {
  const html = await render({ subscriptionActive: false, cloudAccess: { canWrite: true } })
  assert.match(html, /mobileBackup\.enable</)
  assert.doesNotMatch(html, /mobileBackup\.accessRequired/)
})
test('subscriber blocked by billing cannot bypass authoritative capability', async () => {
  const html = await render({ subscriptionActive: true, cloudAccess: { canWrite: false } })
  assert.doesNotMatch(html, /mobileBackup\.enable</)
  assert.match(html, /mobileBackup\.manageBilling/)
})
test('legacy fallback preserves access; malformed new state never grants it', async () => {
  assert.match(await render({ subscriptionActive: true }), /mobileBackup\.enable</)
  assert.doesNotMatch(await render({ subscriptionActive: true, cloudAccess: {} }), /mobileBackup\.enable</)
})
test('overdue status displays money and deletion deadline', async () => {
  const html = await render({ enabled: true, cloudAccess: { canWrite: false }, billing: { accepted: true, cashCurrency: 'CNY', debtCents: 123, availableCreditCents: 0, cleanupAt: '2026-11-09T08:00:00Z' } })
  assert.match(html, /mobileBackup\.billingSummary/)
  assert.match(html, /1\.23/)
  assert.match(html, /mobileBackup\.cleanupDeadline/)
  assert.match(html, /mobileBackup\.disable</)
})
test('missing monetary values are not rendered as zero', () => {
  const vm = { state: { billing: { cashCurrency: 'USD' } } }
  assert.equal(component.methods.money.call(vm, undefined), '—')
  assert.equal(component.methods.money.call(vm, 100), '$1.00')
})
