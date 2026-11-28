// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// POLISH Q1: registry skills are Chinese-only. Outside a Chinese UI the card says so,
// and the skill card no longer shows the pinyin slug (li-hun-xie-yi-shu-qi-cao) under the title.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../../src/components/MarketPane.vue', import.meta.url), 'utf8')

test('skill card: no slug under the title', () => {
  assert.match(src, /<text class="card-id">v\{\{ m\.version \|\| '1\.0\.0' \}\} · \{\{ priceTag\(m\) \}\}<\/text>/)
  assert.doesNotMatch(src, /\{\{ m\.id \}\} · v\{\{ m\.version \|\| '1\.0\.0' \}\} · \{\{ priceTag\(m\) \}\}/)
})

test('skill and plugin cards tag Chinese-only entries outside a Chinese UI', () => {
  assert.equal((src.match(/v-if="chineseOnly\(m\)"/g) || []).length, 2)
  const body = src.slice(src.indexOf('chineseOnly(m) {'))
  const fn = new Function('m', 'locale', body.slice(body.indexOf('{') + 1, body.indexOf('\n    },')).replace('this.$i18n && this.$i18n.locale', 'locale'))
  assert.equal(fn({ name: '离婚协议书起草' }, 'en-US'), true)
  assert.equal(fn({ name: 'Startup drafter', description: 'Drafts a one-page agreement' }, 'en-US'), false)
  assert.equal(fn({ name: '離婚協議書起草' }, 'zh-TW'), false)
  assert.equal(fn({ name: '离婚协议书起草' }, 'zh-CN'), false)
})

test('no CSS text leaks into the template (shipped in 0.91.0 via #1703)', () => {
  const template = src.slice(0, src.indexOf('<script'))
  assert.doesNotMatch(template, /^\s*\.[a-z-]+ \{[^}]*\}\s*$/m)
})
