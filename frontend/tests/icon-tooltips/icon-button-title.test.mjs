// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 纯图标按钮悬停要显示名称：关键入口必须带 title（原生悬浮提示），且引用的
// i18n key 在 zh-CN / en-US 都存在。读源码做断言，不搭 uni-app 组件桩。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')

// 取含给定 class 的开始标签（可跨行）
function openTag(src, cls) {
  const re = new RegExp(`<(?:view|text|button)\\b(?:[^>"']|"[^"]*"|'[^']*')*class="[^"]*\\b${cls}\\b[^"]*"(?:[^>"']|"[^"]*"|'[^']*')*>`, 'g')
  return src.match(re) || []
}

const chat = read('components/ChatInterface.vue')
const overview = read('pages/project-overview/project-overview.vue')

for (const cls of ['send-btn', 'stop-btn', 'file-add-btn', 'preview-remove', 'skill-chip-remove']) {
  test(`AI 面板 .${cls} 带 title`, () => {
    const tags = openTag(chat, cls)
    assert.ok(tags.length > 0)
    for (const t of tags) assert.match(t, /:title="\$t\('[\w.]+'\)"/)
  })
}

test('AI 面板头部按钮不再用写死的英文 title', () => {
  assert.doesNotMatch(chat, /title="(History|New Chat|Close|Add File)"/)
})

test('活动栏按钮与标签页关闭按钮带 title', () => {
  for (const t of openTag(overview, 'rail-btn')) assert.match(t, /:title=/)
  const closes = openTag(overview, 'tab-close')
  assert.ok(closes.length >= 2)
  for (const t of closes) assert.match(t, /:title="\$t\('common\.close'\)"/)
})

test('新增的通用 key 在 zh-CN 与 en-US 都存在', async () => {
  for (const loc of ['zh-CN', 'en-US']) {
    const m = (await import(new URL(`../../src/locales/${loc}/common.js`, import.meta.url))).default
    for (const k of ['close', 'delete', 'remove', 'clear', 'zoomIn', 'zoomOut', 'moveUp', 'moveDown']) {
      assert.equal(typeof m[k], 'string', `${loc} common.${k}`)
    }
  }
})
