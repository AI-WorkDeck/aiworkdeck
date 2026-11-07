// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { countsByFile, forFile, previewText, isStale, totalEdits, STALE_CODE } from '../../src/utils/pendingRevision.js'

const rows = [
  { id: 1, fileId: 3, status: 'PENDING', edits: [{ find: 'a', replace: 'b' }, { find: 'c', replace: 'd' }] },
  { id: 2, fileId: 3, status: 'STALE', edits: [{ find: 'x', replace: '' }] },
  { id: 3, fileId: 9, status: 'PENDING', edits: [] },
]

test('counts proposals per file, stale included', () => {
  assert.deepEqual(countsByFile(rows), { 3: 2, 9: 1 })
  assert.deepEqual(countsByFile(null), {})
})

test('forFile filters by id regardless of string/number', () => {
  assert.equal(forFile(rows, '3').length, 2)
  assert.equal(forFile(rows, 7).length, 0)
})

test('preview truncates and collapses whitespace', () => {
  assert.equal(previewText('a\n  b'), 'a b')
  assert.equal(previewText('x'.repeat(100), 10), 'xxxxxxxxxx…')
  assert.equal(previewText(null), '')
})

test('stale detection and edit totals', () => {
  assert.equal(isStale(rows[1]), true)
  assert.equal(isStale(rows[0]), false)
  assert.equal(totalEdits(rows[0]), 2)
  assert.equal(STALE_CODE, 4090)
})

test('every revision.* key used by the bar exists in zh-CN and en-US, with accept/reject wired', async () => {
  const bar = fs.readFileSync(new URL('../../src/components/PendingRevisionBar.vue', import.meta.url), 'utf8')
  const keys = [...bar.matchAll(/revision\.(\w+)/g)].map((m) => m[1])
  assert.ok(keys.length >= 8)
  for (const loc of ['zh-CN', 'en-US']) {
    const mod = (await import(`../../src/locales/${loc}/revision.js`)).default
    for (const k of new Set(keys)) assert.ok(mod[k], `${loc} missing revision.${k}`)
  }
  assert.match(bar, /@tap="onAccept\(r\)"/)
  assert.match(bar, /@tap="onReject\(r\)"/)
})

test('file tree badge and editor bar are mounted', () => {
  const tree = fs.readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
  const editor = fs.readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')
  assert.match(tree, /pendingRevisionCounts\[item\.id\]/)
  assert.match(editor, /<PendingRevisionBar/)
})
