// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source=readFileSync(process.env.SHEET_WORKER_SOURCE || new URL('../../src/zetaoffice/public/office_thread.js',import.meta.url),'utf8')
const start=source.indexOf('function normalizeFormula(')
const normalize=vm.runInNewContext(source.slice(start,source.indexOf('// sheet_find_replace',start))+'; normalizeFormula')
test('Excel array columns, rows and function arguments retain distinct separators',()=>{
  assert.equal(normalize('=INDEX({1,2;3,4},2,1)'),'=INDEX({1;2|3;4};2;1)')
  assert.equal(normalize('=INDEX({1;2;3},2,1)'),'=INDEX({1|2|3};2;1)')
  assert.equal(normalize('=INDEX({1,2,3},1,2)'),'=INDEX({1;2;3};1;2)')
  assert.equal(normalize('=SUM({1,2;3,4},{5,6;7,8})'),'=SUM({1;2|3;4};{5;6|7;8})')
})
test('array punctuation inside escaped strings and quoted sheet names remains literal',()=>{
  assert.equal(normalize(`=INDEX({"a,b!;{}","say ""hi""";"c","d"},1,2)&'O''Brien,{!}'!A1`),`=INDEX({"a,b!;{}";"say ""hi"""|"c";"d"};1;2)&'O''Brien,{!}'.A1`)
  assert.equal(normalize('=SUM(1,2)+IF(TRUE,3,4)'),'=SUM(1;2)+IF(TRUE;3;4)')
})

test('native arrays are exposed as unambiguous Excel constants before editing',()=>{
  assert.equal(normalize('text {a;b|c}',true),'text {a;b|c}')
  for(const f of ['=INDEX({1,2;3,4},2,1)','=INDEX({1;2;3},2,1)','=INDEX({1,2,3},1,2)']) {
    const native=normalize(f)
    assert.equal(normalize(normalize(native,true)),native)
  }
  assert.equal(normalize('=INDEX({"a;|{}";"b"|"c";"d"};1;1)',true),'=INDEX({"a;|{}","b";"c","d"};1;1)')
})
