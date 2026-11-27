// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatTurnCost, pollTurnCost, TURN_COST_DELAYS } from '../../src/utils/turnCost.js'

const noSleep = { sleep: async () => {} }

test('Q24: only a fully settled amount is shown, with its source label', () => {
  assert.deepEqual(formatTurnCost({ available: true, cents: 170, currency: 'CNY', pending: 0, walletCents: 170 }), { amount: '¥1.70', source: '' })
  assert.deepEqual(formatTurnCost({ available: true, cents: 2, currency: 'USD', pending: 0 }), { amount: '$0.02', source: '' })
  assert.deepEqual(formatTurnCost({ available: true, cents: 170, currency: 'CNY', pending: 0, subscriptionCents: 170 }), { amount: '¥1.70', source: 'subscription' })
  assert.deepEqual(formatTurnCost({ available: true, cents: 170, currency: 'CNY', pending: 0, bqtCents: 170 }), { amount: '¥1.70', source: 'bqt' })
  assert.deepEqual(formatTurnCost({ available: true, cents: 170, currency: 'CNY', pending: 0, subscriptionCents: 100, walletCents: 70 }), { amount: '¥1.70', source: '' })
  assert.equal(formatTurnCost({ available: true, cents: 170, currency: 'CNY', pending: 1 }), null)
  assert.equal(formatTurnCost({ available: false }), null)
  assert.equal(formatTurnCost({ available: true, cents: 1.5, pending: 0 }), null)
})

test('Q24: polls on the agreed schedule until settled, then stops', async () => {
  const waits = []
  let n = 0
  const shown = await pollTurnCost(async () => (++n < 3 ? { available: true, cents: 90, pending: 1 } : { available: true, cents: 170, currency: 'CNY', pending: 0 }),
    { sleep: async ms => { waits.push(ms) } })
  assert.deepEqual(shown, { amount: '¥1.70', source: '' })
  assert.deepEqual(waits, TURN_COST_DELAYS.slice(0, 3))
  assert.deepEqual(TURN_COST_DELAYS.reduce((acc, d) => [...acc, (acc.at(-1) || 0) + d], []), [500, 1500, 4000, 15000])
})

test('Q24: still pending after the last check, unavailable, failing or superseded falls back to 查看用量', async () => {
  assert.equal(await pollTurnCost(async () => ({ available: true, cents: 10, pending: 2 }), noSleep), null)
  assert.equal(await pollTurnCost(async () => ({ available: false }), noSleep), null)
  assert.equal(await pollTurnCost(async () => { throw new Error('offline') }, noSleep), null)
  let calls = 0
  assert.equal(await pollTurnCost(async () => { calls++; return { available: true, cents: 1, pending: 0 } }, { ...noSleep, stillCurrent: () => false }), null)
  assert.equal(calls, 0)
})

test('Q24: the stream keeps the platform runId and the footer shows amount / settling / 查看用量', () => {
  const stream = readFileSync(new URL('../../src/composables/useAgentStream.js', import.meta.url), 'utf8')
  assert.match(stream, /d\.platform === true && typeof d\.runId === 'string'/)
  const chat = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
  assert.match(chat, /chat\.turnCostSettling/)
  assert.match(chat, /getTurnCost\(conversationId, runId\)/)
  assert.match(chat, /chat\.viewUsage/)
})

test('Q24: a turn that also generated a presentation shows the partial amount and links to usage', () => {
  assert.deepEqual(formatTurnCost({ available: true, cents: 170, currency: 'CNY', pending: 0, excludesPresentation: true }), { amount: '¥1.70', source: '', partial: true })
  const chat = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
  assert.match(chat, /turnCost\.partial" class="token-value token-usage-link"[^>]*@tap="openUsageSettings"[^>]*>\{\{ \$t\('chat\.turnCostPartial'/)
})

test('Q24 intl: OpenRouter amounts keep their precision (micros), never rounded to zero', () => {
  assert.deepEqual(formatTurnCost({ available: true, currency: 'USD', micros: 11300, cents: 1, pending: 0 }), { amount: '$0.0113', source: '' })
  assert.deepEqual(formatTurnCost({ available: true, currency: 'USD', micros: 1500000, cents: 150, pending: 0 }), { amount: '$1.50', source: '' })
  assert.deepEqual(formatTurnCost({ available: true, currency: 'USD', micros: 0, cents: 0, pending: 0 }), { amount: '$0.00', source: '' })
})

test('Q24: the post-turn suggestion is billed to the turn and the footer waits for it', () => {
  const chat = readFileSync(new URL('../../src/components/ChatInterface.vue', import.meta.url), 'utf8')
  assert.match(chat, /chatSuggestions\.loading\.value\]/)
  assert.match(chat, /if \(suggesting\) return/)
  assert.match(chat, /runId: \(\) => tokenUsage\.value && tokenUsage\.value\.runId/)
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8')
  assert.match(api, /requestChatSuggestion\(conversationId, modelId, runId = null\)/)
})
