// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
const source=readFileSync(new URL('../src/components/EditorToolbar.vue',import.meta.url),'utf8')
const method=(name,next)=>Function('return ({'+source.slice(source.indexOf('    async '+name+'('),source.indexOf('    '+next+'(',source.indexOf('    async '+name+'(')))+'})')()[name]
const runCalcOp=method('runCalcOp','toggleCalcWrap')
const submitCalcFormula=method('submitCalcFormula','cancelCalcFormula')
const codes=['PROTECTED_CELL','INVALID_RANGE','INVALID_START_CELL','INVALID_ROWS','RANGE_OUT_OF_BOUNDS','RANGE_CHECK_FAILED','WRITE_PARTIAL','CHART_PARTIAL','SORT_FAILED','SORT_MERGED_RANGE'].map(c=>'SHEET_'+c)
const root=new URL('../src/locales/',import.meta.url)
for(const locale of readdirSync(root).filter(n=>n.includes('-')))test(`${locale}: toolbar displays localized sheet errors and preserves failure state`,async()=>{
  const {default:editor}=await import(new URL(locale+'/editor.js',root))
  for(const code of codes){
    assert.ok(editor.sheetErrors[code]);assert.notEqual(editor.sheetErrors[code],code)
    const ctx={menu:'calc',calcErr:'',call:async()=>({success:false,error:code,message:code}),$t:key=>key.startsWith('editor.sheetErrors.')?editor.sheetErrors[key.slice('editor.sheetErrors.'.length)]:key,after:()=>assert.fail('failure must not emit success')}
    assert.equal(await runCalcOp.call(ctx,'sheet_write_cells',{}),null)
    assert.equal(ctx.calcErr,editor.sheetErrors[code])
  }
})
test('formula bar uses the same localized failure path without clearing the entered formula',async()=>{
  let focused=0
  const ctx={calcFormulaInput:'=SUM(A1:A2)',calcState:{address:'B1'},calcFormulaFocused:true,menu:'calc',submittedInputValue:(e,k,value)=>value,call:async()=>({success:false,errorCode:'SHEET_PROTECTED_CELL',message:'SHEET_PROTECTED_CELL'}),$t:key=>'localized:'+key,focusEditorAfterSubmit:()=>focused++}
  ctx.runCalcOp=(...args)=>runCalcOp.call(ctx,...args)
  assert.equal(await submitCalcFormula.call(ctx),null)
  assert.equal(ctx.calcErr,'localized:editor.sheetErrors.SHEET_PROTECTED_CELL')
  assert.equal(ctx.calcFormulaInput,'=SUM(A1:A2)');assert.equal(focused,1)
})
test('non-coded host messages and generic failure still have a fallback',async()=>{
  for(const result of [{success:false,message:'Host explanation'},null]){
    const ctx={menu:'calc',call:async()=>result,$t:key=>key}
    await runCalcOp.call(ctx,'sheet_write_cells',{})
    assert.equal(ctx.calcErr,result?'Host explanation':'editor.toolbar.opFailed')
  }
})
