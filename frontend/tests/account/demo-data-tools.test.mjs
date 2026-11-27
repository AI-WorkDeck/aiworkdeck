// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X12: "fill demo data" buttons only in a development build or with an explicit developer opt-in.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { demoDataToolsVisible, DEMO_DATA_TOOLS_KEY } from '../../src/utils/demoData.js'

const store = (v) => ({ getItem: (k) => (k === DEMO_DATA_TOOLS_KEY ? v : null) })

test('hidden in a production build by default', () => {
  assert.equal(demoDataToolsVisible({ env: { DEV: false, MODE: 'production' }, storage: store(null) }), false)
  assert.equal(demoDataToolsVisible({ env: { MODE: 'production' }, storage: store('0') }), false)
})

test('shown in a development build or with the local opt-in', () => {
  assert.equal(demoDataToolsVisible({ env: { DEV: true }, storage: store(null) }), true)
  assert.equal(demoDataToolsVisible({ env: { MODE: 'production' }, storage: store('1') }), true)
})

test('both seed buttons are gated, and the empty state no longer points at them', () => {
  const read = (p) => fs.readFileSync(new URL('../../src/' + p, import.meta.url), 'utf8')
  assert.match(read('components/userprofile/PersonalCaseIntakePanel.vue'), /<button v-if="demoDataTools" class="intake-btn"[^>]*@tap="onSeedDemoData">/)
  assert.match(read('components/admin/TeamPanel.vue'), /<view v-if="demoDataTools"[^>]*@tap="onSeedLawFirmDemo">/)
  const dir = new URL('../../src/locales/', import.meta.url)
  for (const l of fs.readdirSync(dir).filter((d) => /^[a-z]{2}-[A-Z]{2}$/.test(d))) {
    const ns = new Function(fs.readFileSync(new URL(l + '/account.js', dir), 'utf8').replace(/^\s*export\s+default\s*/m, 'return '))()
    assert.ok(!ns.caseIntakeEmpty.includes(ns.caseIntakeSeedBtn), `${l}: caseIntakeEmpty still mentions the demo button`)
  }
})
