// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
function vm(renameProject = async () => {}) {
  const code = source.slice(source.indexOf('    startRenameProject() {'), source.indexOf('    toggleFileMoreMenu()'))
  const toasts = []
  const methods = new Function('renameProject', 'uni', `return {${code}}`)(renameProject, {showToast: v => toasts.push(v)})
  return Object.assign({projectId:7,project:{name:'旧名'},isClientView:false,canRenameProject:true,
    renameProjectName:'',renameProjectTargetId:null,renameProjectSaving:false,renameProjectComposing:false,renameProjectSkipConfirm:false,renameProjectFocused:false,
    isRenamingProject:false,$nextTick:async()=>{},$t:k=>k,toasts}, methods)
}
test('title edits inline with separate keyboard-accessible switcher; no menu rename row', () => {
  const header = source.slice(0, source.indexOf('<!-- Center Logo -->'))
  assert.match(header, /class="project-name project-name-edit"[\s\S]*?@click.stop="startRenameProject"/)
  assert.match(header, /class="project-switcher"[\s\S]*?@click.stop="toggleProjectSwitcher"/)
  assert.match(header, /class="project-name project-name-edit" role="button" tabindex="0"/)
  assert.match(header, /class="project-switcher" role="button" tabindex="0"/)
  assert.match(header, /@keydown="handleProjectTitleActivation\(\$event, 'rename'\)"/)
  assert.match(header, /@keydown="handleProjectTitleActivation\(\$event, 'switch'\)"/)
  assert.doesNotMatch(header, /switcher-rename|startRenameFromSwitcher/)
  assert.match(header, /v-else-if="hasNamedProject && canRenameProject"/)
})
test('confirm uses live value, blur preserves pending draft and repeated Enter sends only once', async () => {
  let done; const calls=[]
  const state=vm((...args)=>{calls.push(args);return new Promise(r=>done=r)})
  state.startRenameProject()
  state.renameProjectName='节流中的旧值'
  const pending=state.confirmRenameProject({detail:{value:' 新项目名称 '}})
  state.cancelRenameProject()
  await state.confirmRenameProject({detail:{value:'重复'}})
  assert.deepEqual(calls,[[7,'新项目名称']])
  assert.equal(state.renameProjectName,'新项目名称')
  assert.equal(state.isRenamingProject,true)
  done(); await pending
  assert.equal(state.project.name,'新项目名称')
  assert.equal(state.isRenamingProject,false)
})
test('failed save retains draft and can retry',async()=>{
  let attempts=0; const state=vm(async()=>{if(++attempts===1)throw Error('offline')})
  state.startRenameProject()
  await state.confirmRenameProject({detail:{value:'待保存名字'}})
  assert.equal(state.isRenamingProject,true)
  assert.equal(state.renameProjectName,'待保存名字')
  assert.equal(state.renameProjectSaving,false)
  await state.confirmRenameProject()
  assert.equal(state.project.name,'待保存名字')
  assert.equal(attempts,2)
})
test('late rename never writes into a newly selected project',async()=>{
  let done; const state=vm(()=>new Promise(r=>done=r))
  state.startRenameProject()
  const pending=state.confirmRenameProject({detail:{value:'A新名'}})
  state.projectId=8;state.project={name:'B'}
  done();await pending
  assert.equal(state.project.name,'B')
  assert.equal(state.isRenamingProject,false)
  assert.equal(state.toasts.length,0)
})
test('Escape cancels and composition Enter never submits',async()=>{
  let calls=0; const state=vm(async()=>calls++)
  state.startRenameProject();state.renameProjectName='草稿'
  state.renameProjectComposing=true
  await state.confirmRenameProject({detail:{value:'输入法候选'}})
  state.renameProjectComposing=false
  state.handleRenameProjectKeydown({key:'Enter',isComposing:true,preventDefault(){}})
  state.handleRenameProjectKeydown({key:'Enter',keyCode:229,preventDefault(){}})
  assert.equal(calls,0)
  state.handleRenameProjectKeydown({key:'Escape',preventDefault(){}})
  assert.equal(state.isRenamingProject,false)
  assert.equal(state.project.name,'旧名')
})
test('clients and known read-only members cannot start or submit edits; unchanged/empty name never requests',async()=>{
  let calls=0;const state=vm(async()=>calls++)
  state.isClientView=true;state.startRenameProject();assert.equal(state.isRenamingProject,false)
  state.isClientView=false;state.canRenameProject=false;state.startRenameProject();assert.equal(state.isRenamingProject,false)
  state.canRenameProject=true;state.startRenameProject()
  await state.confirmRenameProject({detail:{value:'  '}});assert.equal(state.isRenamingProject,true)
  await state.confirmRenameProject({detail:{value:'旧名'}})
  assert.equal(calls,0);assert.equal(state.isRenamingProject,false)
})
test('rename permission matches owner-only backend rather than collaborator write access',()=>{
  const code=source.slice(source.indexOf('    canRenameProject() {'),source.indexOf('    FILE_BATCH_ACTIONS() {'))
  const {canRenameProject}=new Function(`return {${code}}`)()
  assert.equal(canRenameProject.call({currentUser:{id:7},project:{userId:'7'},isClientView:false}),true)
  assert.equal(canRenameProject.call({currentUser:{id:8},project:{userId:7},isClientView:false}),false)
  assert.equal(canRenameProject.call({currentUser:{id:7},project:{userId:7},isClientView:true}),false)
  assert.equal(canRenameProject.call({currentUser:{},project:{userId:7},isClientView:false}),false)
})

test('Enter and Space activate uni title buttons once and prevent native duplicate/scroll behavior',()=>{
  const state=vm();let switches=0,prevented=0,stopped=0
  state.toggleProjectSwitcher=()=>switches++
  const event=key=>({key,type:'keyup',preventDefault(){prevented++},stopPropagation(){stopped++}})
  state.handleProjectTitleActivation(event('Enter'),'rename')
  assert.equal(state.isRenamingProject,true)
  state.cancelRenameProject()
  state.handleProjectTitleActivation(event(' '),'rename')
  assert.equal(state.isRenamingProject,true)
  state.handleProjectTitleActivation(event('Enter'),'switch')
  state.handleProjectTitleActivation(event(' '),'switch')
  state.handleProjectTitleActivation({...event(' '),repeat:true},'switch')
  state.handleProjectTitleActivation({...event('Enter'),isComposing:true},'switch')
  state.handleProjectTitleActivation(event('Tab'),'switch')
  assert.equal(switches,2)
  assert.equal(prevented,5)
  assert.equal(stopped,5)
})

// uni-h5 emits confirm on input keyup and normalizes it without isComposing/keyCode.
function uniConfirm(value) { return {type:'confirm',target:{},detail:{value}} }
test('activation waits for release, so Enter keyup cannot land on the newly mounted input',()=>{
  const state=vm()
  const key={key:'Enter',preventDefault(){},stopPropagation(){}}
  state.handleProjectTitleActivation({...key,type:'keydown'},'rename')
  assert.equal(state.isRenamingProject,false)
  state.handleProjectTitleActivation({...key,type:'keyup'},'rename')
  assert.equal(state.isRenamingProject,true)
  assert.equal(state.renameProjectFocused,true)
  const header=source.slice(0,source.indexOf('<!-- Center Logo -->'))
  assert.match(header, /@keyup="handleProjectTitleActivation\(\$event, 'rename'\)"/)
  assert.match(header, /@keyup="handleProjectTitleActivation\(\$event, 'switch'\)"/)
})
test('uni IME compositionend before normalized keyup confirm does not save; next Enter does',async()=>{
  const calls=[];const state=vm(async(...args)=>calls.push(args))
  state.startRenameProject()
  state.renameProjectComposing=true
  state.handleRenameProjectKeydown({key:'Enter',keyCode:229,isComposing:true})
  state.renameProjectComposing=false
  await state.confirmRenameProject(uniConfirm('候选确认'))
  assert.deepEqual(calls,[])
  assert.equal(state.isRenamingProject,true)
  state.handleRenameProjectKeydown({key:'Enter',preventDefault(){}})
  assert.deepEqual(calls,[])
  await state.confirmRenameProject(uniConfirm('最终项目名'))
  assert.deepEqual(calls,[[7,'最终项目名']])
  assert.match(source.slice(0,source.indexOf('<!-- Center Logo -->')), /:ignore-composition-event="false"/)
})
test('failed request toggles focus after disabled field has rendered enabled',async()=>{
  let reject;const state=vm(()=>new Promise((_,r)=>reject=r));const ticks=[]
  state.$nextTick=async()=>ticks.push({saving:state.renameProjectSaving,focused:state.renameProjectFocused})
  state.startRenameProject()
  const pending=state.confirmRenameProject(uniConfirm('保留草稿'))
  assert.equal(state.renameProjectFocused,false)
  state.cancelRenameProject() // blur from disabling must not destroy the draft
  reject(Error('offline'));await pending
  assert.deepEqual(ticks,[{saving:false,focused:false}])
  assert.equal(state.renameProjectFocused,true)
  assert.equal(state.renameProjectName,'保留草稿')
  assert.equal(state.isRenamingProject,true)
  assert.match(source.slice(0,source.indexOf('<!-- Center Logo -->')), /:focus="renameProjectFocused"/)
})

test('installed uni input keyup contract preserves IME guard after event normalization',async()=>{
  const uniSource=readFileSync(new URL('../../node_modules/@dcloudio/uni-h5/dist/uni-h5.es.js',import.meta.url),'utf8')
  const normalizeCode=uniSource.slice(uniSource.indexOf('function normalizeCustomEvent('),uniSource.indexOf('const hoverProps ='))
  const normalize=new Function('normalizeTarget',`${normalizeCode};return normalizeCustomEvent`)(()=>({}))
  const keyupStart=uniSource.indexOf('    function onKeyUpEnter(event) {')
  const keyupCode=uniSource.slice(keyupStart,uniSource.indexOf('    expose({',keyupStart))
  const calls=[];const state=vm(async(...args)=>calls.push(args));let pending
  const onKeyup=new Function('trigger','props2',`${keyupCode};return onKeyUpEnter`)(
    (name,event,detail)=>{pending=state.confirmRenameProject(normalize(name,event,{},detail))},
    {confirmHold:true})
  state.startRenameProject()
  state.handleRenameProjectKeydown({key:'Enter',isComposing:true,keyCode:229})
  onKeyup({key:'Enter',isComposing:false,target:{value:'中文候选'},stopPropagation(){}})
  await pending
  assert.deepEqual(calls,[])
  state.handleRenameProjectKeydown({key:'Enter',preventDefault(){}})
  onKeyup({key:'Enter',target:{value:'中文项目'},stopPropagation(){}})
  await pending
  assert.deepEqual(calls,[[7,'中文项目']])
})
