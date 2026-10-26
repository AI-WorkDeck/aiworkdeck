// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeMembers } from '../../src/utils/mergeMembers.js'
const source = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
function method(name, dependencies = {}) {
  const match = source.match(new RegExp(`\\n    (async )?${name}\\([^\\n]*\\) \\{\\n([\\s\\S]*?)\\n    \\},`))
  assert.ok(match, name)
  return new Function(...Object.keys(dependencies), `return ${match[1] || ''}function() {${match[2]}}`)(...Object.values(dependencies))
}
const write = method('canWriteProject')
const state = values => ({ projectId: 12, project: { id: 12, userId: 1 }, projectInfoLoaded: true,
  currentUser: { id: 2, role: 'USER' }, permissionUserLoaded: true, loadProjectMembers: async () => {}, localProjectMembers: [],
  localProjectMembersLoaded: true, localProjectMembersProjectId: 12, projectMembers: [], ...values })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('unknown identity, global role, project and membership fail closed', () => {
  for (const patch of [{currentUser:{}}, {currentUser:{id:2}}, {currentUser:{id:2,role:'FUTURE'}},
    {permissionUserLoaded:false}, {projectInfoLoaded:false}, {project:{id:99,userId:2}},
    {localProjectMembersLoaded:false}, {}, {localProjectMembers:[{userId:2,role:'FUTURE'}]}]) {
    assert.equal(write.call(state(patch)), false, JSON.stringify(patch))
  }
})
test('known non-client owner writes immediately including loose workspace without members', () => {
  for (const projectType of ['BLANK','LOOSE_FILES']) assert.equal(write.call(state({
    project:{id:12,userId:2,projectType},localProjectMembersLoaded:false,localProjectMembersProjectId:null,
  })), true)
  for (const role of ['CLIENT','client']) assert.equal(write.call(state({currentUser:{id:2,role},project:{id:12,userId:2}})),false)
})
test('only authoritative local ADMIN or PARTICIPANT may grant non-owner write', () => {
  for (const role of ['ADMIN','PARTICIPANT','READ_ONLY','CLIENT_NAMED','CLIENT_GENERIC','CLIENT','admin',null]) {
    assert.equal(write.call(state({localProjectMembers:[{userId:2,role}],projectMembers:[{userId:2,role:'ADMIN',fromCloud:true}]})), ['ADMIN','PARTICIPANT'].includes(role),String(role))
  }
  assert.equal(write.call(state({localProjectMembers:[{userId:2,role:'ADMIN'}],localProjectMembersProjectId:99})),false)
})
test('member refresh revokes immediately and cloud display roles never grant local access', async () => {
  const gate=deferred(), cloud=deferred(), vm=state({hasNamedProject:true,collabCloud:{linked:true},localProjectMembers:[{userId:2,role:'ADMIN'}]})
  const load=method('loadProjectMembers',{getProjectMembers:()=>gate.promise,getCloudMembers:()=>cloud.promise,mergeMembers})
  const job=load.call(vm); assert.equal(write.call(vm),false)
  gate.resolve({code:0,data:[{id:20,userId:2,accountId:200,role:'READ_ONLY'}]});await new Promise(r=>setImmediate(r))
  cloud.resolve({code:0,data:{members:[{id:200,userId:2,accountId:200,role:'ADMIN'}]}});await job
  assert.equal(vm.projectMembers[0].role,'ADMIN');assert.equal(vm.localProjectMembers[0].role,'READ_ONLY');assert.equal(write.call(vm),false)
})
test('late member grants cannot overwrite newer revoke or another project', async () => {
  const first=deferred(), second=deferred();let reads=0
  const load=method('loadProjectMembers',{getProjectMembers:()=>++reads===1?first.promise:second.promise,mergeMembers})
  const vm=state({hasNamedProject:true});const old=load.call(vm), fresh=load.call(vm)
  second.resolve({code:0,data:[{userId:2,role:'READ_ONLY'}]});await fresh
  first.resolve({code:0,data:[{userId:2,role:'ADMIN'}]});await old;assert.equal(write.call(vm),false)
  const other=deferred(), next=method('loadProjectMembers',{getProjectMembers:()=>other.promise,mergeMembers})
  const pending=next.call(vm);vm.projectId=99;other.resolve({code:0,data:[{userId:2,role:'ADMIN'}]});await pending
  assert.notEqual(vm.localProjectMembersProjectId,99);assert.equal(write.call(vm),false)
})
test('cached identities cannot authorize while actual identity is loading; old replies cannot grant', async () => {
  const first=deferred(),second=deferred();let reads=0
  const load=method('loadRealUserInfo',{getCurrentUserApi:()=>++reads===1?first.promise:second.promise})
  const vm=state({currentUser:{id:1,role:'USER'}}), old=load.call(vm);assert.equal(write.call(vm),false)
  const fresh=load.call(vm);second.resolve({code:0,data:{id:2,role:'CLIENT'}});await fresh
  first.resolve({code:0,data:{id:1,role:'USER'}});await old
  assert.equal(vm.currentUser.id,2);assert.equal(write.call(vm),false)
})
test('identity refresh discards old membership and obtains a fresh local authority snapshot',async()=>{
 const stale=deferred(), fresh=deferred(), identity=deferred(), vm=state({hasNamedProject:true})
 let reads=0
 vm.loadProjectMembers=method('loadProjectMembers',{getProjectMembers:()=>++reads===1?stale.promise:fresh.promise,mergeMembers}).bind(vm)
 const userLoad=method('loadRealUserInfo',{getCurrentUserApi:()=>identity.promise})
 const old=vm.loadProjectMembers(), refresh=userLoad.call(vm)
 identity.resolve({code:0,data:{id:2,role:'USER'}});await new Promise(r=>setImmediate(r))
 assert.equal(reads,2,'confirmed identity must schedule replacement for invalidated membership')
 stale.resolve({code:0,data:[{userId:2,role:'ADMIN'}]});await old
 assert.equal(write.call(vm),false,'the previous authority snapshot cannot grant while fresh membership is pending')
 fresh.resolve({code:0,data:[{userId:2,role:'PARTICIPANT'}]});await refresh
 assert.equal(write.call(vm),true);assert.equal(vm.localProjectMembersLoaded,true)
})
for (const role of ['ADMIN','PARTICIPANT']) test(`account refresh reloads local ${role} authority without another onShow`,async()=>{
 const identity=deferred(), members=deferred(), vm=state({hasNamedProject:true,localProjectMembers:[{userId:2,role}]})
 let reads=0
 vm.loadLicenseMode=()=>{};vm.loadWalletBalance=()=>{}
 vm.loadProjectMembers=method('loadProjectMembers',{getProjectMembers:()=>{reads++;return members.promise},mergeMembers}).bind(vm)
 const userLoad=method('loadRealUserInfo',{getCurrentUserApi:()=>identity.promise})
 vm.loadRealUserInfo=()=>vm.identityPending=userLoad.call(vm)
 vm.refreshAccountState=method('refreshAccountState').bind(vm)
 // Execute the production event callback: its other branch only refreshes collaboration.
 const accountEvent=source.match(/this\._onAccountChanged = (\(\) => Promise\.all\(\[[\s\S]*?\]\))/)[1]
 vm.onCollabAccountChanged=method('onCollabAccountChanged',{getCloudAccountGeneration:()=>1}).bind(vm)
 vm.stopCollabPolling=()=>{};vm.fetchCollabState=async()=>{};vm.startCollabPolling=()=>{}
 const fire=new Function(`return function(){return (${accountEvent})()}`)
 assert.equal(write.call(vm),true)
 await fire().call(vm)
 assert.equal(write.call(vm),false)
 identity.resolve({code:0,data:{id:2,role:'USER'}});await new Promise(r=>setImmediate(r))
 assert.equal(reads,1,'account event must not leave local membership permanently invalidated')
 members.resolve({code:0,data:[{userId:2,role}]});await vm.identityPending
 assert.equal(write.call(vm),true)
})
test('failed identity or membership refresh does not retain cached write authority',async()=>{
 const quiet={error(){},warn(){}}, members=method('loadProjectMembers',{getProjectMembers:async()=>{throw Error('offline')},console:quiet})
 const vm=state({hasNamedProject:true,localProjectMembers:[{userId:2,role:'ADMIN'}]})
 await members.call(vm);assert.equal(write.call(vm),false)
 vm.currentUser={id:1,role:'USER'}
 await method('loadRealUserInfo',{getCurrentUserApi:async()=>{throw Error('offline')},console:quiet}).call(vm)
 assert.equal(write.call(vm),false)
})

function lifecycle(name, next, dependencies) {
 const start=source.indexOf(`  ${name}(`), end=source.indexOf(`  ${next}(`,start)
 assert.ok(start>=0 && end>start)
 return new Function(...Object.keys(dependencies),`return ({${source.slice(start,end)}}).${name}`)(...Object.values(dependencies))
}
for (const identityFirst of [true,false]) test(`initial onLoad/onShow restores member access with identity ${identityFirst?'first':'last'}`,async()=>{
 const project=deferred(), identity=deferred(), collab=deferred();let memberReads=0
 const vm=state({projectInfoLoaded:false,permissionUserLoaded:false,localProjectMembersLoaded:false,
   hasProject:true,hasNamedProject:true,isLooseWorkspace:false,showAiPanel:true,collabCloud:null,
   initRestartRecovery(){},loadLicenseMode(){},loadWalletBalance(){},loadPanelDocks(){},loadRailOrder(){},initThemeSwitch(){},
   normalizeDockSelections(){},bindClipboardListener(){},loadDynamicPlugins(){},loadEnabledSkills(){},
   restoreTabSnapshot:async()=>true,maybeRegisterOpenWorkbench(){},scheduleLibreSpare(){},registerMenuCommands(){},
   startActivityTracking(){},checkAdoptConflict(){},startCollabPolling(){},ensureStagingFolder:async()=>{},loadStagingFiles(){},
   fetchCollabState:()=>collab.promise,
 })
 vm.loadProjectMembers=method('loadProjectMembers',{getProjectMembers:async()=>{memberReads++;return {code:0,data:[{userId:2,role:'PARTICIPANT'}]}},mergeMembers}).bind(vm)
 const loadIdentity=method('loadRealUserInfo',{getCurrentUserApi:()=>identity.promise})
 vm.loadRealUserInfo=()=>vm.identityPending=loadIdentity.call(vm)
 vm.loadProjectInfo=method('loadProjectInfo',{getProject:()=>project.promise,recordProjectVisit(){},syncRecentToMenuFetching(){},loadProjectTasks:async()=>[]}).bind(vm)
 const deps={uni:{$on(){},getStorageSync(){}},loadSiteLinks(){},loadShowWelcomeOnStartup:()=>false,getCurrentUser:()=>null,
   loadSidebarCollapsed:()=>false,workbenchStorageKey:()=>'',isPaneAllowedWithoutProject:()=>true,NO_PROJECT_DEFAULT_PANE:'projects',
   activityTracker:{getRecordingState:()=>false}}
 lifecycle('onLoad','onShow',deps).call(vm,{id:'12'})
 lifecycle('onShow','onHide',deps).call(vm)
 assert.equal(memberReads,0,'onShow before project details cannot be the only membership refresh')
 if(identityFirst){identity.resolve({code:0,data:{id:2,role:'USER'}});await vm.identityPending}
 project.resolve({id:12,userId:1,projectType:'BLANK'});await vm._restartProjectReady
 collab.resolve();await new Promise(r=>setImmediate(r))
 if(!identityFirst){identity.resolve({code:0,data:{id:2,role:'USER'}});await vm.identityPending}
 assert.ok(memberReads>0);assert.equal(write.call(vm),true)
})
test('confirmed owner can edit before slow member reload completes; unknown identity never grants',async()=>{
 const members=deferred(), vm=state({hasNamedProject:true});let reads=0
 vm.loadProjectMembers=method('loadProjectMembers',{getProjectMembers:()=>{reads++;return members.promise},mergeMembers}).bind(vm)
 const pending=method('loadRealUserInfo',{getCurrentUserApi:async()=>({code:0,data:{id:1,role:'USER'}})}).call(vm)
 await new Promise(r=>setImmediate(r))
 assert.equal(reads,1);assert.equal(write.call(vm),true,'owner access does not await membership network')
 members.resolve({code:0,data:[]});await pending
 for(const data of [{id:1,role:'FUTURE'},{role:'USER'}]){
   await method('loadRealUserInfo',{getCurrentUserApi:async()=>({code:0,data})}).call(vm)
   assert.equal(write.call(vm),false);assert.equal(reads,1,'unknown identity cannot refresh an authority snapshot')
 }
})

test('identity event refreshes members only after current identity is confirmed',async()=>{
 const identity=deferred(), vm=state({hasNamedProject:true});let reads=0
 vm.loadProjectMembers=method('loadProjectMembers',{getProjectMembers:async()=>{reads++;return {code:0,data:[{userId:2,role:'ADMIN'}]}},mergeMembers}).bind(vm)
 const load=method('loadRealUserInfo',{getCurrentUserApi:()=>identity.promise})
 vm.loadRealUserInfo=()=>vm.identityPending=load.call(vm)
 const callback=source.match(/this\._onIdentityUpdated = (\(\) => \{[\s\S]*?\n    \})/)[1]
 new Function(`return function(){return (${callback})()}`)().call(vm)
 assert.equal(reads,0)
 identity.resolve({code:0,data:{id:2,role:'USER'}});await vm.identityPending
 assert.equal(reads,1);assert.equal(write.call(vm),true)
})
