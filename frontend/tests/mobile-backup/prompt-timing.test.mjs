// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * QA D9：「文件云端备份」弹窗在每次登录后晚几秒弹出，吞掉了用户正在点的操作。
 * 病灶：组件在 window 上听账户变化，而账户变化走的是 uni 事件总线，登录后只能等
 * 60 秒的后台轮询把弹窗推出来——落在用户手上正在做的事情上面。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom'), { parse } = require('@vue/compiler-sfc')
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' })
for (const key of ['window', 'document', 'Document', 'Element', 'Node', 'HTMLElement', 'SVGElement']) globalThis[key] = dom.window[key]
const Vue = require('vue/dist/vue.cjs.js')
const sfc = parse(readFileSync(new URL('../../src/components/MobileBackupConsent.vue', import.meta.url), 'utf8')).descriptor
const script = sfc.script.content.replace(/^import .*$/gm, '').replace('export default', 'return')
const tick = async () => { await new Promise((resolve) => setImmediate(resolve)); await Vue.nextTick() }

async function mount(t) {
  const handlers = new Map(), gets = []
  let state = { available: false }
  const uni = { $on(name, fn) { handlers.set(name, fn) }, $off(name) { handlers.delete(name) } }
  const getConsent = () => new Promise((resolve) => gets.push(() => resolve({ ...state })))
  const options = new Function('getMobileBackupConsent', 'setMobileBackupConsent', 'ACCOUNT_CHANGED_EVENT', 'accountPageUrl', 'openExternalUrl', 'uni', script)(
    getConsent, async () => ({ decided: true }), 'awd:account-changed', () => '', () => {}, uni)
  globalThis.uni = uni
  const host = document.createElement('div'); document.body.append(host)
  let vm
  const app = Vue.createApp({ render: () => Vue.h({ ...options, template: sfc.template.content }, { ref: (v) => { vm = v } }) })
  app.config.globalProperties.$t = (key) => key
  app.config.warnHandler = () => {}
  app.config.compilerOptions.isCustomElement = (tag) => tag === 'view'
  app.mount(host)
  t.after(() => { app.unmount(); host.remove(); clearTimeout(vm?.timer) })
  await tick()
  const answer = async () => { gets.shift()(); await tick(); clearTimeout(vm.timer) }
  return { vm, gets, answer, signIn(next) { state = next; handlers.get('awd:account-changed')() }, setState(next) { state = next } }
}
const undecided = { available: true, decided: false, enabled: false, accountScope: 'acct-a', consentVersion: 'v' }

test('signing in asks right away when nothing has been decided and the user has not started working', async (t) => {
  const f = await mount(t)
  await f.answer() // signed out at mount
  f.signIn(undecided)
  assert.equal(f.gets.length, 1, 'account change must trigger a check immediately, not after the 60 s poll')
  await f.answer()
  assert.equal(f.vm.open, true)
})

test('a late answer never pops the dialog over something the user already started', async (t) => {
  const f = await mount(t)
  await f.answer()
  f.signIn(undecided)
  document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
  await f.answer()
  assert.equal(f.vm.open, false)
  assert.match(document.querySelector('.backup-trigger').textContent, /mobileBackup\.undecided/, 'the pending decision stays visible in the status bar')
})

test('background re-checks never open the dialog by themselves', async (t) => {
  const f = await mount(t)
  await f.answer()
  f.setState(undecided)
  f.vm.refresh()
  await f.answer()
  assert.equal(f.vm.open, false)
})
