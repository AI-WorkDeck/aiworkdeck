// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
function setup(initial = '30日', around = { before: '', after: '' }) {
  let text = initial, selected = true, writes = 0
  const bookmarks = new Map()
  const range = { getString: () => text, getText: () => story }
  const story = { insertTextContent: (_, bm) => bookmarks.set(bm.getName(), bm), removeTextContent: bm => bookmarks.delete(bm.getName()) }
  const realm = vm.createContext({ anchorSeq: 0,
    xModel: {
      createInstance: () => { let name; return { setName: n => { name = n }, getName: () => name, getAnchor: () => range } },
      getBookmarks: () => ({ hasByName: n => bookmarks.has(n), getByName: n => bookmarks.get(n), getElementNames: () => [...bookmarks.keys()] }),
      getText: () => story, setPropertyValue() {},
    }, selectVisibly: () => selected, contextAround: () => around,
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

// eval 2026-11-11 g16「删除第三条」：锚点只覆盖「第三条」，模型 newText 却写整段条文，
// 替换后同段原文重复出现，接着 undo/重找/重替换空转 19 轮。写之前就退回。
const PARA_AFTER = ' 交付：甲方应在收到货物后 7 日内验收，甲方逾期验收视为合格；甲方不得无故拒收。\n第四条 违约金'
test('newText that re-types text just outside the anchor is rejected without writing', () => {
  const cases = [
    // g16 run 2：锚点「第三条」，newText = 整段
    ['第三条', { before: '执行。\n', after: PARA_AFTER }, '第三条 交付：甲方应在收到货物后 7 日内验收，甲方逾期验收视为合格；甲方不得无故拒收。'],
    // g16 run 3：锚点「第三条 交付」，newText = 锚点后面的原文
    ['第三条 交付', { before: '执行。\n', after: '：甲方应在收到货物后 7 日内验收，甲方逾期验收视为合格；甲方不得无故拒收。\n第四条' }, '：甲方应在收到货物后 7 日内验收，甲方逾期验收视为合格；甲方不得无故拒收。'],
    // s01 run 3：改写锚点时顺手把后半句也改写进 newText
    ['甲方应在收到货物后 7 日内验收', { before: '第三条 交付：', after: '，甲方逾期验收视为合格；甲方不得无故拒收。\n第四条' }, '委托人应在收到货物后 7 日内验收，委托人逾期验收视为合格；委托人不得无故拒收'],
    // 前侧同理：newText 把锚点前的原文又写一遍
    ['7 日内验收', { before: '第三条 交付：甲方应在收到货物后 ', after: '，甲方逾期' }, '甲方应在收到货物后 10 日内验收'],
  ]
  for (const [anchorText, around, newText] of cases) {
    const s = setup(anchorText, around)
    const result = s.methods.replace_at_position({ anchor: s.anchor, newText })
    assert.equal(result.success, false, newText)
    assert.match(result.message, /锚点只覆盖「/)
    assert.match(result.message, /doc_find_text/)
    assert.equal(s.writes(), 0)
  }
})
test('ordinary replacements and deletions near similar text still go through', () => {
  const cases = [
    ['30 日', { before: '发票后 ', after: '内支付全部货款。\n第三条' }, '45 日'],
    // 整段锚点删除：锚点外同段为空
    ['第三条 交付：甲方应在收到货物后 7 日内验收。', { before: '执行。\n', after: '\n第四条 违约金：任一方违约，应按合同总价的 50%' }, ''],
    // 共同片段在锚点原文里（只是改一处数字），不算重复
    ['每逾期一日按合同总价的 0.1%', { before: '乙方逾期交货的，', after: '向甲方支付违约金；逾期超过 10 日的，按合同总价的 0.2%' }, '每逾期一日按合同总价的 0.05%'],
    ['乙方', { before: '', after: '应于 2026 年 12 月 31 日前' }, '乙方（卖方）'],
  ]
  for (const [anchorText, around, newText] of cases) {
    const s = setup(anchorText, around)
    assert.equal(s.methods.replace_at_position({ anchor: s.anchor, newText }).success, true, newText)
    assert.equal(s.writes(), 1)
  }
})
test('text in the next paragraph is not treated as an echo', () => {
  const s = setup('第三条', { before: '', after: '\n第四条 违约金：任一方违约，应按合同总价的 50%' })
  assert.equal(s.methods.replace_at_position({ anchor: s.anchor, newText: '第三条 违约金：任一方违约，应按合同总价的 50%' }).success, true)
})
// g19（2026-11-11 复测）：刚在第三条后插入新段，模型又把「第三条…\n新段」整体写进第三条的锚点
test('multi-paragraph newText that re-types the neighbouring paragraph is rejected', () => {
  const clause3 = '第三条 交付：甲方应在收到货物后 7 日内验收。'
  const s = setup(clause3, { before: '执行。\n', after: '\n第四条 随附文件：乙方交货时应随附产品合格证和出厂检验报告。\n第四条 违约金' })
  const result = s.methods.replace_at_position({ anchor: s.anchor, newText: clause3 + '\n第四条 随附文件：乙方交货时应随附产品合格证和出厂检验报告。' })
  assert.equal(result.success, false)
  assert.match(result.message, /随附文件/)
  assert.equal(s.writes(), 0)
})
