// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D12: the first view of a Word document — page fits the pane, no bookmark brackets around every
// paragraph (each carries an __ai_anchor_ bookmark), and the review ball says what it is.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')

test('bookmark indicators are turned off together with text boundaries', async () => {
  globalThis.uni = { getStorageSync: () => '', setStorageSync() {} }
  const { getWriterViewOptions } = await import('../../src/utils/editorViewPrefs.js')
  const opts = getWriterViewOptions({})
  assert.equal(opts.bookmarks, false)
  assert.equal(opts.textBoundaries, false)
  const engine = read('../../src/zetaoffice/public/office_thread.js')
  assert.match(engine, /if \(req\.bookmarks != null\) \{[\s\S]{0,200}setPropertyValue\('ShowBookmarks'/)
  assert.match(engine, /nodepath', '\/org\.openoffice\.Office\.Writer\/Content\/NonprintingCharacter'\)\]\);\s*access\.replaceByName\('Bookmarks'/)
})

test('the page is fitted to the pane once the document has loaded', () => {
  const editor = read('../../src/components/LibreOfficeEditor.vue')
  assert.match(editor, /if \(!this\.docLoadFailed\) await this\.prepareInitialChrome\(\)\s*\n[^\n]*\n\s*if \(!this\.docLoadFailed && typeof this\.fitPaneWidth === 'function'\) this\.fitPaneWidth\(300\)/)
})

test('the English review ball is labelled, not a bare "R"', () => {
  const ball = read('../../src/composables/zetaOfficeInlineReview.js')
  assert.match(ball, /title: 'AI review', icon: 'Review'/)
})
