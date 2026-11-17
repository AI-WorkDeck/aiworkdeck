// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from 'vue/compiler-sfc'
import { parse as parseJs } from '@babel/parser'

const source = parseSfc(readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')).descriptor.script.content
const options = parseJs(source, { sourceType: 'module' }).program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration
const methods = options.properties.find(node => node.key?.name === 'methods').value

function workbench(send = async () => 'conversation-1') {
  const calls = { prompts: [], tabs: [], commands: [], drafts: [], resolutions: 0 }
  // Include EVERY matching property in source order, preserving JavaScript's
  // last-definition-wins behavior. Selecting the first match hides this bug.
  const bodies = methods.properties
    .filter(node => ['onPluginQuickAction', 'onPluginChatPrompt'].includes(node.key?.name))
    .map(node => source.slice(node.start, node.end))
  const actual = new Function('uni', 'setTimeout', `return ({${bodies.join(',\n')}})`)(
    { $emit: (...args) => calls.commands.push(args) }, callback => callback())
  const vm = {
    ...actual,
    projectId: 7,
    isActiveOverviewInstance: () => true,
    showAiPanel: false,
    aiPanelMounted: false,
    resolveChatInterface: async () => {
      calls.resolutions++
      return { sendExternalPrompt: async prompt => { calls.prompts.push(prompt); return send(prompt) } }
    },
    openPluginTab: id => calls.tabs.push(id),
    $nextTick: callback => callback(),
    $refs: { chatInterface: { setInputText: text => calls.drafts.push(text) } },
  }
  return { vm, calls }
}

test('the final bound plugin quick-action handler sends the SDK prompt exactly once', async () => {
  const { vm, calls } = workbench()
  await vm.onPluginQuickAction({ prompt: '诉讼可视化：合成材料' })
  assert.equal(calls.resolutions, 1)
  assert.deepEqual(calls.prompts, ['诉讼可视化：合成材料'])
})

test('plugin quick action awaits prompt submission and propagates its failure', async () => {
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const { vm } = workbench(() => waiting)
  let settled = false
  const pending = Promise.resolve(vm.onPluginQuickAction({ prompt: '合成任务' })).then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false, 'submission acknowledgement must not precede the send result')
  release()
  await pending
  assert.equal(settled, true)

  const failed = workbench(async () => { throw new Error('synthetic submission failed') })
  await assert.rejects(() => failed.vm.onPluginQuickAction({ prompt: '合成任务' }), /synthetic submission failed/)
})

test('plugin navigation, command dispatch and AI draft actions retain their behavior', async () => {
  const { vm, calls } = workbench()
  const payload = { pluginId: 'lawfirm-management', command: 'open-member', aiPrompt: '合成草稿' }
  await vm.onPluginQuickAction(payload)
  assert.deepEqual(calls.tabs, ['lawfirm-management'])
  assert.deepEqual(calls.commands, [['awd:plugin-sidebar-command', payload]])
  assert.deepEqual(calls.drafts, ['合成草稿'])
  assert.equal(vm.showAiPanel, true)
  assert.equal(vm.aiPanelMounted, true)
  assert.equal(calls.resolutions, 0)
  assert.deepEqual(calls.prompts, [])
})

test('an empty plugin action does not open or submit a chat', async () => {
  const { vm, calls } = workbench()
  await vm.onPluginQuickAction()
  await vm.onPluginQuickAction({ prompt: '' })
  assert.equal(calls.resolutions, 0)
  assert.equal(vm.showAiPanel, false)
  assert.equal(vm.aiPanelMounted, false)
})

test('plugin prompt rejects a missing receiver and changed project before submission', async () => {
  const absent = workbench()
  absent.vm.resolveChatInterface = async () => null
  assert.equal(await absent.vm.onPluginChatPrompt({ prompt: 'Synthetic task' }), null)
  assert.deepEqual(absent.calls.prompts, [])

  for (const invalidate of [vm => { vm.projectId = 8 }, vm => { vm.isActiveOverviewInstance = () => false }]) {
    const { vm, calls } = workbench()
    const resolve = vm.resolveChatInterface
    vm.resolveChatInterface = async () => { invalidate(vm); return resolve() }
    assert.equal(await vm.onPluginChatPrompt({ prompt: 'Synthetic task' }), null)
    assert.deepEqual(calls.prompts, [])
  }
  const stale = workbench()
  assert.equal(await stale.vm.onPluginChatPrompt({ prompt: 'Synthetic task', isCurrent: () => false }), null)
  assert.equal(stale.calls.resolutions, 0)
})

test('plugin prompt returns the actual receiver result', async () => {
  for (const result of ['conversation-1', null]) {
    const { vm } = workbench(async () => result)
    assert.equal(await vm.onPluginQuickAction({ prompt: 'Synthetic task' }), result)
  }
})

test('projectless guide actions still resolve the panel to show existing project guidance', async () => {
  const { vm, calls } = workbench()
  vm.projectId = null
  assert.equal(await vm.onPluginQuickAction({ prompt: 'Synthetic task' }), null)
  assert.equal(calls.resolutions, 1)
  assert.deepEqual(calls.prompts, [])
})
