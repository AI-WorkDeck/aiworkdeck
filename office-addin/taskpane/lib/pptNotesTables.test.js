// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { WPS_WPP_HANDLERS as H } from './wpsWppHandlers.js'
import { pptTarget, pptExpected, pptParagraphFormat, pptTableStyle, officePptShape } from './pptPrecision.js'
function collection(items) { return { Count: items.length, Item: i => items[i - 1] } }
function wpsFixture() {
  const note={Text:'complete notes'}, footer={Text:'page number'}
  const noteShapes=[{PlaceholderFormat:{Type:13},TextFrame:{TextRange:footer}},{PlaceholderFormat:{Type:2},TextFrame:{TextRange:note}}]
  const cells=Array.from({length:2},()=>Array.from({length:2},()=>({Shape:{Fill:{Solid(){},ForeColor:{}},TextFrame:{TextRange:{Text:'keep',Font:{Color:{}},ParagraphFormat:{}}}},Borders:collection(Array.from({length:4},()=>({ForeColor:{}})))})))
  const table={Rows:collection([{Height:30},{Height:40}]),Columns:collection([{Width:100},{Width:200}]),Cell:(r,c)=>cells[r-1][c-1]}
  const slide={NotesPage:{Shapes:{Placeholders:collection(noteShapes)}},Shapes:collection([{Id:8,Type:19,HasTable:-1,Table:table}])}
  globalThis.wps={WppApplication:()=>({ActivePresentation:{Slides:collection([slide])}})}
  return {note,footer,noteShapes,cells,table,slide}
}
test('WPS notes target body placeholder, preserve page number and full long text',async()=>{
  const f=wpsFixture();f.note.Text='n'.repeat(900)
  const read=await H.ppt_read_notes({});assert.equal(read.notes[0].text.length,900);assert.equal(read.notes[0].textTruncated,false)
  await assert.rejects(H.ppt_write_notes({slideNumber:1,text:'bad',expectedText:'stale'}));assert.equal(f.note.Text.length,900)
  await H.ppt_write_notes({slideNumber:1,text:'',expectedText:'n'.repeat(900)});assert.equal(f.note.Text,'');assert.equal(f.footer.Text,'page number')
})
test('missing or ambiguous notes body rejects without overwriting another placeholder',async()=>{
  const f=wpsFixture();f.noteShapes[1].PlaceholderFormat.Type=13
  await assert.rejects(H.ppt_write_notes({slideNumber:1,text:'bad'}));assert.equal(f.footer.Text,'page number')
})
test('WPS table style changes selected cells and dimensions without rewriting text',async()=>{
  const f=wpsFixture();const r=await H.ppt_table_set_style({slideNumber:1,shapeId:'8',row:1,col:0,fontSize:18,bold:true,fillColor:'#FF0000',borderWidthPt:1,rowHeightsPt:[25,35],columnWidthsPt:[90,110]})
  assert.equal(f.cells[1][0].Shape.TextFrame.TextRange.Font.Size,18);assert.equal(f.cells[0][0].Shape.TextFrame.TextRange.Font.Size,undefined)
  assert.equal(f.cells[1][0].Shape.Fill.ForeColor.RGB,255);assert.equal(f.cells[1][0].Shape.TextFrame.TextRange.Text,'keep')
  assert.deepEqual(r.rowHeightsPt,[25,35]);assert.deepEqual(r.columnWidthsPt,[90,110])
})
test('WPS malformed later style option rejects before first cell write',async()=>{
  const f=wpsFixture();await assert.rejects(H.ppt_table_set_style({slideNumber:1,shapeId:'8',fillColor:'#FF0000',rowHeightsPt:[30,-1]}))
  assert.equal(f.cells[0][0].Shape.Fill.ForeColor.RGB,undefined)
})
test('WPS runtime partial table failure preserves non-retryable receipt',async()=>{
  const f=wpsFixture();Object.defineProperty(f.cells[1][0].Shape.Fill.ForeColor,'RGB',{set(){throw new Error('host failure')}})
  await assert.rejects(H.ppt_table_set_style({slideNumber:1,shapeId:'8',fillColor:'#FF0000'}),e=>e.partialResult.operationsApplied===2 && e.partialResult.retryable===false)
})
const source=readFileSync(new URL('./officeExecutor.js',import.meta.url),'utf8')
function officeFixture(supported=true, size=2) {
  const cells=Array.from({length:size},()=>Array.from({length:size},()=>({isNullObject:false,rowCount:1,columnCount:1,load(){},font:{},fill:{setSolidColor(v){this.color=v},clear(){this.color=null}},borders:{top:{},bottom:{},left:{},right:{}}})))
  const rows=[{height:30,currentHeight:30,load(){}},{height:40,currentHeight:40,load(){}}],columns=[{width:100,load(){}},{width:200,load(){}}]
  const table={rowCount:size,columnCount:size,load(){},getCellOrNullObject:(r,c)=>cells[r][c],rows:{getItemAt:i=>rows[i]},columns:{getItemAt:i=>columns[i]}}
  const shape={id:'8',getTable:()=>table},context={presentation:{slides:{items:[{shapes:{items:[shape],load(){}}}],load(){}}},sync:async()=>{rows.forEach(r=>r.currentHeight=r.height)}}
  const realm=vm.createContext({pptTarget,pptTableStyle,officePptShape,t:key=>key,pptApiSupported:v=>supported&&v==='1.9',PowerPoint:{run:fn=>fn(context)}})
  const start=source.indexOf('  async ppt_table_set_style(args) {'),end=source.indexOf('\n  },',start)+5
  return {run:vm.runInContext(`({${source.slice(start,end)}}).ppt_table_set_style`,realm),cells,rows,columns,context}
}
test('Office 1.9 updates existing table cells and reports real row heights',async()=>{
  const f=officeFixture();const result=await f.run({slideNumber:1,shapeId:'8',row:1,col:0,fontName:'Arial',fillColor:'#FF0000',alignment:'center',headerBold:true,headerFill:'none',borderWidthPt:2,rowHeightsPt:[25,35]})
  assert.equal(f.cells[1][0].font.name,'Arial');assert.equal(f.cells[1][0].horizontalAlignment,'Center');assert.equal(f.cells[1][1].font.name,undefined)
  assert.equal(f.cells[0][0].font.bold,true);assert.equal(f.cells[0][0].fill.color,null);assert.equal(f.cells[1][0].borders.top.weight,2)
  assert.equal(result.rowHeightsPt[1],35)
})
test('Office older versions, null cells and invalid options refuse before mutation',async()=>{
  await assert.rejects(officeFixture(false).run({slideNumber:1,shapeId:'8',fontSize:18}))
  const f=officeFixture();f.cells[1][1].isNullObject=true
  await assert.rejects(f.run({slideNumber:1,shapeId:'8',fontSize:18}));assert.equal(f.cells[0][0].font.size,undefined)
  await assert.rejects(officeFixture().run({slideNumber:1,shapeId:'8',fontSize:18,columnWidthsPt:[0]}))
})

test('WPS formatting targets one exact shape and rejects stale full text', async () => {
  const f = wpsFixture(), a = { Bold: 0 }, b = { Bold: 0 }
  const textShape = (Id, font) => ({ Id, HasTextFrame: -1, TextFrame: { HasText: -1, TextRange: { Text: 'same text', Characters: () => ({ Font: font }) } } })
  f.slide.Shapes = collection([textShape(1, a), textShape(2, b)])
  await assert.rejects(H.ppt_format_text({ slideNumber: 1, shapeId: '2', expectedText: 'stale', searchText: 'same', bold: true }))
  assert.equal(b.Bold, 0)
  await H.ppt_format_text({ slideNumber: 1, shapeId: '2', expectedText: 'same text', searchText: 'same', bold: true })
  assert.equal(a.Bold, 0); assert.equal(b.Bold, -1)
})

test('Office formatting uses the exact target and refuses stale content before setting a font', async () => {
  const f = officeFixture(), font = {}
  const frame = { isNullObject: false, hasText: true, load() {}, textRange: { text: 'same text', load() {}, getSubstring: () => ({ font }) } }
  f.context.presentation.slides.items[0].shapes.items[0].getTextFrameOrNullObject = () => frame
  const realm = vm.createContext({ pptTarget, pptExpected, pptParagraphFormat, officePptShape, t: key => key,
    requirePptTextApi() {}, applyProps: Object.assign,
    findAllNormalized: (text, search) => [{ start: text.indexOf(search), end: text.indexOf(search) + search.length }],
    PowerPoint: { run: fn => fn(f.context) } })
  const start = source.indexOf('  async ppt_format_text(args) {'), end = source.indexOf('\n  },', start) + 5
  const run = vm.runInContext(`({${source.slice(start,end)}}).ppt_format_text`, realm)
  await assert.rejects(run({ slideNumber: 1, shapeId: '8', expectedText: 'stale', searchText: 'same', bold: true }))
  assert.equal(font.bold, undefined)
  await run({ slideNumber: 1, shapeId: '8', expectedText: 'same text', bold: true })
  assert.equal(font.bold, true)
})

test('paragraph formatting preflight refuses unsupported Office spacing and malformed WPS values', () => {
  assert.throws(() => pptParagraphFormat({ alignment: 'left', spaceBeforePt: 6 }, 'office'))
  assert.throws(() => pptParagraphFormat({ lineSpacingMode: 'multiple', lineSpacingValue: 0 }, 'wps'))
  assert.throws(() => pptParagraphFormat({ firstLineIndentPt: 12 }, 'wps'))
  assert.deepEqual(pptParagraphFormat({ alignment: 'justify' }, 'office'), { alignment: 'justify' })
})

test('WPS paragraph points and line multiples use their native unit flags', async () => {
  const f = wpsFixture(), paragraph = {}, font = {}
  f.slide.Shapes = collection([{ Id: 1, HasTextFrame: -1, TextFrame: { HasText: -1,
    TextRange: { Text: 'same', Characters: () => ({ Font: font, ParagraphFormat: paragraph }) } } }])
  const args = { slideNumber: 1, shapeId: '1', searchText: 'same', bold: true,
    paragraphFormat: { alignment: 'center', spaceBeforePt: 6, spaceAfterLines: 2, lineSpacingMode: 'multiple', lineSpacingValue: 1.5 } }
  await H.ppt_format_text(args)
  assert.equal(paragraph.Alignment, 2); assert.equal(paragraph.SpaceBefore, 6); assert.equal(paragraph.LineRuleBefore, 0)
  assert.equal(paragraph.SpaceAfter, 2); assert.equal(paragraph.LineRuleAfter, -1)
  assert.equal(paragraph.SpaceWithin, 1.5); assert.equal(paragraph.LineRuleWithin, -1)
  font.Bold = 0
  await assert.rejects(H.ppt_format_text({ ...args, paragraphFormat: { spaceBeforePt: -1 } }))
  assert.equal(font.Bold, 0)
})

test('Office table border width does not write the host-inconsistent transparency property', async () => {
  const f = officeFixture()
  for (const edge of Object.values(f.cells[1][1].borders)) Object.defineProperty(edge, 'transparency', {
    set() { throw new Error('Native Mac saved alpha=0 when assigning documented opaque transparency=0') }
  })
  await f.run({ slideNumber: 1, shapeId: '8', row: 1, col: 1, borderColor: '#123456', borderWidthPt: 1 })
  for (const edge of Object.values(f.cells[1][1].borders)) {
    assert.equal(edge.color, '#123456'); assert.equal(edge.weight, 1)
  }
  await f.run({ slideNumber: 1, shapeId: '8', row: 1, col: 1, borderWidthPt: 0 })
  for (const edge of Object.values(f.cells[1][1].borders)) assert.equal(edge.weight, 0)
})

test('Office table borders mirror only the same shared neighbor edge, including zero width', async () => {
  const f=officeFixture();
  await f.run({slideNumber:1,shapeId:'8',row:1,col:1,borderColor:'#123456',borderWidthPt:1});
  assert.equal(f.cells[0][1].borders.bottom.color,'#123456');
  assert.equal(f.cells[1][0].borders.right.weight,1);
  assert.deepEqual(f.cells[0][0].borders.top,{});
  assert.deepEqual(f.cells[0][1].font,{});
  assert.deepEqual(f.cells[0][1].borders.top,{});
  await f.run({slideNumber:1,shapeId:'8',row:1,col:1,borderWidthPt:0});
  assert.equal(f.cells[0][1].borders.bottom.weight,0);
  assert.equal(f.cells[1][0].borders.right.weight,0);
});
test('Office shared borders reject merged neighbor before any text style or border write', async () => {
  const f=officeFixture();f.cells[0][1].rowCount=2;
  await assert.rejects(f.run({slideNumber:1,shapeId:'8',row:1,col:1,bold:true,borderWidthPt:1}));
  assert.equal(f.cells[1][1].font.bold,undefined);
  assert.deepEqual(f.cells[1][1].borders.top,{});
});
test('Office top-left table borders mirror right and bottom, without out-of-range access', async () => {
  const f=officeFixture();
  await f.run({slideNumber:1,shapeId:'8',row:0,col:0,borderWidthPt:2});
  assert.equal(f.cells[0][1].borders.left.weight,2);
  assert.equal(f.cells[1][0].borders.top.weight,2);
});
test('Office merged header-only cell does not expand border span guard', async () => {
  const f=officeFixture(true,3);f.cells[0][0].columnCount=2;
  await f.run({slideNumber:1,shapeId:'8',row:2,col:2,borderWidthPt:1,headerBold:true});
  assert.equal(f.cells[0][0].font.bold,true);
  assert.equal(f.cells[2][2].borders.top.weight,1);
});
