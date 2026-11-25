// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// POLISH X29：中文标点守卫自身的回归测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compare } from '../../scripts/check-zh-punctuation.mjs'

test('baseline tolerates existing problems only, counting duplicates', () => {
  const { extra, fixed } = compare(['a', 'a', 'b'], ['a', 'c'])
  assert.deepEqual(extra, ['a', 'b'])
  assert.deepEqual(fixed, ['c'])
})
