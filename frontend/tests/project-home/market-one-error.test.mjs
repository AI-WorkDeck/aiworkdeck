// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X8 / D17: an unreachable Marketplace shows one catalogued error with Refresh — not a grey
// "Could not check for updates" line on top of a red "Online marketplace unavailable: <raw>"
// line — and no fake "0" counts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { toUserMessage } from '../../src/utils/userMessage.js'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const sidebar = read('../../src/components/MarketSidebarPanel.vue')
const pane = read('../../src/components/MarketPane.vue')

test('registry failures map to the marketplace message with a Refresh action', () => {
  for (const raw of ['Unable to tunnel through proxy. Proxy returns "HTTP/1.1 403 Forbidden"', 'Failed to fetch', 'HTTP 502']) {
    const m = toUserMessage(raw, { area: 'marketplace' })
    assert.equal(m.key, 'marketplaceUnavailable', raw)
    assert.equal(m.action, 'refresh')
  }
})

test('sidebar: one error per tab, the status line only says "checking", no counts while unreachable', () => {
  assert.doesNotMatch(sidebar, /checkingUpdatesFailed|marketUnavailablePrefixed/)
  assert.match(sidebar, /<view v-if="marketPluginLoading" class="msb-update-status"/)
  assert.match(sidebar, /<text v-if="!marketError" class="msb-tab-count">\{\{ skillRows\.length \}\}/)
  assert.match(sidebar, /<text v-if="!marketPluginError" class="msb-tab-count">\{\{ pluginRows\.length \}\}/)
  assert.equal((sidebar.match(/<AwdInlineError [^>]*:context="\{ area: 'marketplace' \}"/g) || []).length, 2)
})

test('full Marketplace pane: no raw {error} interpolation left', () => {
  assert.doesNotMatch(pane, /marketErrorHint|pluginMarketErrorHint/)
  assert.equal((pane.match(/<AwdInlineError [^>]*:context="\{ area: 'marketplace' \}"/g) || []).length, 3)
})
