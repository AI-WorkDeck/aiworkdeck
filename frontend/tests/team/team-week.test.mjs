// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  weekDays, memberWeek, loadBand, loadRatio, cellLevel, completedWorkdays,
  LIGHT_MAX_RATIO, BALANCED_MAX_RATIO,
} from '../../src/utils/teamWeek.js'

const MON = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']

test('weekDays: Monday, Wednesday, Sunday all map to the same Mon..Fri', () => {
  assert.deepEqual(weekDays(new Date(2026, 10, 2)), MON)
  assert.deepEqual(weekDays(new Date(2026, 10, 4, 15)), MON)
  assert.deepEqual(weekDays(new Date(2026, 10, 7)), MON)
  assert.deepEqual(weekDays(new Date(2026, 10, 8)), MON)
})

test('weekDays: crosses month boundary', () => {
  assert.deepEqual(weekDays(new Date(2026, 10, 3)).length, 5)
  assert.deepEqual(weekDays(new Date(2026, 9, 29)), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'])
  assert.equal(weekDays(new Date(2026, 11, 2))[4], '2026-12-04')
  assert.equal(weekDays(new Date(2026, 0, 1))[0], '2025-12-29')
})

test('memberWeek: missing days are 0, extra days ignored, sums over 5 days', () => {
  const m = {
    daily: [
      { date: '2026-11-02', activeMinutes: 100 },
      { date: '2026-11-04', activeMinutes: 50 },
      { date: '2026-11-01', activeMinutes: 999 },
    ],
    currentProject: { projectKey: 'p1', label: '并购A' },
  }
  const w = memberWeek(m, MON)
  assert.deepEqual(w.cells.map((c) => c.minutes), [100, 0, 50, 0, 0])
  assert.equal(w.weekMinutes, 150)
  assert.equal(w.currentLabel, '并购A')
  assert.equal(w.hasProject, true)
})

test('memberWeek: project without label / no project / no daily', () => {
  const a = memberWeek({ currentProject: { projectKey: 'k', label: null } }, MON)
  assert.equal(a.currentLabel, null)
  assert.equal(a.hasProject, true)
  assert.equal(a.weekMinutes, 0)
  const b = memberWeek({ currentProject: null }, MON)
  assert.equal(b.hasProject, false)
  assert.equal(b.currentLabel, null)
})

test('completedWorkdays counts only days already over (uploads lag one day)', () => {
  assert.equal(completedWorkdays(new Date(2026, 10, 2)), 0) // Mon
  assert.equal(completedWorkdays(new Date(2026, 10, 4)), 2) // Wed
  assert.equal(completedWorkdays(new Date(2026, 10, 6)), 4) // Fri
  assert.equal(completedWorkdays(new Date(2026, 10, 7)), 5) // Sat
  assert.equal(completedWorkdays(new Date(2026, 10, 8)), 5) // Sun
})

test('loadBand: boundaries on Wednesday (expected 2 x 480 = 960)', () => {
  const wed = new Date(2026, 10, 4)
  assert.equal(LIGHT_MAX_RATIO, 0.6)
  assert.equal(BALANCED_MAX_RATIO, 1.0)
  assert.equal(loadBand(0, wed), 'light')
  assert.equal(loadBand(575, wed), 'light')
  assert.equal(loadBand(576, wed), 'balanced') // exactly 0.6
  assert.equal(loadBand(960, wed), 'balanced') // exactly 1.0
  assert.equal(loadBand(961, wed), 'busy')
})

test('loadBand: Monday has no comparable data; Sunday uses 5 days', () => {
  assert.equal(loadBand(0, new Date(2026, 10, 2)), null)
  assert.equal(loadRatio(600, new Date(2026, 10, 2)), null)
  assert.equal(loadBand(2400, new Date(2026, 10, 8)), 'balanced') // 5 days
  assert.equal(loadBand(2401, new Date(2026, 10, 8)), 'busy')
})

test('cellLevel boundaries', () => {
  const got = [0, 1, 119, 120, 299, 300, 479, 480, 900].map(cellLevel)
  assert.deepEqual(got, [0, 1, 1, 2, 2, 3, 3, 4, 4])
})
