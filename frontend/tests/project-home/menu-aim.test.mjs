// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { isWithinSubmenuAim } from '../../src/utils/menuAim.js'

test('diagonal movement towards either submenu edge stays in the safe triangle', () => {
  const rect = { left: 220, right: 390, top: 100, bottom: 210 }
  assert.equal(isWithinSubmenuAim({ x: 210, y: 185 }, { x: 90, y: 116 }, rect), true)
  assert.equal(isWithinSubmenuAim({ x: 170, y: 220 }, { x: 90, y: 116 }, rect), false)
  assert.equal(isWithinSubmenuAim({ x: 80, y: 116 }, { x: 90, y: 116 }, rect), false)
  assert.equal(isWithinSubmenuAim({ x: 400, y: 185 }, { x: 520, y: 116 }, rect, 'left'), true)
  assert.equal(isWithinSubmenuAim({ x: 500, y: 220 }, { x: 520, y: 116 }, rect, 'left'), false)
})

test('missing geometry and a degenerate triangle never trap sibling hover', () => {
  assert.equal(isWithinSubmenuAim({ x: 2, y: 3 }, null, {}), false)
  assert.equal(isWithinSubmenuAim({ x: 2, y: 3 }, { x: 2, y: 3 }, { left: 2 }), false)
})
