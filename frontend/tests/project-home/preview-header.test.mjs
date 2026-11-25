// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D13: the preview header is the file name and its size, not a developer metadata line
// ("Type: pdf  Size: 36.54 MB"). Applies to every format FilePreview shows (PDF, Word/PPT read-only, images).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../../src/components/FilePreview.vue', import.meta.url), 'utf8')

test('no "Type:" / "Size:" labels above the preview', () => {
  assert.doesNotMatch(src, /files\.typeLabel|files\.sizeLabel|class="preview-meta"/)
})

test('the size sits in the title row as a plain value', () => {
  const row = src.slice(src.indexOf('<view class="preview-title-row">'), src.indexOf('</view>', src.indexOf('<view class="preview-title-row">')))
  assert.match(row, /<text class="meta-item" v-if="file\.fileSize">\{\{ formatFileSize\(file\.fileSize\) \}\}<\/text>/)
})
