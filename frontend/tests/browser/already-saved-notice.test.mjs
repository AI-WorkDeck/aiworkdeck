// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 教程问题 69/70（dev-board#1713）：「已在收藏夹中」「已在快捷方式中」原来只弹 toast，
// 用户此刻停在浏览器标签上，toast 在 DOM 层、被原生 BrowserView 整个盖住，表现为「点了没反应」。
// 改走 host.app.confirm（原生弹窗，与收藏失败同一写法）；网页端仍用 toast。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/components/BrowserPane.vue', import.meta.url), 'utf8')

function methodBody(name) {
  const start = SRC.indexOf(`  ${name}() {`)
  assert.ok(start > 0, `找不到 ${name}`)
  return SRC.slice(start, SRC.indexOf('\n    },', start))
}

for (const [method, key] of [['favoriteCurrentPage', 'bpAlreadyFavorited'], ['pinCurrentPage', 'bpAlreadyPinned']]) {
  test(`69/70: ${method} 的「${key}」提示走不被 BrowserView 遮挡的通知`, () => {
    const body = method === 'favoriteCurrentPage' ? SRC.slice(SRC.indexOf('async favoriteCurrentPage() {'), SRC.indexOf('loadShortcuts() {')) : methodBody(method)
    assert.match(body, new RegExp(`notifyAboveView\\(this\\.\\$t\\('panels\\.${key}'\\)\\)`))
    assert.doesNotMatch(body, new RegExp(`showToast\\(\\{ title: this\\.\\$t\\('panels\\.${key}'\\)`))
  })
}

test('69/70: notifyAboveView 桌面端走 host.app.confirm，没有就退回 toast', () => {
  const start = SRC.indexOf('notifyAboveView(title) {')
  assert.ok(start > 0)
  const body = SRC.slice(start, SRC.indexOf('\n    },', start))
  assert.match(body, /host\.app && host\.app\.confirm/)
  assert.match(body, /uni\.showToast/)
})
