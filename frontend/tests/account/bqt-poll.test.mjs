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
