// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(process.env.SHEET_WORKER_SOURCE || new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
test('every returned formula cell includes its expression, including cells after the hundredth', () => {
  const range = {
    getRangeAddress: () => ({ StartColumn: 0, EndColumn: 0, StartRow: 0, EndRow: 149 }),
    getCellByPosition: (c, r) => ({ getType: () => 3, getFormula: () => `=B${r + 1}*2` })
  }
  const realm = vm.createContext({
    resolveSheet: () => ({ sheet: { getName: () => 'Budget' } }),
    normalizeFormula: s => s, sheetRange: () => range, sheetRangeName: () => 'A1:A150', readCellOut: () => 42,
    enumEq: (a, b) => a === b, css: { table: { CellContentType: { FORMULA: 3 } } },
    colLetterOf: () => 'A'
  })
  const start = source.indexOf('  sheet_read_range(p) {')
  const end = source.indexOf('\n  },', start) + 5
  const read = vm.runInContext(`({${source.slice(start, end)}}).sheet_read_range`, realm)
  const result = read({ range: 'A1:A150' })
  assert.equal(result.rows.length, 150)
  assert.equal(result.formulas.length, 150)
  assert.equal(result.formulas[149].cell, 'A150')
  assert.equal(result.formulas[149].formula, '=B150*2')
})
function method(name, realm) {
  const start = source.indexOf(`  ${name}(p) {`)
  return vm.runInContext(`({${source.slice(start, source.indexOf('\n  },', start) + 5)}})`, realm)[name]
}
function writerSetup(failAt = -1) {
  const writes = []
  const sheet = { isProtected: () => false, getName: () => 'Budget', getRows: () => ({ getCount: () => 100 }), getColumns: () => ({ getCount: () => 20 }),
    getCellByPosition: (c, r) => ({ setValue: v => { if (writes.length === failAt) throw new Error('protected'); writes.push([c,r,v]) }, setString: v => writes.push([c,r,v]) }) }
  const realm = vm.createContext({ resolveSheet: () => ({sheet}), sheetRange: () => ({getRangeAddress: () => ({StartColumn:0,StartRow:0})}),
    tableFail: error => ({success:false,error}), xModel: {}, lockModel: () => {}, unlockModel: () => {}, SHEET_NUMERIC_RE: /^\d+$/, sheetRangeName: () => 'A1', ctrl: {},
    readCellOut: () => '', colLetterOf: () => 'A' })
  return {writes, write:method('sheet_write_cells',realm)}
}
test('invalid later rows and oversized target fail before the first write', () => {
  for (const rows of [[[1], {amount:2}], [[1], [Infinity]], [[1], [{}]], Array.from({length:101},()=>[1])]) {
    const s=writerSetup();assert.equal(s.write({startCell:'A1',rows,inheritFormat:false}).success,false);assert.equal(s.writes.length,0)
  }
  for(const startCell of [undefined, '', 'A1:C9']) {const s=writerSetup();assert.equal(s.write({startCell,rows:[[1]],inheritFormat:false}).success,false);assert.equal(s.writes.length,0)}
})
test('runtime write failures preserve partial receipt and forbid blind batch retry', () => {
  const s=writerSetup(1);const r=s.write({startCell:'A1',rows:[[1,2]],inheritFormat:false})
  assert.equal(r.success,false);assert.equal(r.error,'SHEET_WRITE_PARTIAL');assert.equal(r.cellsWritten,1);assert.equal(r.retryable,false)
})
test('quoted sheet names and escaped quotes survive Excel formula normalization', () => {
  const start=source.indexOf('function normalizeFormula(')
  const normalize=vm.runInNewContext(source.slice(start,source.indexOf('// sheet_find_replace',start))+'; normalizeFormula')
  assert.equal(normalize(`=SUM('Cost, net!'!A1,"a,b!",'O''Brien, fees!'!B2)`), `=SUM('Cost, net!'.A1;"a,b!";'O''Brien, fees!'.B2)`)
})
test('chart title uses its property and column/bar directions match persisted Excel types', () => {
  for (const [chartType, vertical] of [['column',false],['bar',true]]) {
    const props={}, title={};const diagram={setPropertyValue:(k,v)=>props[k]=v}
    const sheet={isProtected:()=>false,getName:()=> 'S',getCharts:()=>({hasByName:()=>false,addNewByName:()=>{},getByName:()=>({getEmbeddedObject:()=>({createInstance:()=>diagram,setDiagram:()=>{},setPropertyValue:()=>{},getTitle:()=>({setPropertyValue:(k,v)=>title[k]=v})})})}),getCellByPosition:()=>({getPropertyValue:()=>({X:0,Y:0})})}
    const realm=vm.createContext({resolveSheet:()=>({sheet}),sheetRange:()=>({getRangeAddress:()=>({StartRow:0,EndColumn:1})}),sheetRangeName:()=> 'A1:B4',ptToMm100:n=>n,css:{awt:{Rectangle:class {constructor(v){Object.assign(this,v)}}}},tableFail:error=>({success:false,error}),errStr:e=>e.message})
    const r=method('sheet_add_chart',realm)({range:'A1:B4',chartType,title:'Revenue'})
    assert.equal(r.success,true);assert.equal(title.String,'Revenue');assert.equal(props.Vertical,vertical)
  }
})
test('data validation uses XSheetCondition methods, not ignored Formula1 properties', () => {
  const saved={};const validation={setPropertyValue:(k,v)=>{assert.ok(!['Operator','Formula1','Formula2'].includes(k));saved[k]=v},setOperator:v=>saved.op=v,setFormula1:v=>saved.f1=v,setFormula2:v=>saved.f2=v}
  const range={getPropertyValue:()=>validation,setPropertyValue:()=>{},getRangeAddress:()=>({})}
  const realm=vm.createContext({resolveSheet:()=>({sheet:{isProtected:()=>false}}),sheetRange:()=>range,sheetRangeName:()=> 'A1',normalizeFormula:s=>s,css:{sheet:{ValidationType:{WHOLE:1},ConditionOperator:{BETWEEN:1}}},tableFail:error=>({success:false,error}),errStr:e=>e.message})
  const r=method('sheet_set_data_validation',realm)({range:'A1',type:'wholeNumber',operator:'between',value1:'1',value2:'10'})
  assert.equal(r.success,true);assert.equal(saved.f1,'1');assert.equal(saved.f2,'10');assert.equal(saved.op,1)
})
test('imported lazy notes are read from their annotation shape and truncation is explicit', () => {
  const full='e'.repeat(600)
  const anno={getPosition:()=>({Column:0,Row:1}),getString:()=>'',getAnnotationShape:()=>({getString:()=>full}),getAuthor:()=> 'A',getDate:()=> 'D'}
  const realm=vm.createContext({resolveSheet:()=>({sheet:{getName:()=> 'S',getAnnotations:()=>({getCount:()=>1,getByIndex:()=>anno})}}),colLetterOf:()=> 'A',tableFail:error=>({success:false,error}),errStr:e=>e.message})
  const r=method('sheet_get_comments',realm)({});assert.equal(r.comments[0].text,'e'.repeat(500));assert.equal(r.comments[0].textLength,600);assert.equal(r.comments[0].textTruncated,true)
})
test('explicit invalid search range cannot silently widen to the used region', () => {
  const realm=vm.createContext({resolveSheet:()=>({sheet:{}}),sheetRange:()=>null,usedRangeAddress:()=>{throw new Error('must not widen')},tableFail:error=>({success:false,error}),errStr:e=>e.message})
  assert.equal(method('sheet_search',realm)({query:'A',range:'bad'}).error,'SHEET_INVALID_RANGE')
})
test('protected sheets reject destructive operations before any range or chart access', () => {
  for(const action of ['sheet_sort_range','sheet_format_cells','sheet_add_chart','sheet_find_replace','sheet_set_data_validation','sheet_edit_rows_cols']) {
    const realm=vm.createContext({resolveSheet:()=>({sheet:{isProtected:()=>true}}),tableFail:error=>({success:false,error})})
    assert.equal(method(action,realm)({}).error,'SHEET_PROTECTED_CELL',action)
  }
})
test('selection reveals its top left cell and reports the visible range', () => {
  const addr={StartRow:66,StartColumn:2},calls=[]
  const range={getRangeAddress:()=>addr,getCellByPosition:()=>({getString:()=> 'target'})}
  const realm=vm.createContext({resolveSheet:()=>({sheet:{getName:()=> 'S'}}),sheetRange:()=>range,sheetRangeName:a=>a===addr?'C67':'C67:Q95',ctrl:{select:()=>calls.push('select'),setFirstVisibleRow:r=>calls.push(r),setFirstVisibleColumn:c=>calls.push(c),getVisibleRange:()=>({})}})
  const r=method('sheet_select_range',realm)({range:'C67'})
  assert.deepEqual(calls,['select',66,2]);assert.equal(r.visibleRange,'C67:Q95')
})
