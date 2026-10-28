// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { planFormatInheritance } from './excelFormat.js'
const fmt = Array.from({ length: 4 }, () => ({ bold: true, numberFormat: '0.000', background: '#D9EAF7' }))
const input = { startRow: 7, targetRows: [['', '', '', '']], values: [['appended', 4, 5, 6]], rowFormats: new Map([[5, fmt], [6, fmt]]) }
test('native QA singleton template is intentionally not a safe append source', () => {
  assert.deepEqual(planFormatInheritance({ ...input, aboveRows: [['', '', '', ''], ['template', 1, 2, 3]] }), [])
})
test('native QA two consistent existing data rows permit real format inheritance', () => {
  assert.deepEqual(planFormatInheritance({ ...input, aboveRows: [['existing-1', 1, 2, 3], ['existing-2', 2, 3, 4]] }), [{ row: 7, from: 6, root: 6 }])
})
