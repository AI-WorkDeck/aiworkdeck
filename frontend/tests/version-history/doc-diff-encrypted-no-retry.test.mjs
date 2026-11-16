// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 台账 B10 附注 (a)：加密 .xlsx 走文本比对报 DOC_ENCRYPTED 时，「重试」永远不会成功，不该出现。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../../src/components/DocDiffViewer.vue', import.meta.url), 'utf8')

test('the diff error screen hides retry for password-protected files, keeps it otherwise', () => {
  const btn = src.match(/<button[^>]*class="retry-btn"[^>]*>/)
  assert.ok(btn, 'retry button')
  assert.match(btn[0], /v-if="errorKind !== 'DOC_ENCRYPTED'"/)
  const i = src.indexOf("this.error = e && e.kind === 'DOC_ENCRYPTED'")
  assert.ok(i > 0)
  assert.match(src.slice(i - 120, i), /this\.errorKind = \(e && e\.kind\) \|\| ''/, 'errorKind is set from the same error')
  assert.match(src, /this\.error = null\n\s*this\.errorKind = ''/, 'a new load clears it')
})
