// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { normalizeMessageTarget } from '../../src/utils/messageTargets.js'
import zh from '../../src/locales/zh-CN/messageCenter.js'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom'), { parse } = require('@vue/compiler-sfc')
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost' })
for (const key of ['window','document','Element','Node','HTMLElement','SVGElement']) globalThis[key] = dom.window[key]
const Vue = require('vue/dist/vue.cjs.js')
const child = parse(readFileSync(new URL('../../src/components/messages/MessageConversationPane.vue', import.meta.url), 'utf8')).descriptor
const Child = { ...new Function(child.script.content.replace('export default', 'return'))(), template: child.template.content }
const source = parse(readFileSync(new URL('../../src/components/messages/MessageCenterPane.vue', import.meta.url), 'utf8')).descriptor
const script = source.script.content.replace(/^import .*$/gm, '').replace('export default', 'return')
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick() }
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const conv = (extra = {}) => ({id:'c1',title:'测试项目群',type:'GROUP',role:'OWNER',unreadCount:2,...extra})
async function mount(t, { conversations = [conv()], notices = [], override, selfId = 7, projectId = null, inviteProject = null, activeFileIds = [] } = {}) {
  let identity = 'account-one'; const calls = [], targets = [], events = new Map(), state = { messages: [], status: null, conversations, notices }
  const request = async (action, params, project) => {
    calls.push({action,params:structuredClone(params),project})
    if (override) { const answer = override(action, params, state); if (answer !== undefined) return answer }
    if (action === 'list') return { conversations: structuredClone(state.conversations), notifications: structuredClone(state.notices), counts:{unreadMessages:2,unreadNotifications:state.notices.length,pending:state.notices.filter(n=>n.actionState==='pending').length},projects:[{key:'cloud:42',name:'测试案卷'}],hasMore:true }
    if (action === 'read') return {}
    if (action === 'target') return state.notices.find(n=>n.id===params.id).target
    const im = params.action
    if (im === 'self') return {id: action === 'ddClientIm' ? 99 : selfId}
    if (im === 'agentScopes') return {agents:[]}
    if (im === 'members') return {humanCount:1}
    if (im === 'messages') return {messages:structuredClone(state.messages),agentStatus:state.status,hasMore:false}
    if (im === 'send') { const message = {id:state.messages.length+10,senderId:selfId,actorType:'HUMAN',senderName:'测试用户',text:params.params.text,clientMessageId:params.params.clientMessageId}; state.messages.push(message); return structuredClone(message) }
    if (im === 'agentReply') { state.status = {status:'queued',messageId:params.params.messageId}; return {accepted:true,...state.status} }
    if (im === 'create' || im === 'join') return conv({id:'c2',title:params.params.title || '邀请码会话'})
    if (im === 'read') return {}
    throw new Error(`unhandled ${action}:${im}`)
  }
  const uni = { $on(name,callback){events.set(name,callback)},$off(name){events.delete(name)},$emit(){} }
  const options = new Function('MessageConversationPane','messageCenterRequest','messageCenterIdentity','normalizeMessageTarget','requireAccount','ACCOUNT_CHANGED_EVENT','uni',script)(Child,request,()=>identity,normalizeMessageTarget,async()=>false,'account-changed',uni)
  let vm; const host=document.createElement('div');document.body.append(host)
  const app=Vue.createApp({render:()=>Vue.h({...options,template:source.template.content},{currentProjectId:projectId,activeFileIds,inviteProject,openTarget:async(...args)=>targets.push(args),ref:value=>vm=value})})
  app.config.globalProperties.$t=(key,args)=>{let result=zh[key.split('.').at(-1)]||key; for(const[k,v]of Object.entries(args||{}))result=result.replace(`{${k}}`,v);return result}
  app.mount(host);t.after(()=>{app.unmount();host.remove()});await tick();clearInterval(vm._poll)
  return {host,vm,calls,targets,state,accountChanged(){identity='account-two';events.get('account-changed')()},request}
}
async function selectChat(fixture) { fixture.host.querySelector('.inbox-row').click(); await tick() }
function type(fixture,text) { const area=fixture.host.querySelector('textarea'); area.value=text; area.dispatchEvent(new dom.window.Event('input',{bubbles:true}));return area }
test('native center has account conversations without a project and filter requests the selected project', async t=>{
 const f=await mount(t);assert.match(f.host.textContent,/测试项目群/);assert.match(f.host.textContent,/仅显示最近消息/)
 const select=f.host.querySelector('select');select.value='cloud:42';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick()
 assert.equal(f.calls.filter(c=>c.action==='list').at(-1).params.projectKey,'cloud:42');assert.equal(f.calls.find(c=>c.params.action==='self').project,null)
 await selectChat(f);assert.equal(f.host.querySelector('textarea')!==null,true)
})
test('notification selection marks read, opening rechecks target, neither confirms pending work',async t=>{
 const notice={id:'local:dd-client:opaque:91',title:'请确认材料',body:'请到业务中处理',sourceName:'受邀项目',actionState:'pending',target:{kind:'dd-client',connectionId:'12345678-1234-1234-1234-123456789abc',projectId:42,requestId:2}}
 const f=await mount(t,{notices:[notice]});f.host.querySelectorAll('[role=tab]')[2].click();await tick();f.host.querySelector('.inbox-row').click();await tick()
 assert.equal(f.calls.filter(c=>c.action==='read')[0].params.id,notice.id);assert.equal(f.vm.selectedNotice.actionState,'pending');assert.match(f.host.textContent,/阅读通知不会代替业务确认/)
 f.host.querySelector('.notice-actions .primary').click();await tick();assert.equal(f.calls.at(-1).action,'target');assert.equal(f.targets[0][1],notice.id);assert.equal(f.vm.selectedNotice.actionState,'pending')
})
test('ordinary text send uses actual acknowledgement, Enter works and IME Enter does not send',async t=>{
 const f=await mount(t);await selectChat(f);let area=type(f,'第一条');area.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));await tick();assert.equal(f.state.messages.length,0)
 area.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();assert.equal(f.state.messages[0].text,'第一条');assert.equal(f.host.querySelector('.message-row').textContent.includes('第一条'),true)
})
test('failed text send stays visible and retries with its original idempotency key',async t=>{
 let rejectSend=true;const f=await mount(t,{override:(a,p)=>{if(p.action==='send'&&rejectSend){rejectSend=false;return Promise.reject(new Error('离线'))}}});await selectChat(f);type(f,'保留原文');f.host.querySelector('.message-composer').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick()
 assert.match(f.host.textContent,/发送未确认/);const first=f.calls.find(c=>c.params.action==='send');[...f.host.querySelectorAll('button')].find(b=>b.textContent==='重试发送').click();await tick()
 const second=f.calls.filter(c=>c.params.action==='send')[1];assert.equal(first.params.params.clientMessageId,second.params.params.clientMessageId);assert.equal(f.vm.current.pending.length,0)
})
test('older queued/completed assistant jobs do not erase a later rejected message retry',async t=>{
 let busy=true;const f=await mount(t,{conversations:[conv({localProjectId:1,agent:{scope:'project',scopeKey:'p1',name:'项目助手'}})],override:(a,p)=>{if(p.action==='agentReply'&&p.params.messageId===11&&busy)return Promise.reject(new Error('助手正在回复'))}});await selectChat(f)
 for(const text of ['第一问','第二问']){type(f,text);await f.vm.sendMessage();await tick()}
 assert.ok(f.vm.current.failures['11']);await f.vm.loadMessages(f.vm.selectedConversation);assert.ok(f.vm.current.failures['11'])
 f.state.status={status:'completed',messageId:10};await f.vm.loadMessages(f.vm.selectedConversation);await tick();assert.ok(f.vm.current.failures['11']);assert.match(f.host.textContent,/重试助手回复/)
 busy=false;[...f.host.querySelectorAll('button')].find(b=>b.textContent==='重试助手回复').click();await tick();assert.equal(f.vm.current.failures['11'],undefined);assert.equal(f.state.messages.length,2)
})
test('DD conversation calls use connection identity and never leak the official user into own-message controls',async t=>{
 const f=await mount(t,{conversations:[conv({sourceId:'dd-client',connectionId:'invited-connection'})]});f.state.messages=[{id:1,senderId:7,text:'官方账号同数字不属于客户'}];await selectChat(f)
 assert.equal(f.vm.current.selfId,99);assert.equal(f.host.querySelector('.message-row.mine'),null);assert.ok(f.calls.some(c=>c.action==='ddClientIm'&&c.params.action==='messages'&&c.params.connectionId==='invited-connection'))
})
test('account replacement clears content, drafts and late messages from the earlier account',async t=>{
 const late=deferred();let delay=false;const f=await mount(t,{override:(a,p)=>p.action==='messages'&&delay?late.promise:undefined});await selectChat(f);type(f,'旧账号草稿');delay=true;const request=f.vm.loadMessages(f.vm.selectedConversation);await tick();f.state.conversations=[];f.accountChanged();await tick();late.resolve({messages:[{id:77,text:'旧账号机密'}]});await request;await tick()
 assert.equal(f.vm.selection,'');assert.deepEqual(Object.keys(f.vm.histories),[]);assert.doesNotMatch(f.host.textContent,/旧账号机密|旧账号草稿/)
})
test('late target response after account change cannot navigate into old business',async t=>{
 const late=deferred(),notice={id:'notice:one',title:'旧账号通知',actionState:'pending',target:{kind:'im',conversationId:'c1'}};const f=await mount(t,{notices:[notice],override:a=>a==='target'?late.promise:undefined});f.vm.changeCategory('notifications');await f.vm.selectItem(f.vm.notifications[0]);const opening=f.vm.openNotice();f.state.notices=[];f.accountChanged();await tick();late.resolve(notice.target);await opening;assert.equal(f.targets.length,0)
})
test('unavailable cloud account can still display real invited-source conversations and actionable status',async t=>{
 const f=await mount(t,{override:(a,p)=>a==='list'?{conversations:[conv({sourceId:'dd-client',connectionId:'connection'})],notifications:[],cloudStatus:'unavailable',cloudError:'请连接云端账号'}:p.action==='self'||p.action==='agentScopes'?Promise.reject(new Error('请连接云端账号')):undefined});assert.match(f.host.textContent,/测试项目群/);assert.match(f.host.textContent,/请连接云端账号/)
})
test('targets discard arbitrary scripts and keep DD remote identifiers separate from local navigation',()=>{
 assert.equal(normalizeMessageTarget({kind:'plugin',pluginId:'evil',view:'inbox',recordId:'1',url:'javascript:evil()'}),null)
 assert.equal(normalizeMessageTarget({kind:'plugin',pluginId:'lawfirm-management',view:'conflicts',recordId:'1'}),null)
 assert.equal(normalizeMessageTarget({kind:'dd',projectId:'1&action=approve',requestId:2}),null)
 assert.deepEqual(normalizeMessageTarget({kind:'dd-client',connectionId:'12345678-1234-1234-1234-123456789abc',projectId:9,requestId:2,itemId:3}),{kind:'dd-client',connectionId:'12345678-1234-1234-1234-123456789abc',projectId:'9',requestId:'2',itemId:'3'})
})

test('project group uses local context and invites through project membership, never ordinary group codes', async t => {
 const invites=[]; const f=await mount(t,{projectId:9,inviteProject:async row=>invites.push(row),override:(action,p)=>p.action==='projectGroup'?conv({projectId:42,localProjectId:9}):undefined})
 await f.vm.openProjectGroup();await tick();assert.equal(f.calls.find(c=>c.params.action==='projectGroup').project,9)
 const button=[...f.host.querySelectorAll('button')].find(b=>b.textContent==='邀请项目成员');button.click();await tick();assert.equal(invites[0].localProjectId,9);assert.equal(f.calls.some(c=>c.params.action==='invite'),false)
})
test('project assistant context only attaches by matching scope, never the current project number alone', async t => {
 const f=await mount(t,{projectId:9,conversations:[conv({type:'AGENT_DIRECT',agent:{scope:'project',scopeKey:'other-project',private:true}})],override:(action,p)=>p.action==='agentScopes'?{agents:[{scope:'project',scopeKey:'current-project',localProjectId:9}]}:undefined})
 await selectChat(f);type(f,'能看这个项目吗');await f.vm.sendMessage();await tick();assert.match(f.host.textContent,/请先打开助手所属的项目/);assert.equal(f.calls.some(c=>c.params.action==='agentReply'),false)
 f.vm.agents=[{scope:'project',scopeKey:'other-project',localProjectId:12}];f.vm.conversations=f.vm.conversations.map(row=>f.vm.withProjectContext(row));await f.vm.requestReply(f.vm.selectedConversation,10);assert.equal(f.calls.find(c=>c.params.action==='agentReply').project,12)
})
test('partial source failure is visible rather than a falsely empty inbox', async t => {
 const f=await mount(t,{override:action=>action==='list'?{conversations:[],notifications:[],unavailableSources:['dd-client']}:undefined});assert.match(f.host.textContent,/部分来源暂不可用/)
})

test('new conversation offers direct and group creation without the optional plugin', async t => {
 const f=await mount(t);f.vm.form='create';f.vm.formValue='与客户私聊';await f.vm.createConversation();assert.equal(f.calls.find(c=>c.params.action==='create').params.params.type,'DIRECT')
 f.vm.form='create';f.vm.formType='GROUP';f.vm.formValue='跨所协作';await f.vm.createConversation();assert.equal(f.calls.filter(c=>c.params.action==='create').at(-1).params.params.type,'GROUP')
})


test('shared bound project assistant can reply without reading a local project', async t => {
 const f=await mount(t,{conversations:[conv({projectId:77,agent:{scope:'project',scopeKey:'project:77',private:false}})]});await selectChat(f)
 type(f,'请根据本群材料回复');await f.vm.sendMessage();await tick();assert.equal(f.calls.find(c=>c.params.action==='agentReply').project,null)
 assert.doesNotMatch(f.host.textContent,/请先打开助手所属的项目/)
})
test('invited clients can read AI replies and send messages without unsupported AI controls', async t => {
 const f=await mount(t,{conversations:[conv({sourceId:'dd-client',connectionId:'invited',role:'CLIENT',agent:{scope:'project',scopeKey:'project:77'}})]})
 f.state.messages=[{id:3,actorType:'AGENT',senderId:0,senderName:'项目助手',text:'共享答复'}];f.state.status={status:'failed',messageId:4,error:'此前内部成员的失败'};await selectChat(f)
 assert.match(f.host.textContent,/共享答复/);assert.match(f.host.textContent,/由项目内部成员/)
 assert.doesNotMatch(f.host.textContent,/请助手回复|重试助手回复|与助手私聊/)
 type(f,'客户可以继续聊天');await f.vm.sendMessage();await tick();await f.vm.requestReply(f.vm.selectedConversation,10);f.vm.openPrivate();await tick()
 assert.equal(f.calls.some(c=>c.params.action==='agentReply'||c.params.action==='ensureAgent'),false);assert.ok(f.calls.some(c=>c.params.action==='send'))
})
test('current project role restriction also hides assistant actions for official account conversations', async t => {
 const f=await mount(t,{conversations:[conv({canRequestAgent:false,agent:{scope:'project',scopeKey:'project:77'}})]});await selectChat(f)
 type(f,'只发真人消息');await f.vm.sendMessage();await tick();assert.equal(f.calls.some(c=>c.params.action==='agentReply'),false);assert.doesNotMatch(f.host.textContent,/请助手回复|与助手私聊/)
})
test('bound shortcut is unique while legacy shared histories remain accessible and private marker maps correctly', async t => {
 const f=await mount(t,{projectId:9,conversations:[conv({id:'old',agent:{scope:'project',scopeKey:'old-marker'}}),conv({id:'private',type:'AGENT_DIRECT',agent:{scope:'project',scopeKey:'old-marker',private:true}}),conv({id:'bound',agent:{scope:'project',scopeKey:'project:77'}})],override:(a,p)=>p.action==='agentScopes'?{agents:[{scope:'project',scopeKey:'project:77',legacyScopeKey:'old-marker',localProjectId:9}]}:undefined})
 assert.equal(f.vm.conversations.length,3);assert.equal(f.vm.availableAgents.length,0);assert.equal(f.vm.conversations[0].historicalDiscussion,true);assert.equal(f.vm.conversations[1].historicalDiscussion,false);assert.equal(f.vm.conversations[1].localProjectId,9)
 await selectChat(f);assert.match(f.host.textContent,/历史讨论/);assert.ok(f.calls.some(c=>c.params.action==='messages'&&c.params.params.conversationId==='old'))
})
test('explicit notice read state survives unknown legacy timestamps without duplicate read calls', async t => {
 const f=await mount(t,{notices:[{id:'local:dd-client:read',title:'已读旧通知',read:true,readAt:null,createdAt:null,actionState:'pending'}]})
 f.vm.changeCategory('notifications');await tick();assert.equal(f.host.querySelector('.inbox-row.unread'),null);f.host.querySelector('.inbox-row').click();await tick()
 assert.equal(f.calls.some(c=>c.action==='read'),false);assert.equal(f.host.querySelector('time').textContent,'-');assert.equal(f.vm.selectedNotice.actionState,'pending')
})
test('explicit unread overrides an old timestamp and failed read remains retryable', async t => {
 let fails=true;const f=await mount(t,{notices:[{id:'notice:unread',title:'待读通知',read:false,readAt:'2026-01-01T00:00:00Z',actionState:'none'}],override:a=>a==='read'&&fails?Promise.reject(new Error('读取未确认')):undefined})
 f.vm.changeCategory('notifications');await tick();assert.ok(f.host.querySelector('.inbox-row.unread'));f.host.querySelector('.inbox-row').click();await tick();assert.equal(f.vm.selectedNotice.read,false)
 fails=false;await f.vm.markNoticeRead(f.vm.selectedNotice);assert.equal(f.vm.selectedNotice.read,true);assert.equal(f.vm.selectedNotice.readAt,'2026-01-01T00:00:00Z')
})

test('conversation shows assistant icons and sender photos while keeping explanations collapsed', async t => {
 const f=await mount(t,{conversations:[conv({agent:{scope:'project',scopeKey:'project:77'}})]})
 f.state.messages=[{id:1,actorType:'AGENT',senderId:0,senderName:'项目助手',text:'合成答复'},{id:2,actorType:'HUMAN',senderId:7,senderName:'测试用户',senderAvatarUrl:'https://example.test/avatar.png',text:'合成问题'}]
 await selectChat(f)
 assert.equal(f.host.querySelectorAll('.message-avatar.assistant svg').length,1)
 assert.equal(f.host.querySelector('.message-avatar img').getAttribute('src'),'https://example.test/avatar.png')
 assert.equal(f.host.querySelector('.message-cloud-info details').open,false)
 assert.equal(f.host.querySelector('.message-cloud-info > p'),null)
})

test('native project assistant shortcut defaults to private while explicit shared opening remains available', async t => {
 const agent={scope:'project',scopeKey:'project:77',localProjectId:9,name:'项目助手'}
 const f=await mount(t,{projectId:9,conversations:[conv({agent:{...agent,private:false}})],override:(a,p)=>p.action==='agentScopes'?{agents:[agent]}:p.action==='ensureAgent'?conv({id:'private',type:p.params.private?'AGENT_DIRECT':'GROUP',agent:{...agent,private:p.params.private}}):undefined})
 assert.equal(f.vm.availableAgents.length,1)
 f.host.querySelector('.scope-agents button').click();await tick()
 assert.equal(f.calls.find(c=>c.params.action==='ensureAgent').params.params.private,true)
 await f.vm.openAgent(agent,false);await tick()
 assert.equal(f.calls.filter(c=>c.params.action==='ensureAgent').at(-1).params.params.private,false)
})


test('private project replies pass current file ids and question only for the matching local project', async t => {
 const f=await mount(t,{projectId:1,activeFileIds:[71],conversations:[conv({type:'AGENT_DIRECT',localProjectId:1,agent:{scope:'project',scopeKey:'p1',private:true}})]});await selectChat(f)
 type(f,'他是原告还是被告？');await f.vm.sendMessage();await tick()
 const reply=f.calls.find(c=>c.params.action==='agentReply').params.params
 assert.deepEqual(reply.preferredFileIds,[71]);assert.equal(reply.question,'他是原告还是被告？')
 f.vm.selectedConversation.localProjectId=2;await f.vm.requestReply(f.vm.selectedConversation,10)
 assert.deepEqual(f.calls.filter(c=>c.params.action==='agentReply').at(-1).params.params.preferredFileIds,[])
})
