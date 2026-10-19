// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDesktopQuitGuard } from '../../src/utils/desktopQuitGuard.js'

const source = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8')
const block = source.slice(source.indexOf('    let systemOpenPending'), source.indexOf('    // IDE 化：拖一个文件夹'))
function harness({ prepare = async () => ({ ready: true }), flush = async () => ({ failed: 0 }), open = async () => {} } = {}) {
  const events = [], handlers = {}
  const host = { lifecycle: {
    onPrepareQuit: fn => { handlers.prepare = fn },
    onQuitCancelled: fn => { handlers.cancelled = fn },
    cancelQuit: () => events.push('cancel-request'),
  }, menu: { onAction: fn => { handlers.open = fn }, ackOpenPath: () => events.push('open-ack') } }
  const uni = {
    $emit: name => events.push(name), showLoading: () => {}, hideLoading: () => events.push('hide-loading'),
    showModal: () => events.push('modal'),
  }
  new Function('host', 'uni', 'window', 'createDesktopQuitGuard', 'prepareAgentRestart', 'abortAgentRestart',
    'flushQuitWorkbenches', 'setGlobalOverlay', 'openLocalRootPath', 'openLocalFilePath', block).call({ $t: key => key }, host, uni,
    { addEventListener: (_, fn) => { handlers.key = fn } }, createDesktopQuitGuard,
    prepare, async () => { events.push('abort'); return { paused: 0 } }, flush,
    enabled => events.push(enabled ? 'blocked' : 'unblocked'), open, open)
  return { events, handlers, escape() { handlers.key({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }) } }
}

test('real App wiring cancels startup recovery and keeps input blocked after successful ACK', async () => {
  const h = harness()
  assert.equal((await h.handlers.prepare()).ok, true)
  assert.equal(h.events[0], 'awd:cancel-restart-recovery')
  assert.ok(h.events.includes('blocked'))
  assert.ok(!h.events.includes('unblocked'))
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
  await Promise.resolve()
  await h.handlers.cancelled()
  ready({ ready: true })
  assert.equal((await pending).ok, false)
  assert.equal(h.events.filter(event => event === 'abort').length, 1)
  assert.ok(h.events.includes('unblocked'))
  assert.ok(h.events.includes('modal'))
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
