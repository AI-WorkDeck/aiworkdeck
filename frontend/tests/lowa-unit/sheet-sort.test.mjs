// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(process.env.SHEET_WORKER_SOURCE || new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
function setup({protectedSheet=false, endRow=3, fail=false, merged=false, expanded=false}={}) {
  const calls=[], range={getIsMerged:()=>merged,getRangeAddress:()=>({StartColumn:2,EndColumn:4,StartRow:0,EndRow:endRow}),getCellByPosition:(c,r)=>({value:r,c,r})}
  const sheet={isProtected:()=>protectedSheet,createCursorByRange:target=>{assert.equal(target,range);return {collapseToMergedArea:()=>{},getRangeAddress:()=>({...range.getRangeAddress(),StartColumn:expanded?1:2})}}}
  const realm=vm.createContext({resolveSheet:()=>({sheet}),sheetRange:()=>range,tableFail:error=>({success:false,error}),
    colIndexOf:value=>({C:2,D:3,E:4,B:1}[value]??-1),sheetRangeName:()=> 'C1:E4',colLetterOf:()=> 'D',readCellOut:cell=>cell.value,
    mkProp:(Name,Value)=>({Name,Value}),zetajs:{Any:function(type,value){this.type=type;this.value=value},type:{long:'long',unsigned_short:'ushort'}},
    context:{getServiceManager:()=>({createInstanceWithContext:()=>({executeDispatch:(...args)=>{calls.push(args);if(fail)throw new Error('native sort failed')}})})},
    ctrl:{setActiveSheet:target=>assert.equal(target,sheet),select:target=>assert.equal(target,range),getFrame:()=> 'frame'},errStr:e=>e.message})
  const start=source.indexOf('  sheet_sort_range(p) {'),end=source.indexOf('\n  },',start)+5
  return {calls,run:vm.runInContext(`({${source.slice(start,end)}}).sheet_sort_range`,realm)}
}
test('native sort dispatch uses absolute one-based field and preserves record formats',()=>{
  const s=setup();assert.equal(s.run({range:'C1:E4',byColumn:'D'}).success,true)
  assert.equal(s.calls.length,1);assert.equal(s.calls[0][1],'.uno:DataSort')
  const props=Object.fromEntries(s.calls[0][4].map(p=>[p.Name,p.Value]))
  assert.equal(props.Col1.value,4);assert.equal(props.Col1.type,'long')
  assert.equal(props.IncludeAttribs,true);assert.equal(props.IncludeComments,true);assert.equal(props.IncludeImages,true)
  assert.equal(props.HasHeader,true);assert.equal(props.ByRows,true);assert.equal(props.Ascending1,true)
  assert.equal(props.Col2.value,0);assert.equal(props.Col3.value,0);assert.equal(props.UserDefIndex.value,0)
})
test('descending without headers passes exact options to Calc',()=>{
  const s=setup();assert.equal(s.run({range:'C1:E4',byColumn:'D',ascending:false,hasHeader:false}).success,true)
  const props=Object.fromEntries(s.calls[0][4].map(p=>[p.Name,p.Value]));assert.equal(props.HasHeader,false);assert.equal(props.Ascending1,false)
})
test('invalid, protected and oversized ranges do not dispatch or rewrite cells',()=>{
  for(const [config,args] of [[{}, {byColumn:'B'}],[{protectedSheet:true},{}],[{endRow:5000},{}]]){
    const s=setup(config);assert.equal(s.run({range:'C1:E4',...args}).success,false);assert.equal(s.calls.length,0)
  }
})
test('native dispatch failure is not reported as sorted',()=>{
  const s=setup({fail:true});const result=s.run({range:'C1:E4',byColumn:'D'});assert.equal(result.success,false);assert.equal(result.error,'SHEET_SORT_FAILED')
})

test('one-row selection does not let native sorting expand the target',()=>{
  const s=setup({endRow:0});assert.equal(s.run({range:'C1:E1',byColumn:'D',hasHeader:false}).success,true);assert.equal(s.calls.length,0)
})

test('merged cells intersecting the target are rejected before dispatch',()=>{
  const s=setup({merged:true});const r=s.run({range:'C1:E4',byColumn:'D'})
  assert.equal(r.success,false);assert.equal(r.error,'SHEET_SORT_MERGED_RANGE');assert.equal(s.calls.length,0)
})

test('merged anchor outside the range is rejected when expansion crosses its boundary',()=>{
  const s=setup({expanded:true});const r=s.run({range:'C1:E4',byColumn:'D'})
  assert.equal(r.error,'SHEET_SORT_MERGED_RANGE');assert.equal(s.calls.length,0)
})
