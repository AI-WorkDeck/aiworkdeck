// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
function setup() {
  let text = '30日', selected = true, writes = 0
  const bookmarks = new Map()
  const range = { getString: () => text, getText: () => story }
  const story = { insertTextContent: (_, bm) => bookmarks.set(bm.getName(), bm), removeTextContent: bm => bookmarks.delete(bm.getName()) }
  const realm = vm.createContext({ anchorSeq: 0,
    xModel: {
      createInstance: () => { let name; return { setName: n => { name = n }, getName: () => name, getAnchor: () => range } },
      getBookmarks: () => ({ hasByName: n => bookmarks.has(n), getByName: n => bookmarks.get(n), getElementNames: () => [...bookmarks.keys()] }),
      getText: () => story, setPropertyValue() {},
    }, selectVisibly: () => selected, contextAround: () => ({ before: '', after: '' }),
    paragraphTextOf: () => text, applyMinimalRedline: (_, value) => { writes++; text = value; return true },
  })
  vm.runInContext(source.slice(source.indexOf('const ANCHOR_PREFIX'), source.indexOf('// ---- EvidenceLink')), realm)
  const methods = vm.runInContext('({' + source.slice(source.indexOf('  set_selection(p) {'), source.indexOf('  // [verified-extend] insert a paragraph break')) + '})', realm)
  realm.range = range
  const anchor = vm.runInContext('anchorBookmark(range)', realm)
  return { methods, anchor, change: value => { text = value }, selection: value => { selected = value }, writes: () => writes,
    clear: () => vm.runInContext('dropAiAnchors()', realm) }
}
test('changed or deleted anchored text cannot be selected or overwritten', () => {
  for (const changed of ['45日', '']) {
    const s = setup(); s.change(changed)
    for (const method of ['set_selection', 'replace_at_position']) {
      const result = s.methods[method]({ anchor: s.anchor, newText: '60日', __agent: true })
      assert.equal(result.success, false)
      assert.match(result.message, /doc_find_text/)
    }
    assert.equal(s.writes(), 0)
  }
})
test('unchanged target may be replaced, but reuse after changing it requires locating again', () => {
  const s = setup()
  assert.equal(s.methods.replace_at_position({ anchor: s.anchor, newText: '45日' }).success, true)
  assert.equal(s.methods.replace_at_position({ anchor: s.anchor, newText: '60日' }).success, false)
  assert.equal(s.writes(), 1)
})
test('failed visible selection blocks writing', () => {
  const s = setup(); s.selection(false)
  assert.equal(s.methods.replace_at_position({ anchor: s.anchor, newText: '45日' }).success, false)
  assert.equal(s.writes(), 0)
})
test('cleared anchor is rejected without writing', () => {
  const s = setup(); s.clear()
  assert.equal(s.methods.replace_at_position({ anchor: s.anchor, newText: '45日' }).success, false)
  assert.equal(s.writes(), 0)
})
