// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X39: Continue is offered only for a real cut-off with enough text, never after Stop, mid-tool or a
// changed document, and not after two failed continues.
import test from 'node:test'
import assert from 'node:assert/strict'
import { continueDecision, CONTINUE_MIN_CHARS, weightedLength } from '../../src/utils/continueDecision.js'

const long = 'x'.repeat(CONTINUE_MIN_CHARS)
const base = { errorKey: 'streamInterrupted', partialText: long }

test('a long cut-off answer offers Continue', () => {
  assert.deepEqual(continueDecision(base), { offerContinue: true, messageKey: 'streamInterruptedResumable' })
})

test('too little text: Retry only, plain message', () => {
  assert.deepEqual(continueDecision({ ...base, partialText: 'x'.repeat(CONTINUE_MIN_CHARS - 1) }), { offerContinue: false, messageKey: 'streamInterrupted' })
  assert.equal(continueDecision({ ...base, partialText: '   ' + 'x'.repeat(50) + '   ' }).offerContinue, false)
})

test('Stop, a tool mid-flight or a changed document never offer Continue', () => {
  for (const k of ['stoppedByUser', 'toolInFlight', 'documentChanged']) {
    assert.deepEqual(continueDecision({ ...base, [k]: true }), { offerContinue: false, messageKey: 'streamInterrupted' }, k)
  }
})

test('after two failed continues: Retry only, "cut off again" message', () => {
  assert.equal(continueDecision({ ...base, failedContinues: 1 }).offerContinue, true)
  assert.deepEqual(continueDecision({ ...base, failedContinues: 2 }), { offerContinue: false, messageKey: 'streamInterruptedTwice' })
})

test('other failures keep their own message and never offer Continue', () => {
  assert.deepEqual(continueDecision({ errorKey: 'balanceLow', partialText: long }), { offerContinue: false, messageKey: 'balanceLow' })
  assert.deepEqual(continueDecision({ errorKey: 'serverError', partialText: long }), { offerContinue: false, messageKey: 'serverError' })
})

test('length is weighted: CJK characters count 2.5, so about 80 Chinese characters are enough', () => {
  assert.equal(weightedLength('ab 中文かなㄱ한'), 3 + 2.5 * 6)
  assert.equal(continueDecision({ ...base, partialText: '合'.repeat(80) }).offerContinue, true)
  assert.equal(continueDecision({ ...base, partialText: '合'.repeat(79) }).offerContinue, false)
  assert.equal(continueDecision({ ...base, partialText: '合'.repeat(40) + 'x'.repeat(100) }).offerContinue, true, 'mixed zh/en')
  assert.equal(continueDecision({ ...base, partialText: '合'.repeat(40) + 'x'.repeat(99) }).offerContinue, false, 'mixed zh/en')
})
