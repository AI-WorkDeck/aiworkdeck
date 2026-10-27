// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSemanticWritingHost } from '../../src/composables/semanticWritingHost.js'
function fixture() {
  const calls=[], messages=[]
  const state={ revision:7, selection:'', text:'合成案卷正文', contextRevision:7, sectionTitle:'正文', paragraphIndex:0, before:'原文', after:'后文', scopeKnown:true, sectionPath:[], scopeHeadings:[] }
  const api={ settings:async()=>({stance:'收购方',cutoffDate:'2026-09-15',files:[]}), saveSettings:async(p,data)=>data,
    suggest:async(p,data)=>{calls.push(['suggest',p,data]);return {id:'j1',status:'READY',advice:[{text:'真实服务端候选'}]}},
    get:async()=>({id:'j1',status:'READY'}),cancel:async(p,id)=>{calls.push(['cancel',p,id]);return {id,status:'CANCELLED'}},
    accept:async(p,id,data)=>{calls.push(['accept',p,id,data]);return {text:'真实服务端候选',revision:'7',selection:state.selection}} }
  const execute=async(action,params)=>{calls.push([action,params]);
    if(action==='capture_writing_context')return {success:true,available:true,token:'t7',revision:state.contextRevision,before:state.before,after:state.after,selectedText:state.selection,hasSelection:!!state.selection,sectionTitle:state.sectionTitle,paragraphIndex:state.paragraphIndex,scopeKnown:state.scopeKnown,sectionPath:state.sectionPath,scopeHeadings:state.scopeHeadings}
    if(action==='get_document_text'){await state.onRead?.();return {success:true,revision:state.revision,paragraphs:state.paragraphs || [{index:0,text:state.text}]}}
    if(action==='get_review_context')return {success:true,revision:state.revision}
    if(action==='accept_writing_suggestion'){state.onApply?.();return {success:true,inserted:true,revision:8}}
  }
  const host=createSemanticWritingHost({projectId:11,fileId:22,title:'合成尽调报告',writable:true,execute,send:m=>messages.push(m),api})
  host.bindSession('s1')
  return {host,api,calls,messages,state,generate:(data={})=>host.perform('semantic-generate',{mode:'sentence',documentType:'diligence',...data})}
}
test('generation captures real context and keeps source count and document scope bounded',async()=>{
  const f=fixture();await f.generate({sourceFileIds:[1,2]});const req=f.calls.find(c=>c[0]==='suggest')
  assert.equal(req[1],11);assert.equal(req[2].context.fileId,22);assert.equal(req[2].context.revision,'7');assert.equal(req[2].context.documentText,'合成案卷正文');assert.deepEqual(req[2].context.sourceFileIds,[1,2])
})
test('IME composition prevents generation before capture',async()=>{const f=fixture();await assert.rejects(f.generate({composing:true}));assert.equal(f.calls.length,0)})
test('non-rewrite cannot overwrite selected text',async()=>{const f=fixture();f.state.selection='保留原选区';await assert.rejects(f.generate());assert.equal(f.calls.some(c=>c[0]==='suggest'),false)})
test('rewrite requires an actual selected range',async()=>{const f=fixture();await assert.rejects(f.generate({mode:'rewrite'}));assert.equal(f.calls.some(c=>c[0]==='suggest'),false)})
test('snapshot revision mismatch never sends mixed document context',async()=>{const f=fixture();f.state.revision=8;await assert.rejects(f.generate());assert.equal(f.calls.some(c=>c[0]==='suggest'),false)})
test('more than four sources is rejected rather than silently changing scope',async()=>{const f=fixture();await assert.rejects(f.generate({sourceFileIds:[1,2,3,4,5]}));assert.equal(f.calls.some(c=>c[0]==='suggest'),false)})
test('accept uses server text and engine token, not guest supplied text',async()=>{const f=fixture();await f.generate();await f.host.perform('semantic-accept',{index:0,text:'伪造内容'});const write=f.calls.find(c=>c[0]==='accept_writing_suggestion');assert.equal(write[1].text,'真实服务端候选');assert.equal(write[1].token,'t7');assert.equal(write[1].expectedSelection,'')})
test('changed document cannot accept stale suggestion or call accept API',async()=>{const f=fixture();await f.generate();f.state.revision=8;await assert.rejects(f.host.perform('semantic-accept',{index:0}));assert.equal(f.calls.some(c=>c[0]==='accept'),false)})
test('edited document cancels in-flight job and publishes stale state',async()=>{const f=fixture();await f.generate();f.host.modified();await new Promise(r=>setTimeout(r,0));assert.ok(f.calls.some(c=>c[0]==='cancel'));assert.ok(f.messages.some(m=>m.config?.semantic?.state==='STALE'));await assert.rejects(f.host.perform('semantic-accept',{index:0}))})
test('late generation response is cancelled after document edit',async()=>{const f=fixture();let resolve;f.api.suggest=()=>new Promise(r=>resolve=r);const work=f.generate();await new Promise(r=>setTimeout(r,0));f.host.modified();resolve({id:'late',status:'RUNNING'});await assert.rejects(work);assert.ok(f.calls.some(c=>c[0]==='cancel'&&c[2]==='late'))})
test('engine rejection never reports applied success',async()=>{const f=fixture();await f.generate();f.api.accept=async()=>({text:'候选',revision:'8',selection:''});await assert.rejects(f.host.perform('semantic-accept',{index:0}));assert.equal(f.calls.some(c=>c[0]==='accept_writing_suggestion'),false)})
test('large body is capped with explicit notice',async()=>{const f=fixture();f.state.text='字'.repeat(17000);const r=await f.generate();assert.equal(f.calls.find(c=>c[0]==='suggest')[2].context.documentText.length,16000);assert.ok(r.notices.some(s=>s.includes('16000')))})
test('own insertion modified notification does not cancel accepted state',async()=>{const f=fixture();await f.generate();f.messages.length=0;f.state.onApply=()=>f.host.modified();const r=await f.host.perform('semantic-accept',{index:0});assert.equal(r.applied,true);assert.equal(f.messages.some(m=>m.config?.semantic?.state==='STALE'),false)})
test('typing during backend acceptance prevents any engine write',async()=>{const f=fixture();await f.generate();let resolve;f.api.accept=()=>new Promise(r=>resolve=r);const work=f.host.perform('semantic-accept',{index:0});await new Promise(r=>setTimeout(r,0));f.host.modified();resolve({text:'过期文本',revision:'7',selection:''});await assert.rejects(work);assert.equal(f.calls.some(c=>c[0]==='accept_writing_suggestion'),false)})
test('destroy suppresses late suggestion and cancels server work',async()=>{const f=fixture();let resolve;f.api.suggest=()=>new Promise(r=>resolve=r);const work=f.generate();await new Promise(r=>setTimeout(r,0));f.host.destroy();resolve({id:'closed',status:'RUNNING'});await assert.rejects(work);assert.ok(f.calls.some(c=>c[0]==='cancel'&&c[2]==='closed'))})
test('settings omit active document from optional project sources',async()=>{const f=fixture();f.api.settings=async()=>({files:[{id:22,name:'当前文书'},{id:23,name:'参考材料'}]});const r=await f.host.perform('semantic-settings');assert.deepEqual(r.files,[{id:23,name:'参考材料'}])})
test('AI generation uses AI revision author while local fields keep normal authorship',async()=>{for(const mode of ['sentence','local']){const f=fixture();await f.generate({mode});await f.host.perform('semantic-accept',{index:0});assert.equal(f.calls.find(c=>c[0]==='accept_writing_suggestion')[1].__agent,mode!=='local')}})
test('late modified notification after acceptance cannot overwrite success with stale',async()=>{const f=fixture();await f.generate();await f.host.perform('semantic-accept',{index:0});f.messages.length=0;f.host.modified();assert.equal(f.messages.some(m=>m.config?.semantic?.state==='STALE'),false)})
test('saving settings invalidates existing suggestions and blocks generation until saved',async()=>{const f=fixture();await f.generate();let resolve;f.api.saveSettings=()=>new Promise(r=>resolve=r);const save=f.host.perform('semantic-save-settings',{stance:'投资方'});await assert.rejects(f.generate(),/保存/);await assert.rejects(f.host.perform('semantic-accept',{index:0}));resolve({stance:'投资方'});await save;await f.generate();assert.equal(f.calls.filter(c=>c[0]==='suggest').length,2)})

test('section is passed only when the captured paragraph is in the supplied body scope',async()=>{const f=fixture();f.state.sectionTitle='附件一 / 第一条';await f.generate();assert.equal(f.calls.find(c=>c[0]==='suggest')[2].context.section,'附件一 / 第一条');const g=fixture();g.state.paragraphIndex=15;const result=await g.generate();assert.equal(g.calls.find(c=>c[0]==='suggest')[2].context.section,'');assert.ok(result.notices.some(s=>s.includes('当前位置')))})
test('document facts are read through final-text agent view like the semantic snapshot',async()=>{const f=fixture();await f.generate();assert.equal(f.calls.find(c=>c[0]==='get_document_text')[1].__agent,true)})

function automaticFixture() {
  const f=fixture()
  f.state.before='这是一份仅用于自动补全回归的合成工作报告，当前已经完成'
  f.state.after='。'
  f.state.text=f.state.before+f.state.after
  f.host.setAutomaticEnabled(true)
  f.auto=(data={})=>f.host.perform('semantic-auto-generate',data)
  return f
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
test('automatic is opt-in at host and disabled requests never read the document',async()=>{
  const f=fixture();await assert.rejects(f.host.perform('semantic-auto-generate'),/关闭/);assert.equal(f.calls.length,0)
})
test('automatic uses radius 200 and a revision-matched bounded paragraph window',async()=>{
  const f=automaticFixture();f.state.text='合成上下文'.repeat(900);f.state.before=f.state.text.slice(-200)
  const result=await f.auto();const req=f.calls.find(c=>c[0]==='suggest')[2]
  assert.equal(req.mode,'autocomplete');assert.equal(req.context.before.length,200)
  assert.equal(req.context.documentText,f.state.text);assert.equal(req.context.section,'正文')
  assert.equal(req.context.fileId,22);assert.equal(req.context.revision,'7')
  assert.deepEqual(f.calls.find(c=>c[0]==='capture_writing_context')[1],{radius:200})
  assert.deepEqual(f.calls.find(c=>c[0]==='get_document_text')[1],{startParagraph:0,maxParagraphs:7,__agent:true})
  assert.equal(result.view.advice.length,1)
})
test('automatic is silent for short text, selections, unknown scope, composition and content after cursor',async()=>{
  for(const change of [{before:'只有几个字'}, {before:'字 '.repeat(19)}, {selection:'选区'}, {scopeKnown:false}, {after:'后面还有正文'}]) {
    const f=automaticFixture();Object.assign(f.state,change)
    assert.equal((await f.auto()).view.status,'EMPTY');assert.equal(f.calls.some(c=>c[0]==='suggest'),false)
  }
  const f=automaticFixture();assert.equal((await f.auto({composing:true})).view.status,'EMPTY');assert.equal(f.calls.length,0)
})
test('automatic reuses only sources deliberately selected in explicit generation',async()=>{
  const f=automaticFixture();await f.generate({sourceFileIds:[2,3]});await f.host.perform('semantic-cancel')
  await f.auto();const req=f.calls.filter(c=>c[0]==='suggest').at(-1)[2]
  assert.deepEqual(req.context.sourceFileIds,[2,3]);assert.equal(req.context.documentType,'diligence')
})
test('automatic never cancels or captures over an active explicit suggestion',async()=>{
  const f=automaticFixture();await f.generate();const prior=f.calls.length
  assert.equal((await f.auto()).view.status,'EMPTY');assert.equal(f.calls.length,prior)
  await f.host.perform('semantic-auto-cancel');await f.host.perform('semantic-accept',{index:0})
  assert.equal(f.calls.some(c=>c[0]==='cancel'),false)
})
test('automatic cannot steal snapshot while explicit generation is in flight',async()=>{
  const f=automaticFixture();let resolve;f.api.suggest=()=>new Promise(r=>resolve=r)
  const explicit=f.generate();await tick();const prior=f.calls.length
  assert.equal((await f.auto()).view.status,'EMPTY');assert.equal(f.calls.length,prior)
  resolve({id:'explicit',status:'RUNNING'});await explicit
})
test('explicit generation cancels an automatic job whose response arrives late',async()=>{
  const f=automaticFixture();const suggest=f.api.suggest;let resolve
  f.api.suggest=()=>new Promise(r=>resolve=r);const pending=f.auto();await tick()
  f.api.suggest=suggest;await f.generate();resolve({id:'late-auto',status:'READY',advice:[{text:'迟到'}]})
  await assert.rejects(pending);assert.ok(f.calls.some(c=>c[0]==='cancel'&&c[2]==='late-auto'))
  await f.host.perform('semantic-accept',{index:0})
})
test('disabling, hiding, editing and disposing cancel in-flight automatic responses even after reenable',async()=>{
  for(const stop of [f=>{f.host.setAutomaticEnabled(false);f.host.setAutomaticEnabled(true)},f=>{f.host.setActive(false);f.host.setActive(true)},f=>f.host.modified(),f=>f.host.destroy()]) {
    const f=automaticFixture();let resolve;f.api.suggest=()=>new Promise(r=>resolve=r)
    const pending=f.auto();await tick();stop(f);resolve({id:'late',status:'RUNNING'})
    await assert.rejects(pending);assert.ok(f.calls.some(c=>c[0]==='cancel'&&c[2]==='late'))
  }
})
test('automatic exposes only first checked advice, never running output or malformed ready text',async()=>{
  for(const [view,status,count] of [
    [{id:'a',status:'READY',advice:[{text:'第一条'},{text:'第二条'}]},'READY',1],
    [{id:'a',status:'RUNNING',advice:[{text:'未校验'}]},'RUNNING',0],
    [{id:'a',status:'READY',advice:[{text:'  '},{text:'另一条'}]},'EMPTY',0],
    [{id:'a',status:'READY',advice:[{text:'坏\u0000文本'}]},'EMPTY',0]
  ]) {
    const f=automaticFixture();f.api.suggest=async()=>view;const result=await f.auto()
    assert.equal(result.view.status,status);assert.equal(result.view.advice.length,count)
  }
})
test('automatic polling keeps its lane, trims choices and rejects results after disable',async()=>{
  const f=automaticFixture();f.api.suggest=async()=>({id:'auto',status:'RUNNING'});await f.auto()
  f.api.get=async()=>({id:'auto',status:'READY',advice:[{text:'候选'},{text:'额外候选'}]})
  assert.equal((await f.host.perform('semantic-auto-poll')).view.advice.length,1)
  let resolve;f.api.get=()=>new Promise(r=>resolve=r)
  const poll=f.host.perform('semantic-auto-poll');await tick();f.host.setAutomaticEnabled(false)
  resolve({id:'auto',status:'READY',advice:[{text:'迟到'}]});await assert.rejects(poll)
  await assert.rejects(f.host.perform('semantic-auto-poll'),/关闭/)
})
test('automatic accepts server text through original token, revision, selection and AI authorship checks',async()=>{
  const f=automaticFixture();await f.auto();await assert.rejects(f.host.perform('semantic-auto-accept',{index:1}))
  await f.host.perform('semantic-auto-accept',{index:0,text:'伪造'})
  const write=f.calls.find(c=>c[0]==='accept_writing_suggestion')[1]
  assert.equal(write.text,'真实服务端候选');assert.equal(write.token,'t7');assert.equal(write.revision,7)
  assert.equal(write.expectedSelection,'');assert.equal(write.__agent,true)
})
test('automatic accept rejects changed revision and backend source-validation failure',async()=>{
  const f=automaticFixture();await f.auto();f.state.revision=8
  await assert.rejects(f.host.perform('semantic-auto-accept',{index:0}));assert.equal(f.calls.some(c=>c[0]==='accept'),false)
  const g=automaticFixture();await g.auto();g.api.accept=async()=>{throw new Error('Source changed')}
  await assert.rejects(g.host.perform('semantic-auto-accept',{index:0}),/Source changed/)
  assert.equal(g.calls.some(c=>c[0]==='accept_writing_suggestion'),false)
})
test('switching off or beginning explicit writing during automatic accept prevents insertion',async()=>{
  for(const stop of [async f=>f.host.setAutomaticEnabled(false),async f=>f.host.setActive(false),async f=>f.generate()]) {
    const f=automaticFixture();await f.auto();let resolve;f.api.accept=()=>new Promise(r=>resolve=r)
    const accepted=f.host.perform('semantic-auto-accept',{index:0});await tick();await stop(f)
    resolve({text:'旧候选',revision:'7',selection:''});await assert.rejects(accepted)
    assert.equal(f.calls.some(c=>c[0]==='accept_writing_suggestion'),false)
  }
})
test('automatic invalidation does not publish explicit stale UI or lose explicit generation',async()=>{
  const f=automaticFixture();await f.generate();f.messages.length=0
  f.host.setAutomaticEnabled(false);f.host.setActive(false)
  assert.equal(f.messages.some(m=>m.config?.semantic),false);assert.ok(f.messages.every(m=>m.config?.automatic?.state==='STALE'));await f.host.perform('semantic-accept',{index:0})
})

test('automatic refuses unknown paragraph index without silently reading paragraph zero',async()=>{
  for(const paragraphIndex of [undefined,null,-1,1.5]) {
    const f=automaticFixture();f.state.paragraphIndex=paragraphIndex
    assert.equal((await f.auto()).view.status,'EMPTY')
    assert.equal(f.calls.some(c=>c[0]==='get_document_text'||c[0]==='suggest'),false)
  }
})
test('automatic requires the complete current paragraph in the same revision window',async()=>{
  for(const setup of [f=>{f.state.paragraphIndex=10},f=>{f.state.text='字'.repeat(6001)}]) {
    const f=automaticFixture();setup(f);assert.equal((await f.auto()).view.status,'EMPTY')
    assert.equal(f.calls.some(c=>c[0]==='suggest'),false)
  }
  const f=automaticFixture();f.state.revision=8;await assert.rejects(f.auto())
  assert.equal(f.calls.some(c=>c[0]==='suggest'),false)
})
test('automatic includes only complete nearby preceding paragraphs of known unheaded body within 6000 chars',async()=>{
  const f=automaticFixture();f.state.paragraphIndex=8
  f.state.paragraphs=[{index:5,text:'太长的远段'.repeat(800)},{index:6,text:'邻近段落'.repeat(700)},{index:7,text:'紧邻段落'.repeat(300)},{index:8,text:f.state.text},{index:9,text:'未来附件的另一个条款'}]
  await f.auto();const req=f.calls.find(c=>c[0]==='suggest')[2]
  assert.deepEqual(f.calls.find(c=>c[0]==='get_document_text')[1],{startParagraph:5,maxParagraphs:7,__agent:true})
  assert.equal(req.context.documentText,f.state.paragraphs.slice(1,4).map(p=>p.text).join('\n'))
  assert.ok(req.context.documentText.length<=6000)
})
test('automatic retains real heading source text but excludes neighboring clauses and sections',async()=>{
  for(const [sectionTitle,sectionPath,scopeHeadings] of [
    ['第一条',['第一条'],[{index:1,text:'第一条 价款约定'}]],
    ['附件一 / 第一条',['附件一','第一条'],[{index:2,text:'  附件一  专用合同  '},{index:3,text:'第一条价款'}]]
  ]) {
    const f=automaticFixture();Object.assign(f.state,{paragraphIndex:8,sectionTitle,sectionPath,scopeHeadings})
    f.state.paragraphs=[{index:5,text:'别的条款价格为人民币100万元。'},{index:6,text:'其他条款内容'},{index:7,text:'邻近但未确认范围的文字'},{index:8,text:f.state.text},{index:9,text:'第二条 另有付款条件'}]
    await f.auto();const req=f.calls.find(c=>c[0]==='suggest')[2]
    assert.equal(req.context.documentText,[...scopeHeadings.map(h=>h.text),f.state.text].join('\n'))
    assert.equal(req.context.section,sectionTitle)
  }
})
test('automatic deduplicates a heading that is itself the current paragraph',async()=>{
  const f=automaticFixture();Object.assign(f.state,{paragraphIndex:4,sectionTitle:'第一条',sectionPath:['第一条'],scopeHeadings:[{index:4,text:'第一条 合成完整原文标题'}]})
  f.state.paragraphs=[{index:4,text:f.state.scopeHeadings[0].text}]
  await f.auto();assert.equal(f.calls.find(c=>c[0]==='suggest')[2].context.documentText,f.state.scopeHeadings[0].text)
})
test('automatic refuses missing, malformed, inconsistent or over-budget heading source metadata',async()=>{
  for(const scopeHeadings of [undefined,[],[{index:-1,text:'第一条'}],[{index:6,text:'第一条'}],[{index:1,text:''}],
    [{index:1,text:'字'.repeat(6000)}],[{index:4,text:'与实时正文不一致'}]]) {
    const f=automaticFixture();Object.assign(f.state,{paragraphIndex:4,sectionTitle:'第一条',sectionPath:['第一条'],scopeHeadings})
    f.state.paragraphs=[{index:4,text:f.state.text}]
    assert.equal((await f.auto()).view.status,'EMPTY');assert.equal(f.calls.some(c=>c[0]==='suggest'),false)
  }
  const f=automaticFixture();Object.assign(f.state,{paragraphIndex:4,sectionTitle:'附件一 / 第一条',sectionPath:['附件一','第一条'],scopeHeadings:[{index:2,text:'附件一'},{index:2,text:'第一条'}]})
  f.state.paragraphs=[{index:4,text:f.state.text}]
  assert.equal((await f.auto()).view.status,'EMPTY')
})
test('closing or editing while paragraph read is pending prevents automatic API call',async()=>{
  for(const cancel of [f=>f.host.setAutomaticEnabled(false),f=>f.host.modified(),f=>f.host.setActive(false)]) {
    const f=automaticFixture();let resolve;f.state.onRead=()=>new Promise(r=>resolve=r)
    const work=f.auto();await tick();cancel(f);resolve();await assert.rejects(work)
    assert.equal(f.calls.some(c=>c[0]==='suggest'),false)
  }
})

test('automatic can finish a middle paragraph but cannot insert inside an unfinished phrase',async()=>{
  for(const after of ['。\n下一段为背景说明', '；\r\n附件二：其他范围']) {
    const f=automaticFixture();f.state.after=after;await f.auto()
    const context=f.calls.find(c=>c[0]==='suggest')[2].context
    assert.equal(context.after,after);assert.equal(context.documentText,f.state.text)
  }
  for(const after of ['接着还有未写完的句子。\n下一段', '。本段还有正文\n下一段']) {
    const f=automaticFixture();f.state.after=after
    assert.equal((await f.auto()).view.status,'EMPTY');assert.equal(f.calls.some(c=>c[0]==='suggest'),false)
  }
})

test('removing selected materials or changing document type updates subsequent automatic context immediately',async()=>{
  const f=automaticFixture();await f.generate({sourceFileIds:[2,3],documentType:'contract'});await f.host.perform('semantic-cancel')
  await f.auto();const previous=f.calls.filter(c=>c[0]==='suggest').at(-1)[2]
  assert.deepEqual(previous.context.sourceFileIds,[2,3])
  await f.host.perform('semantic-context',{sourceFileIds:[],documentType:'auto'})
  assert.ok(f.calls.some(c=>c[0]==='cancel'))
  await f.auto();const next=f.calls.filter(c=>c[0]==='suggest').at(-1)[2]
  assert.deepEqual(next.context.sourceFileIds,[]);assert.equal(next.context.documentType,'auto')
  await assert.rejects(f.host.perform('semantic-context',{sourceFileIds:[-1]}))
})
