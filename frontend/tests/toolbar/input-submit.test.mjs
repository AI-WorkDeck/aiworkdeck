// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'

const source = readFileSync(process.env.TOOLBAR_SOURCE || new URL('../../src/components/EditorToolbar.vue', import.meta.url), 'utf8')
function fixture(kind = 'calc') {
  const document = { activeElement: null }
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  const imports = [...script.matchAll(/^import\s+([\s\S]*?)\s+from\s+'[^']+'\s*;?\s*$/gm)].flatMap(([, clause]) => clause.replace(/[{},]/g, ' ').trim().split(/\s+/))
  const options = new Function(...imports, 'document', script.replace(/^import\s[\s\S]*?from\s+'[^']+'\s*;?\s*$/gm, '').replace('export default', 'return'))(...imports.map(() => () => {}), document)
  const calls = [], emitted = []
  const vm = { ...options.data(), docKind: kind, $refs: {}, $t: key => key, $emit: name => emitted.push(name) }
  for (const [name, method] of Object.entries(options.methods)) vm[name] = method.bind(vm)
  for (const [name, getter] of Object.entries(options.computed)) Object.defineProperty(vm, name, { get: () => getter.call(vm) })
  vm.state = { ...vm.state, calc: { address: 'K1' }, impress: { slideNumber: 2, shapes: [{ name: 'Table 1', isTable: true }] } }
  vm.call = async (action, params) => { calls.push({ action, params }); return { success: true } }
  vm.refresh = async () => {}
  return { vm, document, calls, emitted }
}
function inputProps(vm, className) {
  const tag = [...source.matchAll(/<input\b[^>]*\/>/g)].map(m => m[0]).find(tag => tag.includes(`class="${className}"`))
  assert.ok(tag, 'Actual toolbar input exists')
  // Compile the actual event bindings. A component node avoids mounting native
  // v-model directives; UniInput itself emits confirm on Enter keyup.
  const render = new Function('Vue', compile(tag.replace('<input', '<UniInput'), { mode: 'function' }).code)(Vue)
  return render(vm, []).props
}
const settle = () => new Promise(resolve => setImmediate(resolve))
const inputElement = (value = '') => ({ value, matches: selector => selector.includes('input'), isContentEditable: false })

for (const [className, method, action, field, fresh] of [
  ['etb-calc-name-box', 'submitCalcAddress', 'sheet_select_range', 'calcAddressInput', 'K1'],
  ['etb-calc-formula-input', 'submitCalcFormula', 'sheet_write_cells', 'calcFormulaInput', '=SUM(A1:H1)+1'],
]) {
  test(`${method}: one Enter submits once and uses confirm value before throttled v-model`, async () => {
    const { vm, calls } = fixture(), props = inputProps(vm, className)
    vm[field] = 'stale'
    const event = { key: 'Enter', detail: { value: fresh }, preventDefault() {}, stopPropagation() {} }
    if (props.onKeydown) await props.onKeydown(event)
    await props.onConfirm(event)
    assert.equal(calls.filter(call => call.action === action).length, 1)
    assert.deepEqual(calls[0].params, action === 'sheet_select_range' ? { range: fresh } : { startCell: 'K1', rows: [[fresh]] })
  })
  for (const focused of ['input', 'textarea', 'contenteditable']) {
    test(`${method}: delayed completion preserves newly focused ${focused}`, async () => {
      const { vm, document, emitted } = fixture()
      let resolve
      vm.call = () => new Promise(done => { resolve = done })
      const pending = vm[method]({ detail: { value: fresh } })
      document.activeElement = { matches: selector => selector.includes(focused), isContentEditable: focused === 'contenteditable' }
      resolve({ success: true }); await pending
      assert.ok(!emitted.includes('focus-editor'))
    })
  }
  test(`${method}: completion still returns focus when no field was selected`, async () => {
    const { vm, emitted } = fixture()
    await vm[method]({ detail: { value: fresh } })
    assert.equal(emitted.filter(name => name === 'focus-editor').length, 1)
  })
}

test('formula apply click reads the real input even before its model update; empty value clears a cell', async () => {
  const { vm, calls } = fixture()
  vm.calcFormulaInput = 'stale'
  const input = inputElement('=42+3')
  vm.$refs.calcFormula = { $el: { querySelector: () => input } }
  await vm.submitCalcFormula({ detail: { x: 1, y: 2 } })
  assert.deepEqual(calls[0].params.rows, [['=42+3']])
  input.value = ''
  await vm.submitCalcFormula({ detail: { x: 1, y: 2 } })
  assert.deepEqual(calls[1].params.rows, [['']])
})

test('programmatic quick formula keeps its generated model value while the DOM still shows the old formula', async () => {
  const { vm, calls } = fixture()
  vm.$refs.calcFormula = { $el: { querySelector: () => inputElement('=OLD()') } }
  await vm.insertCalcQuickFormula('SUM')
  assert.deepEqual(calls[0].params, { startCell: 'K1', rows: [['=SUM(K2:K10)']] })
})

for (const kind of ['writer', 'calc', 'impress']) {
  test(`${kind}: Find confirm uses the new query, not throttled model`, async () => {
    const { vm, calls } = fixture(kind)
    vm.findText = 'stale'
    await vm.findNext({ detail: { value: '新查询' } })
    assert.equal(calls[0].params.keyword, '新查询')
  })
}

test('PPT shape and table confirms use fresh text while notes apply reads its real textarea', async () => {
  const { vm, calls } = fixture('impress')
  vm.impressShapeTextInput = 'old shape'
  await vm.updateImpressShapeText({ detail: { value: '新形状文字' } })
  vm.impressTableCellForm.text = 'old cell'
  await vm.setImpressTableCell({ detail: { value: '新表格文字' } })
  vm.impressNotesInput = 'old notes'
  vm.$refs.impressNotes = { $el: { querySelector: () => inputElement('新备注') } }
  await vm.saveImpressNotes({ detail: { x: 1, y: 2 } })
  assert.equal(calls[0].params.text, '新形状文字')
  assert.equal(calls[1].params.text, '新表格文字')
  assert.equal(calls[2].params.text, '新备注')
  await settle()
})
