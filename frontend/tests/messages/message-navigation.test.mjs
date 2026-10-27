// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeMessageTarget } from '../../src/utils/messageTargets.js'
import { isContextEligibleTab } from '../../src/pages/project-overview/activeTabContext.js'
import { serialize, restore } from '../../src/pages/project-overview/tabSnapshot.js'
import { isPaneAllowedWithoutProject } from '../../src/pages/project-overview/noProjectShell.js'
import { ddClientTabMethods } from '../../src/pages/project-overview/ddClientTab.js'
import { isGlobalPlugin } from '../../src/utils/pluginViews.js'
const code = readFileSync(new URL('../../src/pages/project-overview/messageCenterTab.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace('export const messageCenterTabMethods =','return')
function fixture(overrides={}) {
 const events=[],routes=[],business=[],requests=[];let identity='one'
 const methods=new Function('normalizeMessageTarget','messageCenterRequest','messageCenterIdentity','getDdRequestDetails','isGlobalPlugin','uni','ACCOUNT_CHANGED_EVENT',code)(normalizeMessageTarget,async(action,params)=>{requests.push({action,params});return overrides.target||{kind:'im',conversationId:'one'}},()=>identity,async()=>({request:{id:6,name:'真实尽调清单'},items:[]}),isGlobalPlugin,{$emit:(...args)=>events.push(args),showToast:(message)=>events.push(message)},'account-changed')
 const vm={leftFiles:[],rightFiles:[],focusedPane:'left',splitMode:false,projectId:null,hasProject:false,dynamicPlugins:[],isActiveOverviewInstance:()=>true,$t:k=>k,$nextTick:fn=>fn(),triggerWorkbenchResize(){},leaveWorkbench:async(url)=>{routes.push(url);return true},loadDynamicPlugins:async()=>{},handleOpenDdRequest:request=>business.push(request),openConversationInPanel:id=>business.push(id),openCalendarTab:opts=>business.push(opts),handleOpenLawFirmPlugin:async(opts)=>business.push(opts),openPluginTab:id=>business.push(id),...overrides}
 for(const[name,fn]of Object.entries({...methods,...ddClientTabMethods}))vm[name]=fn.bind(vm)
 return{vm,events,routes,business,requests,replaceAccount(){identity='two'}}
}
test('message center is a global singleton without modifying the sidebar or split layout',()=>{
 const {vm}=fixture({leftPaneKey:'files',sidebarCollapsed:true});vm.openMessageCenterTab();vm.openMessageCenterTab({conversationId:'c1'});assert.equal(vm.leftFiles.length,1);assert.equal(vm.leftFiles[0].messageFocus,'c1');assert.equal(vm.leftPaneKey,'files');assert.equal(vm.sidebarCollapsed,true);assert.equal(vm.splitMode,false);assert.equal(isPaneAllowedWithoutProject('messages'),false);assert.equal(isContextEligibleTab(vm.leftFiles[0]),false)
 const tab=vm.leftFiles.pop();vm.rightFiles=[tab];vm.openMessageCenterTab();assert.equal(vm.focusedPane,'right');assert.equal(vm.splitMode,true);assert.equal(vm.leftFiles.length,0)
})
test('snapshot restores global singleton but never message contents, target or focus',()=>{
 const tab={id:'message-center',tabType:'message-center',name:'消息',messageFocus:'old',draft:'private',target:{}};const snapshot=serialize([tab],[tab],tab.id,tab.id,{splitMode:true,focusedPane:'left'});assert.equal(JSON.stringify(snapshot).includes('private'),false);assert.equal(JSON.stringify(snapshot).includes('messageFocus'),false)
 const result=restore(snapshot,{hasProject:false});assert.equal(result.leftFiles.length+result.rightFiles.length,1)
})
test('cross-project messages flush via leaveWorkbench and only preserve opaque notice ID',async()=>{
 const f=fixture({projectId:1,hasProject:true});await f.vm.openMessageTarget({kind:'dd',projectId:9,requestId:6,itemId:8},'local:dd:item:8');assert.deepEqual(f.routes,['/pages/project-overview/project-overview?id=9&messageId=local%3Add%3Aitem%3A8']);assert.equal(f.business.length,0)
 await assert.rejects(()=>f.vm.openMessageTarget({kind:'dd',projectId:9,requestId:6}),/targetUnavailable/)
})
test('invited client remote project stays in current shell and repeated navigation refreshes the singleton intent',async()=>{
 const f=fixture({projectId:1,hasProject:true});const target={kind:'dd-client',projectId:999,connectionId:'12345678-1234-1234-1234-123456789abc',requestId:6,itemId:7};await f.vm.openMessageTarget(target,'notice:one');await f.vm.openMessageTarget(target,'notice:one');assert.equal(f.routes.length,0);assert.equal(f.vm.leftFiles.length,1);assert.equal(f.vm.leftFiles[0].ddClientTarget.token,2);assert.equal(f.vm.leftFiles[0].ddClientTarget.projectId,'999')
})
test('destination resolves notice permission again, then opens same-project DD at selected item',async()=>{
 const f=fixture({projectId:9,hasProject:true,target:{kind:'dd',projectId:9,requestId:6,itemId:7}});await f.vm.resolveMessageTarget('local:dd:opaque');assert.deepEqual(f.requests,[{action:'target',params:{id:'local:dd:opaque'}}]);assert.deepEqual(f.business,[{id:6,name:'真实尽调清单',focusItemId:'7'}])
})
test('plugin destinations require installed enabled scope and preserve recordId through message-open',async()=>{
 const f=fixture({projectId:1,hasProject:true,dynamicPlugins:[{pluginId:'example-plugin'}]});await f.vm.openMessageTarget({kind:'plugin',pluginId:'example-plugin',view:'records',recordId:'record-one'});assert.deepEqual(f.events[0],['awd:plugin-sidebar-command',{pluginId:'example-plugin',command:'message-open',view:'records',recordId:'record-one',projectId:1}]);await assert.rejects(()=>f.vm.openMessageTarget({kind:'plugin',pluginId:'missing',view:'records',recordId:'one'}),/pluginUnavailable/)
 const noProject=fixture({dynamicPlugins:[{pluginId:'example-plugin'}]});await assert.rejects(()=>noProject.vm.openMessageTarget({kind:'plugin',pluginId:'example-plugin',view:'records',recordId:'one'}),/pluginUnavailable/)
})
test('late plugin lookup after account replacement cannot navigate',async()=>{
 let resolve;const promise=new Promise(r=>resolve=r);const f=fixture({projectId:1,hasProject:true,dynamicPlugins:[{pluginId:'example-plugin'}],loadDynamicPlugins:()=>promise});const work=f.vm.openMessageTarget({kind:'plugin',pluginId:'example-plugin',view:'records',recordId:'one'});f.replaceAccount();resolve();assert.equal(await work,false);assert.equal(f.business.length,0)
})

test('reopening the same conversation intent retriggers the existing center watcher', () => {
 const ticks=[];const f=fixture({$nextTick:fn=>ticks.push(fn)});f.vm.leftFiles=[{id:'message-center',tabType:'message-center',messageFocus:'same'}];f.vm.openMessageCenterTab({conversationId:'same'});assert.equal(f.vm.leftFiles[0].messageFocus,'');while(ticks.length)ticks.shift()();assert.equal(f.vm.leftFiles[0].messageFocus,'same');assert.equal(f.vm.leftFiles.length,1)
})
