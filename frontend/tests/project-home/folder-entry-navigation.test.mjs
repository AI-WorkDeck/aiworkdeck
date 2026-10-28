// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../../src/pages/project-overview/project-overview.vue',import.meta.url),'utf8')
function methods(start,end,dependencies={}) {
  return new Function(...Object.keys(dependencies), `return {${source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))}}`)(...Object.values(dependencies))
}
test('all projects remain searchable beyond recent eight, and current folder only activates files',async()=>{
  const rows=Array.from({length:20},(_,i)=>({id:i+1,name:`Folder ${i+1}`}))
  const state={projectId:1,showCurrentProjectFiles(){this.activated=true},leaveWorkbench(url){this.url=url},...methods('    async toggleProjectSwitcher()', '    // 工作台里的「项目概览」', {getMyProjects:async()=>rows,getRecentProjectIds:()=>[15,3]})}
  state.showCurrentProjectFiles=()=>{state.activated=true}
  await state.loadSwitcherProjects()
  assert.equal(state.switcherProjects.length,20)
  assert.deepEqual(state.switcherProjects.slice(0,2).map(p=>p.id),[15,3])
  const computed=methods('    filteredSwitcherProjects()', '    messageActiveFileIds()')
  state.projectSwitcherQuery='folder 20'
  assert.deepEqual(computed.filteredSwitcherProjects.call(state).map(p=>p.id),[20])
  state.switchToProject({id:1}); assert.equal(state.activated,true); assert.equal(state.url,undefined)
  state.switchToProject({id:20}); assert.equal(state.url,'/pages/project-overview/project-overview?id=20&pane=files')
})
test('legacy all-project entry activates welcome catalog visibly from chat mode',()=>{
  const calls=[]
  const state={projectSwitcherOpen:true,welcomeCatalogRequest:0,isChatMode:true,switchViewMode:mode=>calls.push(mode),openWelcomeTab:()=>calls.push('welcome'),...methods('    openProjectsPane()', '    // 欢迎标签 Start')}
  state.openProjectsPane()
  assert.deepEqual(calls,['ide','welcome']); assert.equal(state.welcomeCatalogRequest,1); assert.equal(state.projectSwitcherOpen,false)
})
test('current-folder deletion saves and confirms first; cancellation never deletes',async()=>{
  const calls=[]
  const state={projectId:7,isClientView:false,saveFailed:true,$t:key=>key,flushBeforeLeaving:async()=>{calls.push('save');return false},confirmVersionBeforeLeaving:async()=>{calls.push('confirm');return true},...methods('    async leaveWorkbench(url, options)', '    // 「全部项目…」', {flushDirtyEditors:async()=>{calls.push('save');return {failed:state.saveFailed?1:0}},uni:{showToast(){},reLaunch:({success})=>{calls.push('leave');success()}}}),...methods('    async deleteWorkspaceProject(id)', '    // ---------- 欢迎标签与旧项目入口兼容', {deleteProject:async id=>calls.push(`delete:${id}`),uni:{reLaunch:({success})=>{calls.push('leave');success()}}})}
  assert.equal(await state.deleteWorkspaceProject(7),false); assert.deepEqual(calls,['save'])
  calls.length=0; state.saveFailed=false;state.confirmVersionBeforeLeaving=async()=>{calls.push('confirm');return false}
  assert.equal(await state.deleteWorkspaceProject(7),false); assert.deepEqual(calls,['save','confirm'])
  calls.length=0; state.confirmVersionBeforeLeaving=async()=>{calls.push('confirm');return true}
  assert.equal(await state.deleteWorkspaceProject(7),true);assert.deepEqual(calls,['save','confirm','delete:7','leave'])
  calls.length=0; state.isClientView=true;assert.equal(await state.deleteWorkspaceProject(9),false);assert.deepEqual(calls,[])
})
