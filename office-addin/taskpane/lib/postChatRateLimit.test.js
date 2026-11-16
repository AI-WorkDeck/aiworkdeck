// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Server per-user rate limit (HTTP 429 on POST /api/agent/chat) shows a readable message,
 * not the bare "HTTP 429", and keeps the status for callers.
 *   node --test office-addin/taskpane/lib/postChatRateLimit.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) }
}

const { postChat } = await import('./api.js')
const { t } = await import('./i18n.js')

test('429 from chat becomes the localized rate-limit message', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false, status: 429,
    json: async () => ({ code: 4290, reason: 'RATE_LIMITED', message: 'x', retryAfterSeconds: 2 })
  })
  try {
    await assert.rejects(postChat({ serverUrl: 'https://example.test', token: 'awdt_x' }, {}), (err) => {
      assert.equal(err.status, 429)
      assert.equal(err.message, t('apiChatRateLimited'))
      assert.notEqual(err.message, t('apiChatFailedHttp', { status: 429 }))
      return true
    })
  } finally {
    globalThis.fetch = original
  }
})
