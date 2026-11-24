// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LAUNCH_MS, LAUNCH_DURATION_STORAGE_KEY, PROGRESS_CAP,
  launchProgress, loadExpectedLaunchMs, saveLaunchMs,
} from '../../src/pages/launch/launchProgress.js'

const memory = (initial = {}) => {
  const data = { ...initial }
  return { data, getStorageSync: k => data[k], setStorageSync: (k, v) => { data[k] = v } }
}

test('progress rises monotonically, is about 87% at the expected time and never passes the cap', () => {
  let last = -1
  for (let t = 0; t <= 60000; t += 250) {
    const p = launchProgress(t, 8000)
    assert.ok(p >= last, `not monotonic at ${t}`)
    assert.ok(p <= PROGRESS_CAP)
    last = p
  }
  assert.equal(launchProgress(0, 8000), 0)
  assert.ok(Math.abs(launchProgress(8000, 8000) - 0.872) < 0.01)
  assert.ok(launchProgress(60000, 8000) < PROGRESS_CAP)
})

test('the expected duration comes from the last launch, with a default and sane bounds', () => {
  assert.equal(loadExpectedLaunchMs(memory()), DEFAULT_LAUNCH_MS)
  assert.equal(loadExpectedLaunchMs(memory({ [LAUNCH_DURATION_STORAGE_KEY]: 5300 })), 5300)
  assert.equal(loadExpectedLaunchMs(memory({ [LAUNCH_DURATION_STORAGE_KEY]: 'junk' })), DEFAULT_LAUNCH_MS)
  assert.equal(loadExpectedLaunchMs(memory({ [LAUNCH_DURATION_STORAGE_KEY]: 999999 })), DEFAULT_LAUNCH_MS)
  assert.equal(loadExpectedLaunchMs({ getStorageSync() { throw new Error('no storage') } }), DEFAULT_LAUNCH_MS)
})

test('only plausible durations are saved', () => {
  const s = memory()
  saveLaunchMs(s, 6123.4)
  assert.equal(s.data[LAUNCH_DURATION_STORAGE_KEY], 6123)
  saveLaunchMs(s, 50)
  saveLaunchMs(s, 10 * 60 * 1000)
  saveLaunchMs(s, NaN)
  assert.equal(s.data[LAUNCH_DURATION_STORAGE_KEY], 6123)
})
