// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDesktopQuitGuard } from '../../src/utils/desktopQuitGuard.js'

const source = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8')
const block = source.slice(source.indexOf('    let systemOpenPending'), source.indexOf('    // IDE 化：拖一个文件夹'))
function harness({ prepare = async () => ({ ready: true }), flush = async () => ({ failed: 0 }), open = async () => {}, confirm = async () => true, abort = async () => ({ paused: 0 }) } = {}) {
  const events = [], handlers = {}, modals = []
  const host = { lifecycle: {
    onPrepareQuit: fn => { handlers.prepare = fn },
    onQuitCancelled: fn => { handlers.cancelled = fn },
    cancelQuit: () => events.push('cancel-request'),
  }, menu: { onAction: fn => { handlers.open = fn }, ackOpenPath: () => events.push('open-ack') } }
  const uni = {
    $emit: name => events.push(name), showLoading: () => events.push('loading'), hideLoading: () => events.push('hide-loading'),
    showModal: options => { events.push('modal'); modals.push(options) },
  }
  new Function('host', 'uni', 'window', 'createDesktopQuitGuard', 'prepareAgentRestart', 'abortAgentRestart',
    'flushQuitWorkbenches', 'confirmQuitWorkbenches', 'setGlobalOverlay', 'openLocalRootPath', 'openLocalFilePath', block).call({ $t: key => key }, host, uni,
    { addEventListener: (_, fn) => { handlers.key = fn } }, createDesktopQuitGuard,
    prepare, async () => { events.push('abort'); return await abort() }, flush, confirm,
    enabled => events.push(enabled ? 'blocked' : 'unblocked'), open, open)
  return { events, handlers, modals, escape() { handlers.key({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }) } }
}

test('real App wiring cancels startup recovery and keeps input blocked after successful ACK', async () => {
  const h = harness()
  assert.equal((await h.handlers.prepare()).ok, true)
  assert.equal(h.events[0], 'awd:cancel-restart-recovery')
  assert.ok(h.events.includes('blocked'))
  assert.equal(h.events.at(-1), 'blocked')
  // Once main accepted the ACK it may already be stopping services: Escape cannot
  // independently unfreeze tasks. Only main's cancellation event can do that.
  h.escape()
  await Promise.resolve()
  assert.ok(h.events.includes('cancel-request'))
  assert.ok(!h.events.includes('abort'))
})

test('main cancellation rejects a late ready response and releases the App overlay', async () => {
  let ready
  const h = harness({ prepare: () => new Promise(resolve => { ready = resolve }) })
  const pending = h.handlers.prepare()
  while (!ready) await Promise.resolve()
  await h.handlers.cancelled()
  ready({ ready: true })
  assert.equal((await pending).ok, false)
  assert.equal(h.events.filter(event => event === 'abort').length, 1)
  assert.ok(h.events.includes('unblocked'))
  assert.ok(!h.events.includes('modal'))
})

test('quit waits for an already accepted system file open and cancellation cannot freeze tasks later', async () => {
  let opened, pauses = 0
  const h = harness({ open: () => new Promise(resolve => { opened = resolve }),
    prepare: async () => { pauses++; return { ready: true } } })
  const opening = h.handlers.open({ action: 'open-path', path: '/original.docx', requestId: 1 })
  await Promise.resolve(); await Promise.resolve()
  const quitting = h.handlers.prepare()
  await h.handlers.cancelled()
  opened()
  await opening
  assert.equal((await quitting).ok, false)
  assert.equal(pauses, 0)
})

test('save failure releases the App overlay but never acknowledges exit', async () => {
  const h = harness({ flush: async () => ({ failed: 1 }) })
  assert.equal((await h.handlers.prepare()).ok, false)
  assert.ok(h.events.includes('abort'))
  assert.ok(h.events.includes('unblocked'))
  assert.ok(h.events.includes('modal'))
})

test('real App keeps the version choice interactive without a quit loading mask, then reblocks before ACK', async () => {
  let choose
  const stages = []
  const h = harness({ confirm: () => new Promise(resolve => { choose = resolve }) })
  const quitting = h.handlers.prepare({ reportStage: async stage => { stages.push(stage); return true } })
  while (!choose) await Promise.resolve()
  assert.equal(h.events.at(-1), 'unblocked')
  assert.ok(h.events.includes('hide-loading'))
  let prevented = false
  h.handlers.key({ key: 'Enter', preventDefault() { prevented = true }, stopImmediatePropagation() {} })
  assert.equal(prevented, false, 'confirmation receives keyboard input')
  h.escape()
  assert.ok(!h.events.includes('cancel-request'), 'Escape belongs to the open confirmation')
  choose(true)
  assert.equal((await quitting).ok, true)
  assert.equal(h.events.at(-1), 'blocked')
  assert.deepEqual(stages, ['pausing', 'saving', 'confirming', 'saving'])
})

test('cancelling the version choice keeps the app open and resumes AI without a second error dialog', async () => {
  const h = harness({ confirm: async () => false })
  const result = await h.handlers.prepare()
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.ok(h.events.includes('abort'))
  assert.equal(h.events.at(-1), 'unblocked')
  assert.ok(!h.events.includes('modal'))
})

test('a completed Mac window hide resumes the paused task and releases its overlay', async () => {
  const h = harness()
  assert.equal((await h.handlers.prepare()).ok, true)
  await h.handlers.cancelled({ windowHidden: true })
  assert.ok(h.events.includes('abort'))
  assert.equal(h.events.at(-1), 'unblocked')
  assert.equal(h.modals.length, 0)
})

for (const fails of [false, true]) {
  test(`Mac window hide reports incomplete task recovery (${fails ? 'request failed' : 'still paused'})`, async () => {
    const h = harness({ abort: async () => { if (fails) throw new Error('offline'); return { paused: 1 } } })
    assert.equal((await h.handlers.prepare()).ok, true)
    await h.handlers.cancelled({ windowHidden: true })
    assert.deepEqual(h.modals, [{ title: 'admin.quitStopped', content: 'admin.quitErrors.recoveryPending', showCancel: false }])
    assert.equal(h.events.at(-2), 'unblocked')
  })
}

test('normal cancelled quit reports recovery failure once through the existing guard', async () => {
  const h = harness({ confirm: async () => false, abort: async () => ({ paused: 1 }) })
  assert.equal((await h.handlers.prepare()).ok, false)
  await h.handlers.cancelled({ error: 'quit cancelled' })
  assert.equal(h.modals.length, 1)
  assert.match(h.modals[0].content, /admin.quitErrors.recoveryPending/)
})
