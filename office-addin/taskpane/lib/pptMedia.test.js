// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {chartData,chartStyle,imageOptions,imageRectangle,addWpsChart,formatWpsChart,setWpsTransition} from './pptMedia.js'
const rect={slideNumber:1,left:-10,top:20,width:200,height:100}
const data={...rect,chartType:'column',categories:['A','B'],series:[{name:'Revenue',values:[2,3]}]}
test('media validates bounded rectangular data, seven charts, and pie/scatter restrictions',()=>{
  for(const type of ['column','bar','line','area','pie','doughnut'])assert.equal(typeof chartData({...data,chartType:type}),'number')
  assert.equal(chartData({...data,chartType:'scatter',categories:[1,2]}),-4169)
  for(const patch of [{width:0},{slideNumber:0},{chartType:'unknown'},{categories:[]},{series:[{name:'bad',values:[1]}]},{series:[{name:'bad',values:[1,Infinity]}]},{chartType:'scatter'},{chartType:'pie',series:[{name:'neg',values:[1,-1]}]}])assert.throws(()=>chartData({...data,...patch}))
})
test('image cover focal crop, contain geometry and bleed are precise',()=>{
  const cover=imageRectangle({...rect,fit:'cover',focalY:1},100,100);assert.equal(cover.sy,50);assert.equal(cover.sh,50);assert.equal(cover.left,-10)
  const contain=imageRectangle({...rect,fit:'contain'},100,100);assert.equal(contain.width,100);assert.equal(contain.left,40)
  assert.throws(()=>imageRectangle(rect,100000,100000));assert.throws(()=>imageOptions({...rect,base64:btoa('not image')}));assert.throws(()=>imageOptions({...rect,base64:btoa('\x89PNG\r\n\x1a\n'),fit:'mystery'}))
})
function chartFixture(){
  const items=[{Delete(){items.splice(0,1)}}];const coll={get Count(){return items.length},Item:i=>items[i-1],NewSeries(){const s={};items.push(s);return s}}
  const chart={SeriesCollection:()=>coll,ChartTitle:{}},shape={Id:9,Name:'Native chart',Chart:chart};let calls=0
  return {items,chart,shape,slide:{Shapes:{AddChart(){calls++;return shape}}},get calls(){return calls}}
}
test('WPS native chart uses only newly created chart series and returns exact identity',()=>{
  const f=chartFixture();const r=addWpsChart(f.slide,{...data,title:'Q'});assert.equal(r.shapeId,'9');assert.equal(f.items.length,1);assert.deepEqual(f.items[0].Values,[2,3]);assert.deepEqual(f.items[0].XValues,['A','B']);assert.equal(f.chart.ChartTitle.Text,'Q')
})
test('WPS invalid chart input does not create a shape and postcreate failure is partial',()=>{
  const f=chartFixture();assert.throws(()=>addWpsChart(f.slide,{...data,width:-1}));assert.equal(f.calls,0)
  f.chart.SeriesCollection=()=>({});assert.throws(()=>addWpsChart(f.slide,data),e=>e.partialResult.created&&e.partialResult.shapeId==='9'&&e.partialResult.retryable===false)
})
test('WPS chart format resolves all requested capabilities before changing background',()=>{
  let writes=0;const fill={Solid(){writes++},ForeColor:{}};const chart={ChartType:5,ChartArea:{Format:{Fill:fill}},PlotArea:{Format:{Fill:fill}}};const slide={Shapes:{Count:1,Item:()=>({Name:'x',HasChart:true,Chart:chart})}}
  assert.throws(()=>formatWpsChart(slide,{slideNumber:1,shapeName:'x',backgroundColor:'#123456',showGrid:true}));assert.equal(writes,0)
  assert.throws(()=>chartStyle({slideNumber:1,shapeName:'x',fontSize:NaN}))
})
test('WPS exact transitions require actual enums and duration and preserve advancement',()=>{
  const tr={EntryEffect:0,Duration:1,AdvanceOnTime:false,AdvanceTime:12};const slide={SlideShowTransition:tr}
  assert.throws(()=>setWpsTransition(slide,{slideNumber:1,effect:'fade'},{}));assert.equal(tr.EntryEffect,0)
  setWpsTransition(slide,{slideNumber:1,effect:'fade',durationSeconds:0.4},{ppEffectFade:999});assert.equal(tr.EntryEffect,999);assert.equal(tr.Duration,0.4);assert.equal(tr.AdvanceOnTime,false);assert.equal(tr.AdvanceTime,12)
  delete tr.Duration;assert.throws(()=>setWpsTransition(slide,{slideNumber:1,effect:'wipe'},{ppEffectWipeLeft:888}));assert.equal(tr.EntryEffect,999)
})
const source=readFileSync(new URL('./officeExecutor.js',import.meta.url),'utf8')
function imageHandler(){const start=source.indexOf('  async ppt_add_image(args) {'),end=source.indexOf('\n  async ppt_add_chart',start);return source.slice(start,end).replace(/,\s*$/,'')}
test('Office image z-order capability is checked before decoding or writes',async()=>{
  let decoded=0;const realm=vm.createContext({pptApiSupported:v=>v==='1.4',Office:{context:{requirements:{isSetSupported:()=>true}}},t:x=>x,preparePptImage:()=>{decoded++}})
  const fn=vm.runInContext(`({${imageHandler()}}).ppt_add_image`,realm);await assert.rejects(fn({...rect,sendToBack:true}));assert.equal(decoded,0)
})
test('Office chart and transition refusal does not invoke host run',async()=>{
  const realm=vm.createContext({t:x=>x});for(const name of ['ppt_add_chart','ppt_format_chart','ppt_set_transition']){const code=source.match(new RegExp(`async ${name}\\(\\) \\{[^}]+\\}`))[0];const fn=vm.runInContext(`({${code}}).${name}`,realm);await assert.rejects(fn())}
})
test('WPS silently ignored exact duration must return uncertain failure',()=>{
  const tr={EntryEffect:0,get Duration(){return 1},set Duration(v){}};
  assert.throws(()=>setWpsTransition({SlideShowTransition:tr},{slideNumber:1,effect:'fade',durationSeconds:.4},{ppEffectFade:99}),e=>e.partialResult.outcomeUnknown&&e.partialResult.retryable===false)
})
test('WPS chart format updates explicit title legend and axis text, not only chart defaults',()=>{
  const axis={TickLabels:{Font:{}},HasTitle:true,AxisTitle:{Font:{}}};const chart={ChartType:51,ChartArea:{Font:{}},HasTitle:true,ChartTitle:{Font:{}},HasLegend:true,Legend:{Font:{}},Axes:()=>axis};
  formatWpsChart({Shapes:{Count:1,Item:()=>({Name:'x',HasChart:true,Chart:chart})}},{slideNumber:1,shapeName:'x',textColor:'#123456',fontSize:18});
  for(const font of [chart.ChartArea.Font,chart.ChartTitle.Font,chart.Legend.Font,axis.TickLabels.Font,axis.AxisTitle.Font])assert.equal(font.Size,18)
})
test('chart palette cycles over every series and new legend receives explicit fonts',()=>{
  const members=Array.from({length:3},()=>({Format:{Fill:{Solid(){},ForeColor:{}}}}));
  const c={ChartType:51,HasLegend:false,Legend:{Font:{}},ChartArea:{Font:{}},Axes:()=>({TickLabels:{Font:{}}}),SeriesCollection:()=>({Count:3,Item:i=>members[i-1]})};
  const slide={Shapes:{Count:1,Item:()=>({Name:'x',HasChart:true,Chart:c})}};
  formatWpsChart(slide,{slideNumber:1,shapeName:'x',seriesColors:['#FF0000'],showLegend:true,fontSize:18});
  assert.equal(c.Legend.Font.Size,18);for(const s of members)assert.equal(s.Format.Fill.ForeColor.RGB,255)
});
test('empty chart style rejects without claiming an update',()=>{assert.throws(()=>chartStyle({slideNumber:1,shapeName:'x'}))})
test('Office image postcreate z-order failure preserves confirmed shape identity',async()=>{
  const added={id:'image-9',type:'Image',setZOrder(){throw Error('zorder failed')}};
  const shapeItems=[];const slide={id:'s1',shapes:{items:shapeItems,load(){}}};
  const context={presentation:{slides:{items:[slide],load(){}},setSelectedSlides(){},getSelectedSlides:()=>({items:[slide],load(){}})},sync:async()=>{}};
  const Office={CoercionType:{Image:'image'},AsyncResultStatus:{Succeeded:'ok'},context:{requirements:{isSetSupported:()=>true},document:{url:'qa.pptx',setSelectedDataAsync(bytes,options,cb){shapeItems.push(added);cb({status:'ok'})}}}};
  const realm=vm.createContext({pptApiSupported:()=>true,Office,t:x=>x,preparePptImage:async()=>({...rect,base64:'data',fit:'contain'}),PowerPoint:{run:fn=>fn(context)},getSlideOrThrow:()=>slide});
  const fn=vm.runInContext(`({${imageHandler()}}).ppt_add_image`,realm);
  await assert.rejects(fn({...rect,sendToBack:true}),e=>e.partialResult.shapeId==='image-9'&&e.partialResult.created===true&&e.partialResult.retryable===false)
})
