// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/components/MeetingRecordingPanel.vue', import.meta.url), 'utf8')

test('转写稿小框用悬停才显示的 4px 细滑轨，不再和外层面板的滚动条叠成两条粗条', () => {
  const tag = /<view class="[^"]*\bmr-transcript\b[^"]*">/.exec(source)
  assert.ok(tag, '找不到转写稿容器 .mr-transcript')
  assert.match(tag[0], /\bawd-hairline-scroll\b/, '.mr-transcript 要挂 .awd-hairline-scroll')
})
