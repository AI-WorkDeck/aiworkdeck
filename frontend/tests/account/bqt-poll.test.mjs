// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/components/account/AccountLoginDialog.vue', import.meta.url), 'utf8')
const start = source.indexOf('async pollBqtOnce() {')
const method = source.slice(start, source.indexOf('\n    async handleSendCode()', start))
const load = request => new Function('pollBqtScanStatus', `return ({${method}}).pollBqtOnce`)(request)
const vm = () => ({ done: false, mode: 'bqt', bqtPolling: false, bqtSession: { qrid: 'qr', pollToken: 'secret' }, finishLogin() { throw Error('unexpected login') }, stopBqtPoll() { throw Error('unexpected stop') } })
test('missing device proof does not send a QR polling request', async () => {
 const state = vm(); delete state.bqtSession.pollToken
 await load(() => { throw Error('unexpected request') }).call(state)
})
test('polling serializes requests and ignores a replaced QR session result', async () => {
 let resolve, calls = 0
 const poll = load((qrid, token) => { calls++; assert.equal(qrid, 'qr'); assert.equal(token, 'secret'); return new Promise(r => { resolve = r }) })
 const state = vm(); const pending = poll.call(state)
 await poll.call(state); assert.equal(calls, 1)
 state.bqtSession = { qrid: 'new', pollToken: 'other' }
 resolve({ status: 'confirmed' }); await pending
 assert.equal(state.bqtPolling, false)
})

test('login mode cannot change while a credential or verification-code request is pending', () => {
 const start = source.indexOf('switchMode(next) {')
 const code = source.slice(start, source.indexOf('\n    stopBqtPoll()', start))
 const switchMode = new Function(`return ({${code}}).switchMode`)()
 for (const busy of ['submitBusy', 'sendingCode']) {
  const state = { mode: 'login', [busy]: true, bqtScanEnabled: true, isPhoneSite: true,
   consentGatePassed: () => true, startBqtScan: () => assert.fail('parallel login started') }
  switchMode.call(state, 'bqt')
  assert.equal(state.mode, 'login')
 }
})

test('top login mode buttons use native disabled controls during authentication', async () => {
 const { JSDOM } = await import('jsdom')
 const dom = new JSDOM('<body><div id="root"></div></body>')
 for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key]
 const Vue = await import('vue')
 const { compile } = await import('@vue/compiler-dom')
 const start = source.indexOf('<!-- 大陆站：')
 const template = source.slice(start, source.indexOf('<!-- 登录与注册', start))
 const clicked = []
 const app = Vue.createApp({
  data: () => ({ variant: 'dialog', isPhoneSite: true, bqtScanEnabled: true, mode: 'login', submitBusy: true, sendingCode: false }),
  methods: { switchMode: mode => clicked.push(mode) },
  render: new Function('Vue', compile(template, { mode: 'function' }).code)(Vue),
 })
 app.config.globalProperties.$t = key => key
 const vm = app.mount(document.getElementById('root'))
 const buttons = [...document.querySelectorAll('button')]
 assert.equal(buttons.length, 2)
 assert.ok(buttons.every(button => button.classList.contains('unlock-mode-tab')), '弹层形态是下划线标签')
 assert.ok(buttons[0].classList.contains('is-active'))
 assert.ok(buttons.every(button => button.disabled))
 buttons[1].click(); assert.deepEqual(clicked, [])
 vm.submitBusy = false; vm.sendingCode = true; await Vue.nextTick()
 assert.ok(buttons.every(button => button.disabled))
 vm.sendingCode = false; await Vue.nextTick()
 buttons[1].click(); assert.deepEqual(clicked, ['bqt'])
 app.unmount(); dom.window.close()
})

test('scan tab opens without consent but only requests a QR code once both consents are given', () => {
 const start = source.indexOf('switchMode(next) {')
 const code = source.slice(start, source.indexOf('\n    stopBqtPoll()', start))
 const switchMode = new Function(`return ({${code}}).switchMode`)()
 for (const consent of [false, true]) {
  let started = 0
  const state = { mode: 'login', submitBusy: false, sendingCode: false, bqtScanEnabled: true, isPhoneSite: true,
   errorMsg: '', consentGatePassed: () => consent, startBqtScan: () => { started++ } }
  switchMode.call(state, 'bqt')
  assert.equal(state.mode, 'bqt')
  assert.equal(started, consent ? 1 : 0)
 }
})
