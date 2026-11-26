// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// C23: a client's portal upload is its own version, labelled 「客户材料」 (「提交」 is reserved for saving versions) in the history detail.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tab = readFileSync(new URL('../../src/components/version/CommitHistoryTab.vue', import.meta.url), 'utf8')

test('the history type label covers client submissions', () => {
  assert.match(tab, /'client-submission': this\.\$t\('version\.typeClientSubmission'\)/)
  for (const [loc, text] of [['zh-CN', '客户材料'], ['zh-TW', '客戶材料'], ['en-US', 'Client materials']]) {
    const src = readFileSync(new URL(`../../src/locales/${loc}/version.js`, import.meta.url), 'utf8')
    assert.ok(src.includes(text), loc)
  }
})
