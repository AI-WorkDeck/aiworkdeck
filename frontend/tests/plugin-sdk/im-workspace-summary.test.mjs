// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><body></body>')
for (const key of ['window', 'document', 'Element', 'Node', 'HTMLElement', 'SVGElement']) globalThis[key] = dom.window[key]
const Vue = require('vue/dist/vue.cjs.js')
const { parse } = require('@vue/compiler-sfc')
const source = readFileSync(new URL('../../src/components/PluginWorkspaceSummary.vue', import.meta.url), 'utf8')
const { descriptor, errors } = parse(source)
assert.deepEqual(errors, [])
// Render the actual template and options; native tags/tap are mapped to their H5 equivalents.
const template = descriptor.template.content.replace(/<(\/?)(view|scroll-view)\b/g, '<$1div').replace(/<(\/?)text\b/g, '<$1span').replace(/@tap/g, '@click')
const script = descriptor.script.content.replace(/^import .*$/gm, '').replace('export default', 'return')
const directory = {
  accountKey: 'test', me: { id: '7' },
  organization: { name: '合成团队', members: [{ id: '22', name: '团队同事', roleLabel: '成员' }] },
  firm: { name: '合成律所', teams: [] }, capabilities: {}, friends: [],
  projectColleagues: [{ id: '7', name: '我自己', roleLabel: '负责人' }, { id: '23', name: '项目同事', roleLabel: '项目成员' }],
}
async function mount(t, agents = [], projectReason = '') {
  const events = [], hostEvents = [], listeners = new Map()
  const uni = {
    $on(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback) },
    $off(name, callback) { listeners.get(name)?.delete(callback) },
    $emit(name, payload) { hostEvents.push({ name, payload }); for (const callback of listeners.get(name) || []) callback(payload) },
    showToast() {},
  }
  const options = new Function('ICONS', 'getPluginGlyphPaths', 'getTeam', 'getProjectMembers', 'getCurrentUser', 'requestPluginIm', 'getLawFirmOverview', 'loadImDirectory', 'addImFriend', 'ORG_CHANGED_EVENT', 'ACCOUNT_CHANGED_EVENT', 'uni', script)(
    {}, () => [], async () => ({}), async () => [], async () => ({}),
    async (_plugin, _project, action) => ({ code: 0, data: action === 'agentScopes' ? { agents, projectReason } : { conversations: [{ id: 'c1', title: '已有项目会话', type: 'GROUP', role: 'OWNER' }] } }),
    async () => ({}), async () => structuredClone(directory), () => ({}), 'org-changed', 'account-changed', uni)
  const host = document.createElement('div'); document.body.append(host)
  const component = { ...options, template }, props = Vue.reactive({ plugin: { pluginId: 'project-im' }, projectId: 1 })
  let vm
  const app = Vue.createApp({ render: () => Vue.h(component, { ...props, ref: (value) => { vm = value }, onQuickAction: (action) => events.push(action) }) })
  app.config.globalProperties.$t = (key) => key
  app.mount(host)
  t.after(() => { app.unmount(); host.remove() })
  await new Promise(resolve => setImmediate(resolve)); await Vue.nextTick()
  return { host, vm, events, hostEvents, props, uni }
}
test('host sidebar renders conversations first and reveals actual project/team/firm contacts only on request', async (t) => {
  const { host, vm, events } = await mount(t)
  assert.match(host.textContent, /已有项目会话/)
  assert.equal(host.querySelector('.pws-directory-section'), null)
  assert.doesNotMatch(host.textContent, /我的组织|我的朋友|团队里暂时只有你/)
  host.querySelector('.pws-directory-toggle').click(); await Vue.nextTick()
  assert.match(host.textContent, /当前项目.*项目同事.*我的团队.*我的律所/s)
  assert.doesNotMatch(host.querySelector('.pws-directory-section').textContent, /我自己/)
  host.querySelector('.pws-project-contact').click(); await Vue.nextTick()
  assert.deepEqual(events.at(-1), { pluginId: 'project-im', command: 'start-direct-chat', contact: { name: '项目同事', roleLabel: '项目成员', org: '' }, category: 'project' })
  vm.searchKeyword = '团队同事'; await Vue.nextTick()
  assert.match(host.textContent, /团队同事/)
  assert.doesNotMatch(host.querySelector('.pws-directory-section').textContent, /项目同事/)
})
test('host conversation selection keeps the existing plugin command contract', async (t) => {
  const { host, events } = await mount(t)
  host.querySelector('.pws-conv-item').click(); await Vue.nextTick()
  assert.deepEqual(events.at(-1), { pluginId: 'project-im', command: 'select-conversation', conversationId: 'c1', title: '已有项目会话' })
})

test('host assistant entries come from allowed scopes and preserve exact scope when opened', async (t) => {
  const agents = [{ scope: 'project', scopeKey: 'project-uuid', name: '项目助手', title: '合成项目' }, { scope: 'team', scopeKey: 'team:one', name: '团队助手', title: '合成团队' }]
  const { host, vm, events } = await mount(t, agents)
  assert.equal(host.querySelectorAll('.pws-agent-entry').length, 2)
  host.querySelectorAll('.pws-agent-entry')[1].click(); await Vue.nextTick()
  assert.deepEqual(events.at(-1), { pluginId: 'project-im', command: 'open-agent', scope: 'team', scopeKey: 'team:one', title: '合成团队', private: false })
  vm.conversations = [{ id: 'p', title: '项目助手私聊', type: 'AGENT_DIRECT', role: 'OWNER', agent: { private: true } }]
  vm.convFilter = 'DIRECT'; await Vue.nextTick()
  assert.match(host.querySelector('.pws-conv-list').textContent, /仅你可见/)
})
test('host explains an unavailable project assistant without hiding permitted team entry or ordinary conversations', async (t) => {
  const { host, events } = await mount(t, [{ scope: 'team', scopeKey: 'team:one', name: '团队助手', title: '合成团队' }], '请由项目负责人先创建项目助手群。')
  assert.match(host.querySelector('.pws-agent-section').textContent, /请由项目负责人先创建项目助手群/)
  assert.match(host.querySelector('.pws-conv-list').textContent, /已有项目会话/)
  host.querySelector('.pws-agent-entry').click(); await Vue.nextTick()
  assert.equal(events.at(-1).scope, 'team')
})
test('host sidebar visibility follows matching sync and restores fallback for the old project or plugin', async (t) => {
  const { host, props, hostEvents, uni } = await mount(t)
  assert.deepEqual(hostEvents.at(-1).payload, { pluginId: 'project-im', command: 'host-sidebar', projectId: 1, visible: true })
  uni.$emit('awd:plugin-state-synced', { pluginId: 'project-im', projectId: 1, directoryOpen: true }); await Vue.nextTick()
  assert.ok(host.querySelector('.pws-directory-section'))
  assert.equal(document.activeElement, host.querySelector('.pws-directory-toggle'))
  props.projectId = 2; await Vue.nextTick()
  assert.deepEqual(hostEvents.at(-1).payload, { pluginId: 'project-im', command: 'host-sidebar', projectId: 1, visible: false })
  const count = hostEvents.length
  uni.$emit('awd:plugin-state-synced', { pluginId: 'project-im', projectId: 1 })
  assert.equal(hostEvents.length, count + 1, 'stale project sync receives no visibility acknowledgement')
  uni.$emit('awd:plugin-state-synced', { pluginId: 'project-im', projectId: 2 })
  assert.equal(hostEvents.at(-1).payload.visible, true)
  props.plugin = { pluginId: 'other-plugin' }; await Vue.nextTick()
  assert.deepEqual(hostEvents.at(-1).payload, { pluginId: 'project-im', command: 'host-sidebar', projectId: 2, visible: false })
})

test('project assistant shortcut opens private context even when a shared project group exists', async t => {
 const agent={scope:'project',scopeKey:'project:7',legacyScopeKey:'local-marker',name:'项目助手'}
 const {host,vm,events}=await mount(t,[agent])
 vm.conversations=[{id:'group',type:'GROUP',agent:{scope:'project',scopeKey:'project:7',private:false}}];await Vue.nextTick()
 host.querySelector('.pws-agent-entry').click();await Vue.nextTick()
 assert.equal(events.at(-1).private,true)
 vm.conversations.push({id:'private',type:'AGENT_DIRECT',agent:{scope:'project',scopeKey:'local-marker',private:true}});await Vue.nextTick()
 assert.equal(host.querySelector('.pws-agent-entry'),null)
})
