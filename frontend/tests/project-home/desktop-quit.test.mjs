// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopQuitGuard } from '../../src/utils/desktopQuitGuard.js'

function setup(overrides = {}) {
  const calls = []
  const guard = createDesktopQuitGuard({
    prepare: async () => { calls.push('pause'); return { ready: true } },
    abort: async () => calls.push('abort'),
    flush: async () => { calls.push('save'); return { failed: 0 } },
    progress: stage => calls.push(stage),
    errorText: key => key,
    wait: async () => {},
    ...overrides,
  })
  return { guard, calls }
}

test('quit pauses AI before saving, then acknowledges only confirmed saves', async () => {
  const { guard, calls } = setup()
  assert.deepEqual(await guard.prepare(), { ok: true })
  assert.deepEqual(calls, ['pausing', 'pause', 'saving', 'save'])
})

test('a failed save aborts suspension and rejects quitting', async () => {
  const { guard, calls } = setup({ flush: async () => ({ failed: 1 }) })
  assert.equal((await guard.prepare()).ok, false)
  assert.ok(calls.includes('abort'))
})

test('cancellation during an in-flight prepare cannot subsequently save or acknowledge', async () => {
  let finish
  const { guard, calls } = setup({ prepare: () => new Promise(resolve => { finish = resolve }) })
  const pending = guard.prepare()
  await guard.cancel()
  finish({ ready: true })
  assert.equal((await pending).ok, false)
  assert.ok(!calls.includes('save'))
  assert.equal(calls.filter(c => c === 'abort').length, 1)
})

test('a task left paused after abort is disclosed instead of claiming it resumed', async () => {
  const { guard } = setup({ flush: async () => ({ failed: 1 }), abort: async () => ({ paused: 1 }) })
  assert.deepEqual(await guard.prepare(), { ok: false, error: 'saveFailed\nrecoveryPending' })
})

test('an unavailable abort endpoint leaves quit blocked and discloses uncertain recovery', async () => {
  const { guard } = setup({ flush: async () => ({ failed: 1 }), abort: async () => { throw new Error('offline') } })
  assert.deepEqual(await guard.prepare(), { ok: false, error: 'saveFailed\nrecoveryPending' })
})

test('unsafe tool boundary is polled, never treated as ready', async () => {
  let count = 0
  const { guard, calls } = setup({ prepare: async () => ({ ready: ++count === 3 }) })
  assert.equal((await guard.prepare()).ok, true)
  assert.equal(count, 3)
  assert.equal(calls.filter(c => c === 'save').length, 1)
})

test('a stalled task reaches the deadline and leaves the app open', async () => {
  let clock = 0
  const { guard, calls } = setup({ prepare: async () => ({ ready: false }), now: () => clock++, timeoutMs: 2 })
  assert.equal((await guard.prepare()).ok, false)
  assert.ok(calls.includes('abort'))
  assert.ok(!calls.includes('save'))
})
